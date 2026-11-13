import { ALLOWED_HOSTS, type RisConfig } from "../config.js";
import { log } from "../log.js";
import { RisError } from "./errors.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpDeps {
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface CacheEntry {
  expires: number;
  value: string;
}

/**
 * Höflicher HTTP-Client für RIS:
 *  - alle Requests laufen seriell über EINE Warteschlange (keine parallelen
 *    Verbindungen) mit mindestens `minIntervalMs` Abstand (Netiquette: max. 0,5 req/s)
 *  - nur https auf erlaubten Hosts, Redirects nur innerhalb der Allowlist
 *  - Timeout, begrenzte Antwortgröße, Retries mit exponentiellem Backoff
 *  - kleiner In-Memory-Cache, damit Paginierung/Wiederholungen keine neuen Requests auslösen
 *
 * Eine Instanz pro Prozess verwenden: so gilt das Rate-Limit auch dann global,
 * wenn später mehrere Clients (HTTP-Transport) gleichzeitig zugreifen.
 */
export class RisHttp {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxCacheEntries = 200;

  constructor(
    private readonly config: RisConfig,
    deps: HttpDeps = {},
  ) {
    this.fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init));
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** GET mit Cache. `accept` steuert den erwarteten Content-Type. */
  async getText(url: string, opts: { accept: "json" | "xml" | "html"; cacheTtlMs: number }): Promise<string> {
    assertAllowedUrl(url);
    const cached = this.cache.get(url);
    if (cached && cached.expires > this.now()) {
      // LRU: an das Ende verschieben
      this.cache.delete(url);
      this.cache.set(url, cached);
      return cached.value;
    }
    const value = await this.enqueue(() => this.fetchWithRetry(url, opts.accept));
    if (opts.cacheTtlMs > 0) {
      this.cache.set(url, { value, expires: this.now() + opts.cacheTtlMs });
      while (this.cache.size > this.maxCacheEntries) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
    }
    return value;
  }

  async getJson(url: string, cacheTtlMs: number): Promise<unknown> {
    const text = await this.getText(url, { accept: "json", cacheTtlMs });
    try {
      return JSON.parse(text);
    } catch {
      throw new RisError("bad_response", "RIS-API lieferte kein gültiges JSON.");
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    // Fehler dürfen die Warteschlange nicht blockieren.
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Wartet, bis seit dem letzten Request mindestens minIntervalMs vergangen sind. */
  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.config.minIntervalMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = this.now();
  }

  private async fetchWithRetry(url: string, accept: "json" | "xml" | "html"): Promise<string> {
    let lastError: RisError | undefined;
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        return await this.fetchOnce(url, accept);
      } catch (e) {
        const err = e instanceof RisError ? e : new RisError("unavailable", String(e));
        lastError = err;
        const retryable = err.kind === "unavailable";
        if (!retryable || attempt === this.config.maxAttempts) throw err;
        const backoff = 2000 * 2 ** (attempt - 1); // 2 s, 4 s, 8 s …
        log(`RIS-Request fehlgeschlagen (Versuch ${attempt}): ${err.message} – neuer Versuch in ${backoff} ms`);
        await this.sleep(backoff);
      }
    }
    throw lastError ?? new RisError("unavailable", "RIS nicht erreichbar.");
  }

  private async fetchOnce(url: string, accept: "json" | "xml" | "html", redirects = 0): Promise<string> {
    await this.throttle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": this.config.userAgent,
          Accept: accept === "json" ? "application/json" : accept === "xml" ? "application/xml, text/xml" : "text/html",
          "Accept-Language": "de-AT,de;q=0.9",
        },
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = controller.signal.aborted;
      const cause = (e as { cause?: { code?: string } })?.cause?.code;
      if (cause && /CERT|SSL|TLS/i.test(cause)) {
        throw new RisError(
          "unavailable",
          `TLS-Fehler beim Verbinden mit RIS (${cause}).`,
          "Hinter einem Firmenproxy/Virenscanner mit TLS-Inspektion: NODE_EXTRA_CA_CERTS auf das Root-Zertifikat setzen (siehe README).",
        );
      }
      throw new RisError(
        "unavailable",
        aborted ? `Zeitüberschreitung nach ${this.config.timeoutMs} ms.` : `Netzwerkfehler: ${cause ?? (e as Error).message}`,
      );
    }

    try {
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc || redirects >= 3) throw new RisError("bad_response", `Unerwartete Weiterleitung (${res.status}).`);
        const next = new URL(loc, url).toString();
        assertAllowedUrl(next);
        return await this.fetchOnce(next, accept, redirects + 1);
      }
      if (res.status === 404 || res.status === 410) {
        throw new RisError("not_found", "Dokument nicht gefunden (HTTP 404).");
      }
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
        if (Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 60) {
          await this.sleep(retryAfter * 1000);
        }
        throw new RisError("unavailable", `RIS antwortet mit HTTP ${res.status}.`);
      }
      if (!res.ok) {
        throw new RisError("bad_response", `RIS antwortet mit HTTP ${res.status}.`);
      }
      const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
      if (accept === "json" && !ctype.includes("json")) {
        throw new RisError("bad_response", `Unerwarteter Content-Type "${ctype}" (JSON erwartet).`);
      }
      if (accept === "xml" && !ctype.includes("xml")) {
        // ogd liefert bei Fehlern eine HTML-Seite mit Status 200/404
        throw new RisError("not_found", `Kein XML-Dokument verfügbar (Content-Type "${ctype}").`);
      }
      return await readLimited(res, this.config.maxResponseBytes);
    } finally {
      clearTimeout(timer);
    }
  }
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
      await reader.cancel();
      throw new RisError("bad_response", `Antwort zu groß (> ${maxBytes} Bytes).`);
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}
