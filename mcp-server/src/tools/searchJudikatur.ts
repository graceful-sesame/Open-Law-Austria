import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JUDIKATUR_APPS, JUDIKATUR_APP_NAMES } from "../ris/applications.js";
import type { RisClient } from "../ris/client.js";
import { RisError } from "../ris/errors.js";
import {
  SEARCH_SYNTAX_HELP,
  bundeslandParams,
  bundeslandSchema,
  datumSchema,
  filterSummary,
  formatJudikaturHits,
  mergeExtraParams,
  noHitsText,
  normalizeDate,
  pagingFooter,
  pagingParams,
  proSeiteSchema,
  resultHeader,
  safely,
  seiteSchema,
  sortParams,
  sortierungSchema,
  textResult,
  weitereParameterSchema,
} from "./common.js";

const APP_OVERVIEW = JUDIKATUR_APP_NAMES.map((n) => `${n} = ${JUDIKATUR_APPS[n].label}`).join("; ");

export const searchJudikaturShape = {
  applikation: z
    .enum(JUDIKATUR_APP_NAMES)
    .default("Justiz")
    .describe(`Gericht/Behörde (RIS-Applikation). ${APP_OVERVIEW}.`),
  suchworte: z.string().max(500).optional().describe("Volltext-Suchworte (siehe Suchlogik in der Tool-Beschreibung)."),
  dokumenttyp: z
    .enum(["alle", "rechtssatz", "entscheidungstext"])
    .default("alle")
    .describe(
      "Rechtssätze (RS, verdichtete Leitsätze mit Verweis auf alle Folgeentscheidungen) und/oder Entscheidungstexte (Volltexte). " +
        "Standard \"alle\". Hinweis: Die API selbst sucht ohne Angabe nur in Rechtssätzen.",
    ),
  gericht: z
    .string()
    .max(100)
    .optional()
    .describe('Nur Applikation Justiz: Gericht, z. B. "OGH", "OLG Wien", "LG für Strafsachen Wien".'),
  geschaeftszahl: z.string().max(100).optional().describe('Geschäftszahl, z. B. "15 Os 149/25p" oder "Ra 2020/01/0001".'),
  norm: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Normzitat im RIS-Format "<Gesetz> §<Nr>" oder "§ <Nr> <Gesetz>", z. B. "StGB §288", "StGB §288 Abs4", "EU-JZG §55e", "B-VG Art7". ' +
        "ACHTUNG Justiz: Normen sind dort nur bei Rechtssätzen erfasst – Entscheidungstexte findet der Norm-Filter nicht; " +
        'dafür zusätzlich mit suchworte (z. B. "\"§ 288\" StGB") suchen.',
    ),
  rechtssatznummer: z.string().max(30).optional().describe('Nur Justiz: Rechtssatznummer, z. B. "RS0142801".'),
  entscheidungsdatum_von: datumSchema.optional(),
  entscheidungsdatum_bis: datumSchema.optional(),
  bundesland: bundeslandSchema.optional().describe("Nur Lvwg/Uvs: Bundesland des Verwaltungsgerichts/-senats."),
  entscheidungsart: z
    .string()
    .max(100)
    .optional()
    .describe(
      'Entscheidungsart, je nach Applikation z. B. "Erkenntnis", "Beschluss" (VfGH/VwGH/BVwG/LVwG) oder ' +
        '"Ordentliche Erledigung (Sachentscheidung)", "Verstärkter Senat" (Justiz).',
    ),
  index: z.string().max(100).optional().describe('Nur Vfgh/Vwgh/Uvs/Ubas/Normenliste: Index (Sachgebiet), z. B. "41/02".'),
  sammlungsnummer: z.string().max(50).optional().describe("Nur Vfgh/Vwgh/Uvs: Sammlungsnummer (VfSlg/VwSlg)."),
  sortierung: sortierungSchema,
  weitere_parameter: weitereParameterSchema,
  seite: seiteSchema,
  pro_seite: proSeiteSchema,
};

type Args = z.infer<z.ZodObject<typeof searchJudikaturShape>>;

export function buildJudikaturParams(a: Args): Record<string, string> {
  const app = JUDIKATUR_APPS[a.applikation];
  const p: Record<string, string> = {};
  if (a.suchworte) p.Suchworte = a.suchworte;
  if (app.params.includes("Dokumenttyp.SucheInRechtssaetzen")) {
    // Checkbox-Semantik der API: schon die Anwesenheit des Parameters zählt als "true".
    if (a.dokumenttyp !== "entscheidungstext") p["Dokumenttyp.SucheInRechtssaetzen"] = "True";
    if (a.dokumenttyp !== "rechtssatz") p["Dokumenttyp.SucheInEntscheidungstexten"] = "True";
  } else if (a.dokumenttyp !== "alle") {
    throw new RisError("invalid_params", `Applikation ${app.name} unterscheidet nicht zwischen Rechtssätzen und Entscheidungstexten.`);
  }
  const optional: Array<[string | undefined, string, string]> = [
    [a.gericht, "Gericht", "gericht"],
    [a.geschaeftszahl, "Geschaeftszahl", "geschaeftszahl"],
    [a.norm, "Norm", "norm"],
    [a.rechtssatznummer, "Rechtssatznummer", "rechtssatznummer"],
    [a.entscheidungsart, "Entscheidungsart", "entscheidungsart"],
    [a.index, "Index", "index"],
    [a.sammlungsnummer, "Sammlungsnummer", "sammlungsnummer"],
    [normalizeDate(a.entscheidungsdatum_von, "entscheidungsdatum_von"), "EntscheidungsdatumVon", "entscheidungsdatum_von"],
    [normalizeDate(a.entscheidungsdatum_bis, "entscheidungsdatum_bis"), "EntscheidungsdatumBis", "entscheidungsdatum_bis"],
  ];
  for (const [value, apiName, argName] of optional) {
    if (!value) continue;
    if (!app.params.includes(apiName)) {
      throw new RisError("invalid_params", `Parameter "${argName}" wird von Applikation ${app.name} nicht unterstützt.`);
    }
    p[apiName] = value;
  }
  if (a.bundesland) Object.assign(p, bundeslandParams(app, [a.bundesland]));
  Object.assign(p, sortParams(a.sortierung), pagingParams(a.seite, a.pro_seite));
  mergeExtraParams(p, a.weitere_parameter);
  const searchable = Object.keys(p).filter(
    (k) => !k.startsWith("Dokumenttyp.") && !k.startsWith("Sortierung.") && k !== "DokumenteProSeite" && k !== "Seitennummer",
  );
  if (searchable.length === 0) {
    throw new RisError(
      "invalid_params",
      "Bitte mindestens ein Suchkriterium angeben (suchworte, norm, geschaeftszahl, Datum …).",
      "Ein Abruf ohne Kriterien entspräche einem Massendownload und ist nicht vorgesehen.",
    );
  }
  return p;
}

export function registerSearchJudikatur(server: McpServer, client: RisClient): void {
  server.registerTool(
    "search_judikatur",
    {
      title: "RIS: Judikatur durchsuchen",
      description:
        "Durchsucht die österreichische Rechtsprechung im RIS (OGH und Justiz, VfGH, VwGH, BVwG, LVwG, DSB, GBK und weitere). " +
        "Liefert eine kompakte Trefferliste (Typ, Gericht, Datum, GZ, RS-Nummer, ECLI, Normen, Kurzinfo, Dokument-ID, Link) " +
        "und die Gesamttrefferzahl, aber keine Volltexte. Volltexte gezielt mit get_dokument(dokument_id) abrufen. " +
        SEARCH_SYNTAX_HELP +
        " Tipp: Bei Justiz, VfGH und VwGH zuerst Rechtssätze suchen (dokumenttyp=\"rechtssatz\"), weil sie die " +
        "Kernaussage bündeln und auf alle Folgeentscheidungen verweisen. Bei Justiz erfasst der Filter `norm` nur Rechtssätze; " +
        "Entscheidungstexte dort über suchworte suchen (Phrase wie \"\\\"§ 288\\\" StGB\" funktioniert).",
      inputSchema: searchJudikaturShape,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (args, extra) =>
      safely(extra, async (signal) => {
        const a = args as Args;
        const app = JUDIKATUR_APPS[a.applikation];
        const params = buildJudikaturParams(a);
        const res = await client.search(app, params, signal);
        const filters = filterSummary({
          applikation: a.applikation,
          suchworte: a.suchworte,
          dokumenttyp: app.params.includes("Dokumenttyp.SucheInRechtssaetzen") ? a.dokumenttyp : undefined,
          gericht: a.gericht,
          geschaeftszahl: a.geschaeftszahl,
          norm: a.norm,
          rechtssatznummer: a.rechtssatznummer,
          von: a.entscheidungsdatum_von,
          bis: a.entscheidungsdatum_bis,
          bundesland: a.bundesland,
          entscheidungsart: a.entscheidungsart,
          index: a.index,
          weitere: a.weitere_parameter ? JSON.stringify(a.weitere_parameter) : undefined,
        });
        const justizNormHint =
          a.applikation === "Justiz" && a.norm && a.dokumenttyp !== "rechtssatz"
            ? `Hinweis: Bei Justiz sind Normen nur bei Rechtssätzen erfasst – Entscheidungstexte fehlen in diesem Ergebnis. ` +
              `Für Entscheidungstexte zusätzlich ohne norm suchen, z. B. suchworte='"${a.norm.replace(/^(.*?)\s*§\s*(\S+).*$/, "§ $2")}" ${(a.norm.split(/\s*§/)[0] ?? "").trim()}'.`
            : "";
        if (res.total === 0 || res.hits.length === 0) {
          return textResult(
            [noHitsText(`Judikatur (${app.label})`, filters, [], res, a.seite), justizNormHint].filter(Boolean).join("\n"),
          );
        }
        const offset = ((a.seite ?? 1) - 1) * (res.pageSize || res.hits.length);
        const body = formatJudikaturHits(client, app, res.hits, offset);
        return textResult(
          [resultHeader(`Judikatur (${app.label})`, res, a.seite, filters), justizNormHint, "", body, "", pagingFooter(res, a.seite)]
            .filter((x, i) => x !== "" || i === 2 || i === 4)
            .join("\n"),
        );
      }),
  );
}
