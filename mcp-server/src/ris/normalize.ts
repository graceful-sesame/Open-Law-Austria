import { RisError } from "./errors.js";

/**
 * Normalisierung der RIS-JSON-Antworten. Eigenheiten der API:
 *  - Fehler kommen als HTTP 200 mit `OgdSearchResult.Error`
 *  - bei genau einem Treffer ist `OgdDocumentReference` ein Objekt statt Array
 *  - Mehrfachwerte stecken in `{ item: x | x[] }`
 *  - 0 Treffer: `OgdDocumentReference` fehlt
 */

export type Scalar = string | string[];
export type FlatMeta = Record<string, Scalar>;

export interface ContentLink {
  type: string; // MainDocument | Attachment | …
  name: string;
  dataType: string; // Xml | Html | Pdf | Rtf | …
  url: string;
}

export interface SearchHit {
  id: string;
  applikation: string;
  /** Kategorie: Judikatur, Bundesrecht, Landesrecht, Gemeinden, Bezirke, Sonstige */
  kategorie: string;
  /** Alle Metadaten flach (Allgemein + Kategorie + applikationsspezifisch). */
  meta: FlatMeta;
  /** Verknüpfte Entscheidungstexte eines Rechtssatzes. */
  entscheidungstexte: Array<{ geschaeftszahl: string; datum: string; gericht: string; id: string }>;
  dokumentUrl?: string;
  content: ContentLink[];
}

export interface SearchResult {
  total: number;
  page: number;
  pageSize: number;
  hits: SearchHit[];
}

export function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Entfernt HTML-Reste und normalisiert Whitespace in Metadatenwerten. */
export function cleanText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[a-zA-Z][^<>]*>/g, "") // nur echte Tags, nicht "x < 3 und y > 4"
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&") // zuletzt, damit "&amp;lt;" nicht doppelt dekodiert wird
    .replace(/\s+/g, " ")
    .trim();
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function scalarOf(v: unknown): Scalar | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") {
    const t = cleanText(v);
    return t === "" ? undefined : t;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const out = v.flatMap((x) => {
      const s = scalarOf(x);
      return s === undefined ? [] : Array.isArray(s) ? s : [s];
    });
    return out.length ? out : undefined;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("item" in o) return scalarOf(o.item);
    if ("#text" in o) return scalarOf(o["#text"]);
  }
  return undefined;
}

/** Legt alle skalaren Felder eines Objekts (rekursiv in Unterobjekte) flach ab. */
function flattenInto(target: FlatMeta, obj: Record<string, unknown>, skip: Set<string>): void {
  for (const [k, v] of Object.entries(obj)) {
    if (skip.has(k)) continue;
    const s = scalarOf(v);
    if (s !== undefined) {
      if (!(k in target)) target[k] = s;
      continue;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flattenInto(target, v as Record<string, unknown>, skip);
    }
  }
}

export function getStr(meta: FlatMeta, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = meta[k];
    if (v === undefined) continue;
    const s = Array.isArray(v) ? v.join("; ") : v;
    if (s) return s;
  }
  return undefined;
}

export function getList(meta: FlatMeta, key: string): string[] {
  const v = meta[key];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function parseHits(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") return Number.parseInt(raw, 10) || 0;
  if (raw && typeof raw === "object") return Number.parseInt(String((raw as Record<string, unknown>)["#text"] ?? "0"), 10) || 0;
  return 0;
}

export function parseSearchResponse(json: unknown): SearchResult {
  const root = (json as { OgdSearchResult?: Record<string, unknown> })?.OgdSearchResult;
  if (!root) throw new RisError("bad_response", "Unerwartetes Antwortformat der RIS-API (OgdSearchResult fehlt).");

  if (root.Error) {
    const err = root.Error as { Message?: string };
    const msg = String(err.Message ?? JSON.stringify(err));
    throw new RisError("invalid_params", `RIS-API lehnt die Anfrage ab: ${simplifyApiError(msg)}`);
  }

  const results = root.OgdDocumentResults as Record<string, unknown> | undefined;
  if (!results) return { total: 0, page: 1, pageSize: 0, hits: [] };

  const hitsInfo = results.Hits as Record<string, unknown> | undefined;
  const total = parseHits(hitsInfo);
  const page = Number.parseInt(String(hitsInfo?.["@pageNumber"] ?? "1"), 10) || 1;
  const pageSize = Number.parseInt(String(hitsInfo?.["@pageSize"] ?? "0"), 10) || 0;

  const hits = asArray(results.OgdDocumentReference as unknown).map(parseReference);
  return { total, page, pageSize, hits };
}

function parseReference(ref: unknown): SearchHit {
  const data = (ref as { Data?: Record<string, unknown> })?.Data ?? {};
  const md = (data.Metadaten ?? {}) as Record<string, Record<string, unknown>>;
  const tech = md.Technisch ?? {};
  const allg = md.Allgemein ?? {};
  const kategorie = Object.keys(md).find((k) => k !== "Technisch" && k !== "Allgemein") ?? "";
  const catObj = (md[kategorie] ?? {}) as Record<string, unknown>;
  const applikation = String(tech.Applikation ?? "");

  const meta: FlatMeta = {};
  // Reihenfolge: Applikationsspezifisch > Kategorie > Allgemein
  const sub = catObj[applikation];
  const skip = new Set(["Entscheidungstexte", "ImportTimestamp"]);
  if (sub && typeof sub === "object") flattenInto(meta, sub as Record<string, unknown>, skip);
  flattenInto(meta, catObj, new Set([...skip, applikation]));
  flattenInto(meta, allg, skip);
  if (tech.Organ && !meta.Organ) meta.Organ = String(tech.Organ);

  const entscheidungstexte = asArray(
    ((sub as Record<string, unknown> | undefined)?.Entscheidungstexte as { item?: unknown } | undefined)?.item,
  ).map((e) => {
    const o = (e ?? {}) as Record<string, unknown>;
    const url = String(o.DokumentUrl ?? "");
    const id = String(o.Dokumentnummer ?? url.match(/Dokumentnummer=([^&]+)/)?.[1] ?? "");
    return {
      geschaeftszahl: cleanText(String(o.Geschaeftszahl ?? "")),
      datum: String(o.Entscheidungsdatum ?? ""),
      gericht: String(o.Gericht ?? ""),
      id: safeDecode(id),
    };
  });

  const content: ContentLink[] = [];
  const dl = data.Dokumentliste;
  if (dl && typeof dl === "object") {
    for (const cr of asArray((dl as Record<string, unknown>).ContentReference as unknown)) {
      const c = (cr ?? {}) as Record<string, unknown>;
      for (const u of asArray(((c.Urls ?? {}) as Record<string, unknown>).ContentUrl as unknown)) {
        const uu = (u ?? {}) as Record<string, unknown>;
        if (typeof uu.Url === "string") {
          content.push({
            type: String(c.ContentType ?? ""),
            name: String(c.Name ?? ""),
            dataType: String(uu.DataType ?? ""),
            url: uu.Url,
          });
        }
      }
    }
  }

  return {
    id: String(tech.ID ?? ""),
    applikation,
    kategorie,
    meta,
    entscheidungstexte,
    dokumentUrl: typeof allg.DokumentUrl === "string" ? allg.DokumentUrl : undefined,
    content,
  };
}

/** Macht SOAP-Schema-Fehler lesbar. */
export function simplifyApiError(msg: string): string {
  const m = msg.match(/'[^']*:(\w[\w.]*)' element is invalid - The value '([^']*)' is invalid according to its datatype '[^']*:(\w+)'/);
  if (m) return `Ungültiger Wert "${m[2]}" für ${m[1]} (erwartet: ${m[3]}).`;
  const c = msg.match(/has invalid child element '(\w+)'/);
  if (c) return `Unbekannter Parameter/Wert "${c[1]}".`;
  if (/Seitennummer ist höher/i.test(msg)) return "Die angeforderte Seite liegt hinter dem Ende der Trefferliste (kleinere `seite` wählen).";
  return msg.replace(/^soap:Client\.?\s*/, "").slice(0, 400);
}
