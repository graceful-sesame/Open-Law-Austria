import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ATTRIBUTION } from "../config.js";
import { BUNDESLAENDER, PAGE_SIZES, bundeslandAscii, type AppInfo, type Bundesland, type PageSize } from "../ris/applications.js";
import { documentLink } from "../ris/documentId.js";
import { RisError, isRisError } from "../ris/errors.js";
import { getList, getStr, type SearchHit, type SearchResult } from "../ris/normalize.js";
import type { RisClient } from "../ris/client.js";

// ───────────────────────────── Gemeinsame Beschreibungstexte ─────────────────────────────

export const SEARCH_SYNTAX_HELP =
  "SUCHLOGIK (wichtig): Die RIS-Suche ist eine reine Schlagwort-/Volltextsuche, KEINE semantische Suche und KEINE " +
  "Grundformreduktion. Mehrere Wörter werden mit UND verknüpft (alle müssen vorkommen). Unterstützt: ODER, NICHT, " +
  'Phrasen in Anführungszeichen ("falsche Beweisaussage") und GENAU EIN Platzhalter * pro Wort (z. B. Vernehm*, ' +
  "Ermittl*anordnung). Ohne * wird nur die exakte Wortform gefunden (\"Ermittlungsanordnung\" findet nicht " +
  '"Ermittlungsanordnungen"). STRATEGIE: wenige Kernbegriffe, Wortstämme mit *, und bei wenigen/keinen Treffern ' +
  "mehrere Varianten nacheinander probieren (Synonyme, Abkürzungen, Fachbegriffe, alte und neue Terminologie, " +
  "ODER-Verknüpfung). Für Normbezüge ist der Filter `norm` meist präziser als Suchworte.";

// ───────────────────────────── Gemeinsame Schemas ─────────────────────────────

export const datumSchema = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4})$/, "Datum als JJJJ-MM-TT oder TT.MM.JJJJ")
  .describe("Datum als JJJJ-MM-TT (oder TT.MM.JJJJ)");

export const seiteSchema = z.number().int().min(1).max(1000).optional().describe("Ergebnisseite (ab 1). Standard 1.");

export const proSeiteSchema = z
  .union([z.literal(10), z.literal(20), z.literal(50), z.literal(100)])
  .optional()
  .describe("Treffer pro Seite: 10, 20, 50 oder 100. Standard 20 (kompakt halten!).");

export const bundeslandSchema = z.enum(BUNDESLAENDER);

export const weitereParameterSchema = z
  .record(z.string(), z.string())
  .optional()
  .describe(
    "Optionale zusätzliche RIS-API-Parameter (exakter API-Name → Wert), z. B. {\"Fachgebiet\": \"Wirtschaftsstrafsachen\"} " +
      "oder {\"ImRisSeit\": \"EinemMonat\"}. Unzulässige Namen werden mit Liste der erlaubten Parameter abgelehnt.",
  );

export const sortierungSchema = z
  .object({
    spalte: z.string().describe('API-Sortierspalte, z. B. "Datum", "Geschaeftszahl", "ArtikelParagraphAnlage", "Kundmachungsdatum"'),
    richtung: z.enum(["aufsteigend", "absteigend"]).default("absteigend"),
  })
  .optional()
  .describe("Optionale Sortierung. Ohne Angabe gilt die RIS-Standardsortierung.");

// ───────────────────────────── Hilfsfunktionen ─────────────────────────────

/** TT.MM.JJJJ → JJJJ-MM-TT, prüft Kalenderdatum. */
export function normalizeDate(input: string | undefined, field: string): string | undefined {
  if (!input) return undefined;
  let iso = input.trim();
  const de = iso.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (de) iso = `${de[3]}-${de[2]!.padStart(2, "0")}-${de[1]!.padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) {
    throw new RisError("invalid_params", `Ungültiges Datum für ${field}: "${input}".`, "Format JJJJ-MM-TT, z. B. 2024-03-01.");
  }
  return iso;
}

export function todayVienna(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function pagingParams(seite?: number, proSeite?: PageSize): Record<string, string> {
  const p: Record<string, string> = { DokumenteProSeite: PAGE_SIZES[proSeite ?? 20] };
  if (seite && seite > 1) p.Seitennummer = String(seite);
  return p;
}

export function sortParams(s?: { spalte: string; richtung: "aufsteigend" | "absteigend" }): Record<string, string> {
  if (!s) return {};
  return {
    "Sortierung.SortedByColumn": s.spalte,
    "Sortierung.SortDirection": s.richtung === "aufsteigend" ? "Ascending" : "Descending",
  };
}

/** Bundesland-Filter im jeweils von der Applikation erwarteten Format. */
export function bundeslandParams(app: AppInfo, laender: Bundesland[] | undefined): Record<string, string> {
  if (!laender || laender.length === 0) return {};
  switch (app.bundesland) {
    case "checkbox": {
      const out: Record<string, string> = {};
      for (const b of laender) out[`Bundesland.SucheIn${bundeslandAscii(b)}`] = "True";
      return out;
    }
    case "ascii":
    case "umlaut": {
      if (laender.length > 1) {
        throw new RisError("invalid_params", `${app.name} erlaubt nur ein Bundesland pro Suche.`);
      }
      const b = laender[0]!;
      return { Bundesland: app.bundesland === "ascii" ? bundeslandAscii(b) : b };
    }
    default:
      throw new RisError("invalid_params", `Applikation ${app.name} kennt keinen Bundesland-Filter.`);
  }
}

export function truncate(s: string | undefined, max: number): string {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}

/** Liste kompakt: erste n Einträge + "(+k weitere)". */
export function compactList(items: string[], n: number): string {
  if (items.length <= n) return items.join("; ");
  return `${items.slice(0, n).join("; ")} (+${items.length - n} weitere)`;
}

function isPlaceholder(s: string | undefined): boolean {
  return !s || /^Auswertung in Arbeit/i.test(s);
}

export function hitLink(client: RisClient, app: AppInfo, hit: SearchHit): string {
  return documentLink(client.config.linkBase, app, hit.id);
}

export function resultHeader(label: string, res: SearchResult, seite: number | undefined, filters: string[]): string {
  const page = res.page || seite || 1;
  const size = res.pageSize || res.hits.length || 1;
  const pages = Math.max(1, Math.ceil(res.total / size));
  const lines = [`RIS ${label}: ${res.total} Treffer${res.total ? ` · Seite ${page}/${pages} (${size} pro Seite)` : ""}`];
  if (filters.length) lines.push(`Filter: ${filters.join(" · ")}`);
  return lines.join("\n");
}

export function pagingFooter(res: SearchResult, seite: number | undefined): string {
  const page = res.page || seite || 1;
  const size = res.pageSize || res.hits.length || 1;
  if (page * size < res.total) return `Weitere Treffer: gleiche Suche mit seite=${page + 1}.`;
  return "";
}

// ───────────────────────────── Trefferformatierung ─────────────────────────────

/** Formatiert eine Trefferliste; wiederholte Normen/Kurzinfos werden als Verweis "wie [n]" ausgegeben. */
export function formatJudikaturHits(client: RisClient, app: AppInfo, hits: SearchHit[], offset: number): string {
  const seen = new Map<string, number>();
  return hits.map((h, i) => formatJudikaturHit(client, app, h, offset + i + 1, seen)).join("\n\n");
}

export function formatJudikaturHit(
  client: RisClient,
  app: AppInfo,
  hit: SearchHit,
  nr: number,
  seen: Map<string, number> = new Map(),
): string {
  const m = hit.meta;
  const typRaw = getStr(m, "Dokumenttyp");
  const typ = typRaw === "Text" ? "Entscheidungstext" : typRaw;
  const gericht = getStr(m, "Gericht", "Kommission", "EntscheidendeBehoerde", "Organ") ?? app.label;
  const datum = getStr(m, "Entscheidungsdatum") ?? "";
  const gz = getList(m, "Geschaeftszahl").flatMap((g) => g.split(/;\s*/)).filter(Boolean);
  const rs = getList(m, "Rechtssatznummern").concat(getList(m, "Rechtssatznummer"));
  const ecli = getStr(m, "EuropeanCaseLawIdentifier");
  const normen = getList(m, "Normen").filter((n) => !isPlaceholder(n));
  const gbk = [getStr(m, "Diskriminierungsgrund"), getStr(m, "Diskriminierungstatbestand")].filter(Boolean).join(" – ");
  const kurz = [getStr(m, "Leitsatz"), getStr(m, "Kurzinformation"), getStr(m, "Schlagworte"), getStr(m, "Titel"), gbk].find(
    (s) => !isPlaceholder(s),
  );

  const rsLabel = rs.map((r) => (/^\d+$/.test(r) ? `RS-Nr. ${r}` : r)).join(", ");
  const head = [typ, gericht, datum, rsLabel || undefined].filter(Boolean).join(" · ");
  const lines = [`[${nr}] ${head}`];
  if (gz.length) {
    lines.push(
      `    GZ: ${compactList(gz, 3)}${typ === "Rechtssatz" && gz.length > 1 ? ` – Rechtssatz in ${gz.length} Entscheidungen` : ""}`,
    );
  }
  if (ecli) lines.push(`    ${ecli}`);
  const once = (label: string, value: string) => {
    const key = `${label}\u0000${value}`;
    const first = seen.get(key);
    if (first !== undefined) lines.push(`    ${label}: wie [${first}]`);
    else {
      seen.set(key, nr);
      lines.push(`    ${label}: ${value}`);
    }
  };
  if (normen.length) once("Normen", compactList(normen, 5));
  const entscheidungsart = getStr(m, "Entscheidungsart");
  if (entscheidungsart && entscheidungsart !== "Undefined") lines.push(`    Art: ${entscheidungsart}`);
  if (kurz) once("Kurzinfo", truncate(kurz, 300));
  const fundstelle = getStr(m, "Fundstelle");
  if (fundstelle) lines.push(`    Fundstelle: ${truncate(fundstelle, 160)}`);
  if (hit.entscheidungstexte.length) {
    const et = hit.entscheidungstexte.slice(0, 3).map((e) => `${e.geschaeftszahl} (${e.datum}) [${e.id}]`);
    const more = hit.entscheidungstexte.length > 3 ? ` (+${hit.entscheidungstexte.length - 3} weitere)` : "";
    lines.push(`    Entscheidungstexte: ${et.join("; ")}${more}`);
  }
  lines.push(`    ID: ${hit.id} · ${hitLink(client, app, hit)}`);
  return lines.join("\n");
}

/** Formatierung für konsolidierte Normen (BrKons, LrKons). */
export function formatNormHit(client: RisClient, app: AppInfo, hit: SearchHit, nr: number): string {
  const m = hit.meta;
  const para = getStr(m, "ArtikelParagraphAnlage") ?? "";
  const abk = getStr(m, "Abkuerzung");
  const kurztitel = getStr(m, "Kurztitel") ?? getStr(m, "Titel") ?? "";
  const label = [para && para !== "§ 0" ? para : "", abk].filter(Boolean).join(" ");
  const lines = [`[${nr}] ${label ? `${label} – ` : ""}${truncate(kurztitel, 160)}`];
  const ikra = getStr(m, "Inkrafttretensdatum");
  const akra = getStr(m, "Ausserkrafttretensdatum");
  const geltung = ikra ? `in Kraft ${ikra}${akra ? ` bis ${akra}` : " (kein Außerkrafttreten)"}` : "";
  const meta2 = [
    geltung,
    getStr(m, "Bundesland"),
    getStr(m, "Typ") ? `Typ ${getStr(m, "Typ")}` : "",
    getStr(m, "Gesetzesnummer") ? `Gesetzesnummer ${getStr(m, "Gesetzesnummer")}` : "",
  ].filter(Boolean);
  if (meta2.length) lines.push(`    ${meta2.join(" · ")}`);
  const km = getStr(m, "Kundmachungsorgan");
  if (km) lines.push(`    Kundmachungsorgan: ${truncate(km, 200)}`);
  lines.push(`    ID: ${hit.id} · ${hitLink(client, app, hit)}`);
  return lines.join("\n");
}

const GENERIC_FIELDS: Array<[string, string]> = [
  ["Bgblnummer", "BGBl"],
  ["Lgblnummer", "LGBl"],
  ["Fundstelle", "Fundstelle"],
  ["Kundmachungsorgan", "Kundmachungsorgan"],
  ["KundmachungsorganNr", "Kundmachung"],
  ["Kundmachungsnummer", "Nr."],
  ["Avsvnummer", "Nr."],
  ["Avnnummer", "Nr."],
  ["Spgnummer", "Nr."],
  ["Gliederungszahl", "Gliederungszahl"],
  ["Typ", "Typ"],
  ["Dokumentart", "Art"],
  ["Bundesland", "Bundesland"],
  ["Bezirk", "Bezirk"],
  ["Gemeinde", "Gemeinde"],
  ["Bezirksverwaltungsbehoerde", "Behörde"],
  ["Gericht", "Gericht"],
  ["Bundesministerium", "Ministerium"],
  ["EinbringendeStelle", "Einbringer"],
  ["Urheber", "Urheber"],
  ["Partei", "Partei"],
  ["GZ", "GZ"],
  ["Geschaeftszahl", "GZ"],
  ["Ausgabedatum", "Ausgabe"],
  ["Kundmachungsdatum", "Kundmachung"],
  ["Inkrafttretensdatum", "In Kraft"],
  ["Ausserkrafttretensdatum", "Außer Kraft"],
  ["Beschlussdatum", "Beschluss"],
  ["BeginnBegutachtungsfrist", "Begutachtung ab"],
  ["EndeBegutachtungsfrist", "Begutachtung bis"],
  ["Sitzungsdatum", "Sitzung"],
  ["Sitzungsnummer", "Sitzungsnr."],
  ["Entscheidungsdatum", "Entscheidung"],
  ["Source", "Source"],
];

/** Generische Formatierung (BGBl, LGBl, Gemeinden, Sonstige …). */
export function formatGenericHit(client: RisClient, app: AppInfo, hit: SearchHit, nr: number): string {
  const m = hit.meta;
  const fallback = [app.label, getStr(m, "Sitzungsnummer") ? `Nr. ${getStr(m, "Sitzungsnummer")}` : getStr(m, "GZ", "Geschaeftszahl"), getStr(m, "Sitzungsdatum", "Entscheidungsdatum", "Kundmachungsdatum")]
    .filter(Boolean)
    .join(" · ");
  const title = getStr(m, "Kurztitel", "Titel", "Kurzinformation", "Schlagworte") ?? fallback;
  const lines = [`[${nr}] ${truncate(title, 200)}`];
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const [key, label] of GENERIC_FIELDS) {
    const v = getStr(m, key);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    parts.push(`${label}: ${truncate(v, 120)}`);
  }
  if (parts.length) lines.push(`    ${parts.join(" · ")}`);
  const langTitel = getStr(m, "Titel");
  if (langTitel && langTitel !== title) lines.push(`    Titel: ${truncate(langTitel, 250)}`);
  const pdfOnly = hit.content.length > 0 && !hit.content.some((c) => /xml/i.test(c.dataType));
  const pdf = hit.content.find((c) => /pdf|authentisch/i.test(c.dataType));
  lines.push(`    ID: ${hit.id} · ${hitLink(client, app, hit)}${pdfOnly && pdf ? ` · nur PDF: ${pdf.url}` : ""}`);
  return lines.join("\n");
}

// ───────────────────────────── Ergebnisse ─────────────────────────────

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text: `${text.trimEnd()}\n\n${ATTRIBUTION}` }] };
}

export function errorResult(e: unknown): CallToolResult {
  let text: string;
  if (isRisError(e)) {
    const prefix =
      e.kind === "invalid_params"
        ? "Ungültige Anfrage"
        : e.kind === "not_found"
          ? "Nicht gefunden"
          : e.kind === "unavailable"
            ? "RIS derzeit nicht erreichbar"
            : "Unerwartete Antwort von RIS";
    text = `${prefix}: ${e.message}${e.hint ? `\nHinweis: ${e.hint}` : ""}`;
    if (e.kind === "unavailable") text += "\nBitte später erneut versuchen; es wurde bereits automatisch mehrfach mit Backoff wiederholt.";
  } else {
    text = `Interner Fehler: ${(e as Error)?.message ?? String(e)}`;
  }
  return { content: [{ type: "text", text }], isError: true };
}

export function noHitsText(label: string, filters: string[], extraTips: string[] = [], res?: SearchResult, seite?: number): string {
  if (res && res.total > 0 && (seite ?? 1) > 1) {
    const size = res.pageSize || 20;
    return `RIS ${label}: Seite ${seite} liegt hinter dem Ende (${res.total} Treffer, ${Math.ceil(res.total / size)} Seite(n) à ${size}).`;
  }
  return [
    `RIS ${label}: keine Treffer.`,
    filters.length ? `Filter: ${filters.join(" · ")}` : "",
    "Tipps: weniger/kürzere Suchworte, Platzhalter * (z. B. Vernehm*), Synonyme und andere Wortformen, ODER-Verknüpfung, " +
      "Datumsfilter lockern, Dokumenttyp \"alle\".",
    ...extraTips,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Gesamtbudget pro Tool-Aufruf (inkl. Warteschlange, Retries, mehrerer Requests). */
export const TOOL_TIME_BUDGET_MS = 90_000;

/**
 * Wrapper: fängt alle Fehler, liefert saubere Tool-Fehlermeldungen und stellt ein
 * AbortSignal bereit, das bei Abbruch durch den Client oder nach dem Zeitbudget feuert.
 */
export async function safely(
  extra: { signal?: AbortSignal } | undefined,
  fn: (signal: AbortSignal) => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const budget = AbortSignal.timeout(TOOL_TIME_BUDGET_MS);
  const signal = extra?.signal ? AbortSignal.any([extra.signal, budget]) : budget;
  try {
    return await fn(signal);
  } catch (e) {
    return errorResult(e);
  }
}

/** Übernimmt weitere_parameter, ohne bereits gesetzte (typisierte) Parameter zu überschreiben. */
export function mergeExtraParams(target: Record<string, string>, extra: Record<string, string> | undefined): void {
  if (!extra) return;
  for (const [k, v] of Object.entries(extra)) {
    if (k in target) {
      throw new RisError(
        "invalid_params",
        `weitere_parameter.${k} kollidiert mit einem bereits gesetzten Parameter.`,
        "Bitte das entsprechende Tool-Feld verwenden statt weitere_parameter.",
      );
    }
    target[k] = v;
  }
}

export function filterSummary(entries: Record<string, string | number | boolean | undefined | string[]>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(entries)) {
    if (v === undefined || v === "" || v === false || (Array.isArray(v) && v.length === 0)) continue;
    out.push(`${k}=${Array.isArray(v) ? v.join("+") : typeof v === "string" ? JSON.stringify(v) : String(v)}`);
  }
  return out;
}
