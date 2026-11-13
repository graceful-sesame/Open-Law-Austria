import { ALLOWED_HOSTS, type RisConfig } from "../config.js";
import { log } from "../log.js";
import { RisError } from "./errors.js";
import { simplifyApiError } from "./normalize.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpDeps {
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface GetOptions {
  accept: "json" | "xml" | "html";
  cacheTtlMs: number;
  /** Abbruch durch den Aufrufer (z. B. MCP-Client bricht den Tool-Call ab). */
  signal?: AbortSignal;
  /** Antwort nur cachen, wenn diese Prüfung true ergibt (z. B. keine API-Fehlerantwort). */
  cacheIf?: (body: string) => boolean;
}

interface CacheEntry {
  expires: number;
  value: string;
}

/** Abbrechbares Warten. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(signal: AbortSignal): RisError {
  const reason = signal.reason as { name?: string } | undefined;
  return reason?.name === "TimeoutError"
    ? new RisError("unavailable", "Zeitbudget für diese Anfrage überschritten.", "RIS antwortet derzeit langsam – bitte später erneut versuchen.")
    : new RisError("unavailable", "Anfrage wurde abgebrochen.");
}

/**
 * Höflicher HTTP-Client für RIS:
 *  - alle Requests laufen seriell über EINE Warteschlange (keine parallelen
 *    Verbindungen) mit mindestens `minIntervalMs` Abstand (Netiquette: max. 0,5 req/s)
 *  - nur https auf erlaubten Hosts, Redirects nur innerhalb der Allowlist
 *  - Timeout pro Request, abbrechbar über AbortSignal, begrenzte Warteschlange
 *  - begrenzte Antwortgröße, Retries mit exponentiellem Backoff (Retry-After wird respektiert)
 *  - In-Memory-Cache mit Byte-Budget und Deduplizierung gleichzeitiger Abrufe
 *
 * Eine Instanz pro Prozess verwenden: so gilt das Rate-Limit auch dann für alle
 * Sitzungen, wenn später mehrere Clients (HTTP-Transport) gleichzeitig zugreifen.
 */
export class RisHttp {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private lastRequestAt = 0;
  private readonly cache = new Map<string, CacheEntry>();
  private cacheBytes = 0;
  private readonly inflight = new Map<string, Promise<string>>();

  static readonly MAX_QUEUE = 20;
  static readonly CACHE_BYTE_BUDGET = 50 * 1024 * 1024;

  constructor(
    private readonly config: RisConfig,
    deps: HttpDeps = {},
  ) {
    this.fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init));
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? defaultSleep;
  }

  /** GET mit Cache und Deduplizierung. */
  async getText(url: string, opts: GetOptions): Promise<string> {
    assertAllowedUrl(url);
    const cached = this.cache.get(url);
    if (cached && cached.expires > this.now()) {
      this.cache.delete(url); // LRU: ans Ende
      this.cache.set(url, cached);
      return cached.value;
    }
    if (cached) this.evict(url);

    const pending = this.inflight.get(url);
    if (pending) return pending;

    const p = this.enqueue(() => this.fetchWithRetry(url, opts.accept, opts.signal), opts.signal)
      .then((value) => {
        if (opts.cacheTtlMs > 0 && (!opts.cacheIf || opts.cacheIf(value))) this.store(url, value, opts.cacheTtlMs);
        return value;
      })
      .finally(() => this.inflight.delete(url));
    this.inflight.set(url, p);
    return p;
  }

  async getJson(url: string, cacheTtlMs: number, signal?: AbortSignal): Promise<unknown> {
    // Fehlerantworten der API (HTTP 200 mit OgdSearchResult.Error) nicht cachen.
    const text = await this.getText(url, {
      accept: "json",
      cacheTtlMs,
      signal,
      cacheIf: (b) => !b.slice(0, 200).includes('"Error"'),
    });
    try {
      return JSON.parse(text);
    } catch {
      this.evict(url);
      throw new RisError("bad_response", "RIS-API lieferte kein gültiges JSON.");
    }
  }

  private store(url: string, value: string, ttl: number): void {
    const size = value.length * 2;
    if (size > RisHttp.CACHE_BYTE_BUDGET / 4) return; // sehr große Dokumente nicht cachen
    this.evict(url);
    this.cache.set(url, { value, expires: this.now() + ttl });
    this.cacheBytes += size;
    while (this.cacheBytes > RisHttp.CACHE_BYTE_BUDGET || this.cache.size > 500) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.evict(oldest);
    }
  }

  private evict(url: string): void {
    const e = this.cache.get(url);
    if (!e) return;
    this.cacheBytes -= e.value.length * 2;
    this.cache.delete(url);
  }

  private enqueue<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.queued >= RisHttp.MAX_QUEUE) {
      return Promise.reject(
        new RisError("unavailable", "Zu viele gleichzeitige RIS-Anfragen in der Warteschlange.", "Bitte Anfragen nacheinander stellen."),
      );
    }
    this.queued++;
    const guarded = () => {
      if (signal?.aborted) return Promise.reject(abortError(signal));
      return task();
    };
    const run = this.queue.then(guarded, guarded).finally(() => {
      this.queued--;
    });
    // Fehler dürfen die Warteschlange nicht blockieren.
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Wartet, bis seit dem letzten Request mindestens minIntervalMs vergangen sind. */
  private async throttle(signal?: AbortSignal): Promise<void> {
    const wait = this.lastRequestAt + this.config.minIntervalMs - this.now();
    if (wait > 0) await this.sleep(wait, signal);
    this.lastRequestAt = this.now();
  }

  private async fetchWithRetry(url: string, accept: GetOptions["accept"], signal?: AbortSignal): Promise<string> {
    let lastError: RisError | undefined;
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      if (signal?.aborted) throw abortError(signal);
      try {
        return await this.fetchOnce(url, accept, signal);
      } catch (e) {
        const err = e instanceof RisError ? e : new RisError("unavailable", String(e));
        lastError = err;
        const retryable = err.kind === "unavailable" && !(e as RetryInfo).noRetry && !signal?.aborted;
        if (!retryable || attempt === this.config.maxAttempts) throw err;
        const backoff = Math.max(2000 * 2 ** (attempt - 1), (e as RetryInfo).retryAfterMs ?? 0);
        log(`RIS-Request fehlgeschlagen (Versuch ${attempt}): ${err.message} – neuer Versuch in ${backoff} ms`);
        await this.sleep(backoff, signal);
      }
    }
    throw lastError ?? new RisError("unavailable", "RIS nicht erreichbar.");
  }

  private async fetchOnce(url: string, accept: GetOptions["accept"], signal?: AbortSignal, redirects = 0): Promise<string> {
    await this.throttle(signal);
    // Eigener (ref'd) Timer statt AbortSignal.timeout(), der den Prozess nicht wach hält.
    const timeoutCtl = new AbortController();
    const timer = setTimeout(() => timeoutCtl.abort(), this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeoutCtl.signal]) : timeoutCtl.signal;
    const describeAbort = (): RisError =>
      signal?.aborted ? abortError(signal) : new RisError("unavailable", `Zeitüberschreitung nach ${this.config.timeoutMs} ms.`);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal: combined,
        headers: {
          "User-Agent": this.config.userAgent,
          Accept: accept === "json" ? "application/json" : accept === "xml" ? "application/xml, text/xml" : "text/html",
          "Accept-Language": "de-AT,de;q=0.9",
        },
      });
    } catch (e) {
      clearTimeout(timer);
      if (combined.aborted) throw describeAbort();
      const cause = (e as { cause?: { code?: string } })?.cause?.code;
      if (cause && /CERT|SSL|TLS/i.test(cause)) {
        throw Object.assign(
          new RisError(
            "unavailable",
            `TLS-Fehler beim Verbinden mit RIS (${cause}).`,
            "Hinter einem Firmenproxy/Virenscanner mit TLS-Inspektion: NODE_EXTRA_CA_CERTS auf das Root-Zertifikat setzen (siehe README).",
          ),
          { noRetry: true },
        );
      }
      throw new RisError("unavailable", `Netzwerkfehler: ${cause ?? (e as Error).message}`);
    }

    let consumed = false;
    try {
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc || redirects >= 3) throw new RisError("bad_response", `Unerwartete Weiterleitung (${res.status}).`);
        const next = new URL(loc, url).toString();
        assertAllowedUrl(next);
        await res.body?.cancel().catch(() => undefined);
        consumed = true;
        return await this.fetchOnce(next, accept, signal, redirects + 1);
      }
      if (res.status === 404 || res.status === 410) {
        throw new RisError("not_found", "Dokument nicht gefunden (HTTP 404).");
      }
      if (res.status >= 500 && (res.headers.get("content-type") ?? "").includes("json")) {
        // RIS meldet manche Anfragefehler als HTTP 500 mit JSON-Fehlertext
        // (z. B. "Die Seitennummer ist höher als die Anzahl der Seiten"). Kein Retry.
        consumed = true;
        const body = await readLimited(res, 64 * 1024).catch(() => "");
        const msg = (() => {
          try {
            return (JSON.parse(body) as { OgdSearchResult?: { Error?: { Message?: string } } }).OgdSearchResult?.Error?.Message;
          } catch {
            return undefined;
          }
        })();
        if (msg) {
          throw Object.assign(new RisError("invalid_params", `RIS-API lehnt die Anfrage ab: ${simplifyApiError(msg)}`), {
            noRetry: true,
          });
        }
        throw new RisError("unavailable", `RIS antwortet mit HTTP ${res.status}.`);
      }
      if (res.status === 429 || res.status >= 500) {
        const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"), this.now());
        if (retryAfterMs !== undefined && retryAfterMs > 60_000) {
          throw Object.assign(
            new RisError(
              "unavailable",
              `RIS antwortet mit HTTP ${res.status} und bittet, ${Math.ceil(retryAfterMs / 1000)} s zu warten.`,
              "Bitte später erneut versuchen.",
            ),
            { noRetry: true },
          );
        }
        throw Object.assign(new RisError("unavailable", `RIS antwortet mit HTTP ${res.status}.`), { retryAfterMs });
      }
      if (!res.ok) {
        throw new RisError("bad_response", `RIS antwortet mit HTTP ${res.status}.`);
      }
      const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
      if (accept === "json" && !ctype.includes("json")) {
        throw new RisError("bad_response", `Unerwarteter Content-Type "${ctype}" (JSON erwartet).`);
      }
      if (accept === "xml" && !ctype.includes("xml")) {
        // ogd liefert bei fehlenden Dokumenten eine HTML-Seite
        throw new RisError("not_found", `Kein XML-Dokument verfügbar (Content-Type "${ctype}").`);
      }
      consumed = true;
      try {
        return await readLimited(res, this.config.maxResponseBytes);
      } catch (e) {
        if (combined.aborted) throw describeAbort();
        throw e;
      }
    } finally {
      clearTimeout(timer);
      // Nicht gelesene Bodies freigeben, damit keine Verbindung hängen bleibt.
      if (!consumed) await res.body?.cancel().catch(() => undefined);
    }
  }
}

interface RetryInfo {
  noRetry?: boolean;
  retryAfterMs?: number;
}

/** Retry-After als Sekunden oder HTTP-Datum. */
export function parseRetryAfter(raw: string | null, now: number): number | undefined {
  if (!raw) return undefined;
  const secs = Number(raw.trim());
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
}

function assertAllowedUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new RisError("invalid_params", "Ungültige URL.");
  }
  if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname) || u.username || u.password || u.port) {
    throw new RisError("invalid_params", `Zugriff auf ${u.protocol}//${u.host} ist nicht erlaubt.`);
  }
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const len = Number.parseInt(res.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(len) && len > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new RisError("bad_response", `Antwort zu groß (${len} Bytes).`);
  }
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RisError("bad_response", `Antwort zu groß (> ${maxBytes} Bytes).`);
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}
