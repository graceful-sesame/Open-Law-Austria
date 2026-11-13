import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BUNDESRECHT_APPS, LANDESRECHT_APPS, type AppInfo, type Bundesland } from "../ris/applications.js";
import type { RisClient } from "../ris/client.js";
import { RisError } from "../ris/errors.js";
import { getStr, type SearchHit } from "../ris/normalize.js";
import { bundeslandParams, bundeslandSchema, datumSchema, normalizeDate, safely, textResult, todayVienna } from "./common.js";
import { DEFAULT_MAX_CHARS, renderDocument } from "./getDokument.js";
import { normalizeParagraphLabel, parseParagraph, type AbschnittTyp } from "./paragraph.js";

export const getNormShape = {
  gesetz: z
    .string()
    .max(200)
    .optional()
    .describe('Gesetz als Abkürzung oder Titel, z. B. "StGB", "StPO", "ABGB", "B-VG", "EU-JZG", "Wiener Bauordnung". Alternativ gesetzesnummer.'),
  gesetzesnummer: z.string().regex(/^\d{8}$/).optional().describe("RIS-Gesetzesnummer (8-stellig). Eindeutiger als `gesetz`."),
  paragraph: z.string().min(1).max(30).describe('Paragraph/Artikel/Anlage, z. B. "288", "153", "5a", "Art 7", "Anlage 1".'),
  abschnitt_typ: z.enum(["Paragraph", "Artikel", "Anlage"]).optional().describe("Sonst aus `paragraph` abgeleitet (Standard Paragraph)."),
  stichtag: datumSchema.optional().describe("Fassung zu diesem Stichtag (JJJJ-MM-TT), z. B. Tatzeitpunkt. Standard: heute."),
  bundesland: bundeslandSchema.optional().describe("Für Landesgesetze: Bundesland (sucht dann im konsolidierten Landesrecht)."),
  fassungen: z.boolean().optional().describe("true = statt des Textes alle historischen Fassungen mit Geltungszeiträumen auflisten."),
  max_zeichen: z.number().int().min(1000).max(60000).optional().describe(`Maximale Zeichen Normtext (Standard ${DEFAULT_MAX_CHARS}).`),
  offset: z.number().int().min(0).optional().describe("Fortsetzung langer Normtexte."),
};

type Args = z.infer<z.ZodObject<typeof getNormShape>>;

function norm(s: string | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Bewertet, wie gut ein Treffer zum gesuchten Gesetz passt (höher = besser). */
export function lawMatchScore(hit: SearchHit, gesetz: string): number {
  const g = norm(gesetz);
  const abk = norm(getStr(hit.meta, "Abkuerzung"));
  const kurz = norm(getStr(hit.meta, "Kurztitel"));
  if (abk && abk === g) return 3;
  if (kurz && kurz === g) return 3;
  if (kurz && kurz.startsWith(g)) return 2;
  if ((abk && abk.includes(g)) || (kurz && kurz.includes(g))) return 1;
  return 0;
}

function lawLabel(hit: SearchHit): string {
  const abk = getStr(hit.meta, "Abkuerzung");
  const kurz = getStr(hit.meta, "Kurztitel") ?? "";
  return abk ? `${abk} – ${kurz}` : kurz;
}

function geltung(hit: SearchHit): string {
  const ikra = getStr(hit.meta, "Inkrafttretensdatum");
  const akra = getStr(hit.meta, "Ausserkrafttretensdatum");
  return `${ikra ?? "?"} bis ${akra ?? "(offen)"}`;
}

function toPublicUrl(u: string | undefined): string | undefined {
  return u?.replace(/^https:\/\/ogd\.ris\.bka\.gv\.at\//, "https://ris.bka.gv.at/");
}

export function registerGetNorm(server: McpServer, client: RisClient): void {
  server.registerTool(
    "get_norm",
    {
      title: "RIS: Paragraph/Artikel abrufen",
      description:
        "Liefert den Text eines bestimmten Paragraphen/Artikels aus dem konsolidierten Bundes- oder Landesrecht " +
        "(z. B. § 288 StGB, § 153 StPO, Art 7 B-VG) in der heute oder zu einem Stichtag geltenden Fassung, mit " +
        "Inkrafttretens-/Außerkrafttretensdatum, Kundmachungsorgan, Gesetzesnummer und RIS-Link. " +
        "Mit fassungen=true werden alle historischen Fassungen aufgelistet (z. B. um die Tatzeit-Fassung zu finden). " +
        "Ist das Gesetz nicht eindeutig, kommt eine Kandidatenliste mit Gesetzesnummern zurück.",
      inputSchema: getNormShape,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (args) => safely(async () => runGetNorm(client, args as Args)),
  );
}

export async function runGetNorm(client: RisClient, a: Args) {
  if (!a.gesetz && !a.gesetzesnummer) {
    throw new RisError("invalid_params", "Bitte `gesetz` (z. B. \"StGB\") oder `gesetzesnummer` angeben.");
  }
  const app: AppInfo = a.bundesland ? LANDESRECHT_APPS.LrKons : BUNDESRECHT_APPS.BrKons;
  const q = parseParagraph(a.paragraph, a.abschnitt_typ as AbschnittTyp | undefined);
  if (!q.exact) {
    throw new RisError(
      "invalid_params",
      `get_norm erwartet genau einen Paragraphen/Artikel, nicht "${a.paragraph}".`,
      "Für Bereiche search_bundesrecht(titel=…, paragraph=\"278-279\") verwenden.",
    );
  }
  const stichtag = normalizeDate(a.stichtag, "stichtag") ?? todayVienna();

  const params: Record<string, string> = {
    "Abschnitt.Von": q.von,
    "Abschnitt.Bis": q.bis,
    "Abschnitt.Typ": q.typ,
    DokumenteProSeite: "OneHundred",
  };
  if (a.gesetzesnummer) params.Gesetzesnummer = a.gesetzesnummer;
  else params.Titel = a.gesetz!;
  if (!a.fassungen) params["Fassung.FassungVom"] = stichtag;
  if (a.bundesland) Object.assign(params, bundeslandParams(app, [a.bundesland as Bundesland]));

  const res = await client.search(app, params);
  let hits = res.hits.filter((h) => normalizeParagraphLabel(getStr(h.meta, "ArtikelParagraphAnlage") ?? "") === q.exact);

  if (!a.gesetzesnummer && a.gesetz && hits.length) {
    const best = Math.max(...hits.map((h) => lawMatchScore(h, a.gesetz!)));
    if (best > 0) hits = hits.filter((h) => lawMatchScore(h, a.gesetz!) === best);
  }

  const wanted = `${q.typ === "Artikel" ? "Art." : q.typ === "Anlage" ? "Anlage" : "§"} ${q.exact ?? a.paragraph}`;
  const lawText = a.gesetzesnummer ? `Gesetzesnummer ${a.gesetzesnummer}` : `"${a.gesetz}"`;

  if (hits.length === 0) {
    const hint =
      res.total > 0
        ? `Die API fand ${res.total} Dokument(e) im Bereich, aber keines mit exakt "${wanted}".`
        : a.fassungen
          ? ""
          : `Evtl. galt die Bestimmung am ${stichtag} (noch) nicht – fassungen=true zeigt alle Fassungen.`;
    throw new RisError(
      "not_found",
      `${wanted} in ${lawText}${a.bundesland ? ` (${a.bundesland})` : ""}${a.fassungen ? "" : ` zum Stichtag ${stichtag}`} nicht gefunden.`,
      [hint, "Gesetz prüfen: search_bundesrecht/search_landesrecht(titel=…) liefert Kurztitel, Abkürzung und Gesetzesnummer."]
        .filter(Boolean)
        .join(" "),
    );
  }

  const laws = new Map<string, SearchHit[]>();
  for (const h of hits) {
    const nr = getStr(h.meta, "Gesetzesnummer") ?? h.id;
    laws.set(nr, [...(laws.get(nr) ?? []), h]);
  }
  if (laws.size > 1) {
    const lines = [...laws.entries()].map(([nr, hs]) => `- ${lawLabel(hs[0]!)} · Gesetzesnummer ${nr} · ${hs[0]!.id}`);
    return textResult(
      [
        `${wanted}: ${lawText} ist nicht eindeutig – ${laws.size} Rechtsvorschriften kommen in Frage (Auswahl der am besten passenden):`,
        ...lines,
        "",
        "Bitte erneut mit `gesetzesnummer` aufrufen.",
      ].join("\n"),
    );
  }

  const [gesetzesnummer, versions] = [...laws.entries()][0]!;
  const sorted = [...versions].sort((x, y) =>
    (getStr(x.meta, "Inkrafttretensdatum") ?? "").localeCompare(getStr(y.meta, "Inkrafttretensdatum") ?? ""),
  );

  if (a.fassungen) {
    const lines = sorted.map(
      (h, i) =>
        `[${i + 1}] ${geltung(h)} · ${getStr(h.meta, "Kundmachungsorgan") ?? ""}\n    ID: ${h.id} · ${client.config.linkBase}/Dokument.wxe?Abfrage=${app.folder}&Dokumentnummer=${h.id}`,
    );
    return textResult(
      [
        `# ${wanted} ${lawLabel(sorted[0]!)} – ${sorted.length} Fassung(en)`,
        `Gesetzesnummer: ${gesetzesnummer}`,
        "",
        ...lines,
        "",
        "Text einer Fassung: get_norm(…, stichtag=JJJJ-MM-TT) oder get_dokument(dokument_id=ID).",
      ].join("\n"),
    );
  }

  // Am Stichtag sollte genau eine Fassung gelten; sonst die zuletzt in Kraft getretene nehmen.
  const hit = sorted[sorted.length - 1]!;
  const doc = await client.getDocument(hit.id, app.name);
  const gesamt = toPublicUrl(getStr(hit.meta, "GesamteRechtsvorschriftUrl"));
  const preamble = [
    `Fassung zum Stichtag ${stichtag}: gültig ${geltung(hit)}${sorted.length > 1 ? ` (Achtung: ${sorted.length} Dokumente am Stichtag, neuestes gewählt)` : ""}`,
  ];
  if (gesamt) preamble.push(`Gesamte Rechtsvorschrift: ${gesamt}${a.stichtag ? `&FassungVom=${stichtag}` : ""}`);
  const r = renderDocument(doc, {
    title: `# ${getStr(hit.meta, "ArtikelParagraphAnlage") ?? wanted} ${lawLabel(hit)}`,
    preamble,
    omitMeta: ["kurztitel", "abkürzung", "§/artikel/anlage", "typ", "index", "zuletzt aktualisiert am", "im ris seit", "dokumentnummer", "langtitel", "bundesland"],
    maxChars: a.max_zeichen,
    offset: a.offset,
  });
  return textResult(r.text);
}
