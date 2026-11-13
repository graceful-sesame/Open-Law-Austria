import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ALL_APPS } from "../ris/applications.js";
import type { RisClient, RisDocument } from "../ris/client.js";
import { RisError } from "../ris/errors.js";
import type { DocSection } from "../ris/xmlText.js";
import { safely, textResult, truncate } from "./common.js";

/** Rubriken, die als Metadaten in den Kopf wandern (sofern kurz). */
const META_TITLES = [
  "gericht",
  "entscheidungsdatum",
  "geschäftszahl",
  "norm",
  "rechtssatznummer",
  "european case law identifier",
  "ecli",
  "dokumenttyp",
  "entscheidungsart",
  "kurztitel",
  "langtitel",
  "kundmachungsorgan",
  "typ",
  "§/artikel/anlage",
  "inkrafttretensdatum",
  "außerkrafttretensdatum",
  "abkürzung",
  "index",
  "gesetzesnummer",
  "dokumentnummer",
  "zuletzt aktualisiert am",
  "veröffentlicht",
  "geändert",
  "im ris seit",
  "bundesland",
  "schlagworte",
  "fundstelle",
  "sammlungsnummer",
  "kundmachungsdatum",
  "ausgabedatum",
  "gemeinde",
  "bezirk",
  "bundesministerium",
  "abteilung",
  "genehmigungsdatum",
  "titel",
];

export const DEFAULT_MAX_CHARS = 12000;

export const getDokumentShape = {
  dokument_id: z
    .string()
    .min(3)
    .max(160)
    .describe(
      'RIS-Dokumentnummer aus einem Suchtreffer (Feld "ID"), z. B. "JJT_20260225_OGH0002_0150OS00149_25P0000_000", ' +
        '"JJR_…" (Rechtssatz), "JFT_…" (VfGH), "JWT_…" (VwGH), "NOR40234381" (Bundesnorm). Keine URL.',
    ),
  applikation: z
    .string()
    .max(30)
    .optional()
    .describe(
      "Nur nötig, wenn die Applikation nicht aus der Dokumentnummer erkennbar ist (z. B. PruefGewO). Werte wie in den Such-Tools.",
    ),
  abschnitte: z
    .array(z.string().max(60))
    .max(10)
    .optional()
    .describe(
      'Nur bestimmte Rubriken ausgeben (Teilstring, Groß/Klein egal), z. B. ["Spruch", "Rechtliche Beurteilung"], ["Rechtssatz"] oder ["Text"]. ' +
        "Die verfügbaren Rubriken stehen in der Zeile \"Gliederung\" jeder Antwort.",
    ),
  stichwort: z
    .string()
    .min(2)
    .max(100)
    .optional()
    .describe(
      "Nur Absätze ausgeben, die alle diese Wörter enthalten (Groß/Klein egal, * als Platzhalter), jeweils mit Nachbarabsatz. " +
        'Ideal für lange Entscheidungen, z. B. stichwort="§ 288" oder "Ermittlungsanordnung*".',
    ),
  offset: z.number().int().min(0).optional().describe("Zeichen-Offset für die Fortsetzung langer Texte (aus dem Hinweis am Ende der Antwort)."),
  max_zeichen: z
    .number()
    .int()
    .min(1000)
    .max(60000)
    .optional()
    .describe(`Maximale Zeichen Volltext in dieser Antwort (Standard ${DEFAULT_MAX_CHARS}).`),
};

type Args = z.infer<z.ZodObject<typeof getDokumentShape>>;

function isMetaTitle(title: string): boolean {
  const t = title.toLowerCase().trim();
  return META_TITLES.some((m) => t === m || t.startsWith(m + " "));
}

export interface RenderedDocument {
  text: string;
  nextOffset?: number;
  totalChars: number;
}

/** Baut Kopf + (gefilterten, paginierten) Textkörper. Rein funktional → testbar. */
export function renderDocument(
  doc: Pick<RisDocument, "id" | "app" | "link" | "sections">,
  opts: {
    abschnitte?: string[];
    stichwort?: string;
    offset?: number;
    maxChars?: number;
    title?: string;
    preamble?: string[];
    /** Metadaten-Rubriken, die im Kopf weggelassen werden (Kleinbuchstaben). */
    omitMeta?: string[];
  } = {},
): RenderedDocument {
  const meta: DocSection[] = [];
  const body: DocSection[] = [];
  for (const s of doc.sections) {
    if (s.title && isMetaTitle(s.title) && s.text.length <= 1500) meta.push(s);
    else body.push(s);
  }

  let selected = body;
  if (opts.abschnitte && opts.abschnitte.length) {
    const wanted = opts.abschnitte.map((w) => w.toLowerCase());
    selected = doc.sections.filter((s) => wanted.some((w) => (s.title || "Kopf").toLowerCase().includes(w)));
    if (selected.length === 0) {
      throw new RisError(
        "invalid_params",
        `Keine Rubrik passt zu ${JSON.stringify(opts.abschnitte)}.`,
        `Verfügbare Rubriken: ${doc.sections.map((s) => s.title || "(ohne Titel)").join(", ")}`,
      );
    }
  }

  let matchInfo = "";
  let fullBody: string;
  if (opts.stichwort) {
    const { text, matches } = excerptByKeyword(selected, opts.stichwort);
    if (matches === 0) {
      throw new RisError(
        "not_found",
        `Stichwort "${opts.stichwort}" kommt im ${opts.abschnitte?.length ? "gewählten Teil des " : ""}Dokument nicht vor.`,
        "Andere Wortform oder Platzhalter * probieren (z. B. Vernehm*).",
      );
    }
    fullBody = text;
    matchInfo = `Stichwort "${opts.stichwort}": ${matches} Fundstelle(n), mit Nachbarabsätzen`;
  } else {
    fullBody = selected.map((s) => (s.title ? `## ${s.title}\n\n${s.text}` : s.text)).join("\n\n");
  }
  const totalChars = fullBody.length;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const offset = opts.offset ?? 0;
  if (offset > 0 && offset >= totalChars) {
    throw new RisError("invalid_params", `offset ${offset} liegt hinter dem Textende (${totalChars} Zeichen).`);
  }
  let end = Math.min(totalChars, offset + maxChars);
  if (end < totalChars) {
    // möglichst an Absatzgrenze schneiden
    const cut = fullBody.lastIndexOf("\n\n", end);
    if (cut > offset + maxChars * 0.6) end = cut;
  }
  const chunk = fullBody.slice(offset, end).trim();
  const nextOffset = end < totalChars ? end : undefined;

  const head: string[] = [opts.title ?? `# ${doc.id} (${doc.app.label})`, ...(opts.preamble ?? [])];
  for (const m of meta) {
    if (opts.omitMeta?.includes(m.title.toLowerCase())) continue;
    head.push(`${m.title}: ${truncate(m.text.replace(/\n+/g, "; "), 500)}`);
  }
  head.push(`Link: ${doc.link}`);
  head.push(
    `Gliederung: ${doc.sections
      .filter((s) => !meta.includes(s))
      .map((s) => `${truncate(s.title || "(ohne Titel)", 60)} (${s.text.length.toLocaleString("de-AT")} Z.)`)
      .join(" · ")}`,
  );
  if (matchInfo) head.push(matchInfo);
  head.push(
    nextOffset === undefined && offset === 0
      ? `Umfang: ${totalChars.toLocaleString("de-AT")} Zeichen (vollständig)`
      : `Ausschnitt: Zeichen ${offset.toLocaleString("de-AT")}–${end.toLocaleString("de-AT")} von ${totalChars.toLocaleString("de-AT")}`,
  );

  const parts = [head.join("\n"), "────────", chunk || "(kein Text in dieser Auswahl)"];
  if (nextOffset !== undefined) {
    const extra =
      (opts.abschnitte?.length ? `, abschnitte=${JSON.stringify(opts.abschnitte)}` : "") +
      (opts.stichwort ? `, stichwort=${JSON.stringify(opts.stichwort)}` : "");
    parts.push("────────", `Fortsetzung: get_dokument(dokument_id="${doc.id}", offset=${nextOffset}${extra})`);
  }
  if (doc.id.startsWith("JJR_") || doc.id.startsWith("JFR_") || doc.id.startsWith("JWR_")) {
    parts.push(
      "Hinweis: Zugehörige Entscheidungstexte findet search_judikatur(rechtssatznummer=… bzw. geschaeftszahl=…, dokumenttyp=\"entscheidungstext\").",
    );
  }
  return { text: parts.join("\n\n"), nextOffset, totalChars };
}

function keywordRegexes(stichwort: string): RegExp[] {
  return stichwort
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const esc = w.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[\\p{L}\\p{N}]*");
      return new RegExp(esc, "iu");
    });
}

/** Absätze mit allen Stichwörtern samt direktem Nachbarabsatz; Lücken werden mit […] markiert. */
export function excerptByKeyword(sections: DocSection[], stichwort: string): { text: string; matches: number } {
  const res = keywordRegexes(stichwort);
  const out: string[] = [];
  let matches = 0;
  for (const s of sections) {
    const blocks = s.text.split(/\n\n+/);
    const keep = new Set<number>();
    blocks.forEach((b, i) => {
      if (res.every((r) => r.test(b))) {
        matches++;
        for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < blocks.length) keep.add(j);
      }
    });
    if (keep.size === 0) continue;
    const idx = [...keep].sort((x, y) => x - y);
    const parts: string[] = [];
    let prev = -1;
    for (const i of idx) {
      if (prev !== -1 && i > prev + 1) parts.push("[…]");
      else if (prev === -1 && i > 0) parts.push("[…]");
      parts.push(blocks[i]!);
      prev = i;
    }
    if (prev < blocks.length - 1) parts.push("[…]");
    out.push((s.title ? `## ${s.title}\n\n` : "") + parts.join("\n\n"));
  }
  return { text: out.join("\n\n"), matches };
}

export function registerGetDokument(server: McpServer, client: RisClient): void {
  server.registerTool(
    "get_dokument",
    {
      title: "RIS: Dokument-Volltext abrufen",
      description:
        "Ruft den Volltext eines RIS-Dokuments (Entscheidung, Rechtssatz, Norm, Kundmachung …) als bereinigten Text ab, " +
        "mit Metadaten-Kopf (GZ, Gericht, Datum, ECLI, Normen, Link) und Gliederung. Lange Texte werden in Abschnitte " +
        `zu standardmäßig ${DEFAULT_MAX_CHARS} Zeichen geteilt; die Fortsetzung steht am Ende der Antwort (offset). ` +
        "Mit `abschnitte` lassen sich gezielt einzelne Rubriken laden (z. B. nur \"Rechtliche Beurteilung\"), mit `stichwort` nur die " +
        "einschlägigen Absätze langer Entscheidungen – beides spart Kontext. " +
        `Bekannte Applikationen: ${Object.keys(ALL_APPS).join(", ")}.`,
      inputSchema: getDokumentShape,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (args) =>
      safely(async () => {
        const a = args as Args;
        const doc = await client.getDocument(a.dokument_id, a.applikation);
        const r = renderDocument(doc, {
          abschnitte: a.abschnitte,
          stichwort: a.stichwort,
          offset: a.offset,
          maxChars: a.max_zeichen,
        });
        return textResult(r.text);
      }),
  );
}
