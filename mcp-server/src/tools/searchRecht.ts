import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  BUNDESRECHT_APPS,
  BUNDESRECHT_APP_NAMES,
  LANDESRECHT_APPS,
  LANDESRECHT_APP_NAMES,
  SONSTIGE_APPS,
  SONSTIGE_APP_NAMES,
  type AppInfo,
  type Bundesland,
} from "../ris/applications.js";
import type { RisClient } from "../ris/client.js";
import { RisError } from "../ris/errors.js";
import { getStr, type SearchResult } from "../ris/normalize.js";
import {
  SEARCH_SYNTAX_HELP,
  bundeslandParams,
  bundeslandSchema,
  datumSchema,
  filterSummary,
  formatGenericHit,
  formatNormHit,
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
  todayVienna,
  weitereParameterSchema,
} from "./common.js";
import { normalizeParagraphLabel, parseParagraph, type AbschnittTyp } from "./paragraph.js";

const KONSOLIDIERT = new Set(["BrKons", "LrKons"]);

/** Gemeinsame Felder, die je nach Applikation auf API-Parameter abgebildet werden. */
interface RechtArgs {
  suchworte?: string;
  titel?: string;
  gesetzesnummer?: string;
  paragraph?: string;
  abschnitt_typ?: AbschnittTyp;
  stichtag?: string;
  alle_fassungen?: boolean;
  nummer?: string;
  kundmachung_von?: string;
  kundmachung_bis?: string;
  bundesland?: Bundesland[];
  sortierung?: { spalte: string; richtung: "aufsteigend" | "absteigend" };
  weitere_parameter?: Record<string, string>;
  seite?: number;
  pro_seite?: 10 | 20 | 50 | 100;
}

const NUMMER_PARAM: Record<string, string> = {
  BgblAuth: "Bgblnummer",
  BgblPdf: "Bundesgesetzblatt",
  BgblAlt: "Gesetzblattnummer",
  LgblAuth: "Lgblnummer",
  Lgbl: "Lgblnummer",
  LgblNO: "Gliederungszahl",
  Vbl: "Kundmachungsnummer",
  GrA: "Kundmachungsnummer",
  Bvb: "Kundmachungsnummer",
  Avsv: "Avsvnummer",
  Avn: "Avnnummer",
  Spg: "Spgnummer",
  Mrp: "Sitzungsnummer",
  Erlaesse: "Geschaeftszahl",
  Gr: "Geschaeftszahl",
  Upts: "Geschaeftszahl",
};

function firstSupported(app: AppInfo, candidates: string[]): string | undefined {
  return candidates.find((c) => app.params.includes(c));
}

function requireParam(app: AppInfo, candidates: string[], argName: string): string {
  const p = firstSupported(app, candidates);
  if (!p) throw new RisError("invalid_params", `Parameter "${argName}" wird von Applikation ${app.name} nicht unterstützt.`);
  return p;
}

export function buildRechtParams(app: AppInfo, a: RechtArgs): { params: Record<string, string>; exact?: string } {
  const p: Record<string, string> = {};
  let exact: string | undefined;
  if (a.suchworte) p[requireParam(app, ["Suchworte", "SearchTerms"], "suchworte")] = a.suchworte;
  if (a.titel) p[requireParam(app, ["Titel", "Title"], "titel")] = a.titel;
  if (a.gesetzesnummer) p[requireParam(app, ["Gesetzesnummer"], "gesetzesnummer")] = a.gesetzesnummer;
  if (a.nummer) {
    const key = NUMMER_PARAM[app.name];
    if (!key) throw new RisError("invalid_params", `Parameter "nummer" wird von Applikation ${app.name} nicht unterstützt.`);
    p[key] = a.nummer;
  }
  if (a.paragraph) {
    requireParam(app, ["Abschnitt.Von"], "paragraph");
    const q = parseParagraph(a.paragraph, a.abschnitt_typ);
    p["Abschnitt.Von"] = q.von;
    p["Abschnitt.Bis"] = q.bis;
    p["Abschnitt.Typ"] = q.typ;
    if (q.exact && q.von !== q.bis) exact = q.exact;
  } else if (a.abschnitt_typ) {
    p[requireParam(app, ["Abschnitt.Typ"], "abschnitt_typ")] = a.abschnitt_typ;
  }

  const stichtag = normalizeDate(a.stichtag, "stichtag");
  if (KONSOLIDIERT.has(app.name)) {
    if (!a.alle_fassungen) p["Fassung.FassungVom"] = stichtag ?? todayVienna();
  } else if (stichtag) {
    p[requireParam(app, ["FassungVom", "Fassung.FassungVom"], "stichtag")] = stichtag;
  }

  const von = normalizeDate(a.kundmachung_von, "kundmachung_von");
  const bis = normalizeDate(a.kundmachung_bis, "kundmachung_bis");
  if (von) p[requireParam(app, ["Kundmachung.Von", "Kundgemacht.Von", "Kundmachungsdatum.Von", "SitzungsdatumVon", "BeschlussdatumVon", "EntscheidungsdatumVon", "VonInkrafttretensdatum"], "kundmachung_von")] = von;
  if (bis) p[requireParam(app, ["Kundmachung.Bis", "Kundgemacht.Bis", "Kundmachungsdatum.Bis", "SitzungsdatumBis", "BeschlussdatumBis", "EntscheidungsdatumBis", "BisInkrafttretensdatum"], "kundmachung_bis")] = bis;

  if (a.bundesland?.length) Object.assign(p, bundeslandParams(app, a.bundesland));
  Object.assign(p, sortParams(a.sortierung), a.weitere_parameter ?? {}, pagingParams(a.seite, a.pro_seite));

  const searchable = Object.keys(p).filter(
    (k) => !["DokumenteProSeite", "Seitennummer", "Fassung.FassungVom", "Sortierung.SortedByColumn", "Sortierung.SortDirection"].includes(k),
  );
  if (searchable.length === 0) {
    throw new RisError(
      "invalid_params",
      "Bitte mindestens ein Suchkriterium angeben (suchworte, titel, gesetzesnummer, paragraph, nummer, Datum …).",
      "Ein Abruf ohne Kriterien entspräche einem Massendownload und ist nicht vorgesehen.",
    );
  }
  return { params: p, exact };
}

async function runRechtSearch(client: RisClient, app: AppInfo, a: RechtArgs, labelPrefix: string) {
  const { params, exact } = buildRechtParams(app, a);
  let res: SearchResult = await client.search(app, params);
  let note = "";
  if (exact) {
    const before = res.hits.length;
    res = {
      ...res,
      hits: res.hits.filter((h) => normalizeParagraphLabel(getStr(h.meta, "ArtikelParagraphAnlage") ?? "") === exact),
    };
    note = `Hinweis: Die API filtert Paragraphen nur numerisch; von ${before} Treffern dieser Seite passen ${res.hits.length} exakt auf "${a.paragraph}".`;
  }
  const filters = filterSummary({
    applikation: app.name,
    suchworte: a.suchworte,
    titel: a.titel,
    gesetzesnummer: a.gesetzesnummer,
    paragraph: a.paragraph,
    nummer: a.nummer,
    stichtag: KONSOLIDIERT.has(app.name) ? (a.alle_fassungen ? "alle Fassungen" : (params["Fassung.FassungVom"] ?? "")) : a.stichtag,
    bundesland: a.bundesland,
    von: a.kundmachung_von,
    bis: a.kundmachung_bis,
    weitere: a.weitere_parameter ? JSON.stringify(a.weitere_parameter) : undefined,
  });
  const label = `${labelPrefix} (${app.label})`;
  if (res.total === 0 || res.hits.length === 0) {
    return textResult(
      [noHitsText(label, filters, KONSOLIDIERT.has(app.name) ? ["Für Gesetzesabkürzungen den Parameter `titel` verwenden (z. B. titel=\"StGB\"); ältere Fassungen über `stichtag` oder alle_fassungen=true."] : []), note]
        .filter(Boolean)
        .join("\n"),
    );
  }
  const fmt = KONSOLIDIERT.has(app.name) ? formatNormHit : formatGenericHit;
  const offset = ((a.seite ?? 1) - 1) * (res.pageSize || res.hits.length);
  const body = res.hits.map((h, i) => fmt(client, app, h, offset + i + 1)).join("\n\n");
  const tip = KONSOLIDIERT.has(app.name) ? "Normtext abrufen: get_norm(…) oder get_dokument(dokument_id=ID)." : "Volltext (falls als XML vorhanden): get_dokument(dokument_id=ID).";
  const header = [resultHeader(label, res, a.seite, filters), note].filter(Boolean).join("\n");
  return textResult([header, "", body, "", tip, pagingFooter(res, a.seite)].join("\n"));
}

// ───────────────────────────── Schemas ─────────────────────────────

const commonRechtShape = {
  suchworte: z.string().max(500).optional().describe("Volltext-Suchworte (siehe Suchlogik)."),
  titel: z
    .string()
    .max(300)
    .optional()
    .describe('Suche im Titel/Kurztitel/Abkürzung, z. B. "StGB", "Strafprozessordnung", "Bauordnung". Platzhalter * erlaubt.'),
  nummer: z
    .string()
    .max(60)
    .optional()
    .describe("Kundmachungsnummer der Applikation, z. B. BGBl-Nummer \"I Nr. 94/2026\" (BgblAuth), LGBl-Nummer (LgblAuth/Lgbl)."),
  kundmachung_von: datumSchema.optional().describe("Kundmachungs-/Ausgabedatum ab (JJJJ-MM-TT)."),
  kundmachung_bis: datumSchema.optional().describe("Kundmachungs-/Ausgabedatum bis (JJJJ-MM-TT)."),
  sortierung: sortierungSchema,
  weitere_parameter: weitereParameterSchema,
  seite: seiteSchema,
  pro_seite: proSeiteSchema,
};

const konsolidiertShape = {
  gesetzesnummer: z.string().regex(/^\d{8}$/).optional().describe("RIS-Gesetzesnummer (8-stellig, z. B. 10002296 = StGB). Präziser als titel."),
  paragraph: z
    .string()
    .max(30)
    .optional()
    .describe('Nur konsolidierte Fassungen: Paragraph/Artikel/Anlage, z. B. "288", "5a", "278-279", "Art 7", "Anlage 1".'),
  abschnitt_typ: z.enum(["Paragraph", "Artikel", "Anlage"]).optional().describe("Typ der Gliederungseinheit (sonst aus `paragraph` abgeleitet)."),
  stichtag: datumSchema
    .optional()
    .describe("Konsolidierte Fassung zu diesem Stichtag (JJJJ-MM-TT). Standard: heute. Für historische Rechtslage (Tatzeit!) angeben."),
  alle_fassungen: z.boolean().optional().describe("true = alle historischen Fassungen statt nur der am Stichtag geltenden."),
};

export const searchBundesrechtShape = {
  applikation: z
    .enum(BUNDESRECHT_APP_NAMES)
    .default("BrKons")
    .describe(BUNDESRECHT_APP_NAMES.map((n) => `${n} = ${BUNDESRECHT_APPS[n].label}`).join("; ")),
  ...commonRechtShape,
  ...konsolidiertShape,
};

export const searchLandesrechtShape = {
  applikation: z
    .enum(LANDESRECHT_APP_NAMES)
    .default("LrKons")
    .describe(LANDESRECHT_APP_NAMES.map((n) => `${n} = ${LANDESRECHT_APPS[n].label}`).join("; ")),
  bundesland: z
    .array(bundeslandSchema)
    .max(9)
    .optional()
    .describe("Bundesländer (LrKons/LgblAuth/Lgbl: mehrere möglich; Vbl: genau eines). Ohne Angabe: alle."),
  ...commonRechtShape,
  ...konsolidiertShape,
};

export const searchSonstigeShape = {
  applikation: z
    .enum(SONSTIGE_APP_NAMES)
    .describe(SONSTIGE_APP_NAMES.map((n) => `${n} = ${SONSTIGE_APPS[n].label}`).join("; ")),
  bundesland: z.array(bundeslandSchema).max(1).optional().describe("Nur Gr/GrA/Bvb: Bundesland."),
  stichtag: datumSchema.optional().describe("Fassung zum Stichtag, soweit die Applikation das unterstützt (Gr, Erlaesse, Avn …)."),
  ...commonRechtShape,
};

// ───────────────────────────── Registrierung ─────────────────────────────

export function registerSearchRecht(server: McpServer, client: RisClient): void {
  server.registerTool(
    "search_bundesrecht",
    {
      title: "RIS: Bundesrecht durchsuchen",
      description:
        "Durchsucht österreichisches Bundesrecht im RIS: konsolidierte Fassungen (BrKons, Standard) mit Stichtag, " +
        "authentisches Bundesgesetzblatt (BgblAuth), historische Gesetzblätter (BgblPdf, BgblAlt), Begutachtungsentwürfe, " +
        "Regierungsvorlagen und englische Übersetzungen. Liefert kompakte Treffer (Paragraph, Gesetz, Geltungszeitraum, " +
        "Gesetzesnummer, ID, Link), keine Volltexte. BrKons liefert standardmäßig nur die am Stichtag (Standard: heute) " +
        "geltende Fassung. Für einen konkreten Paragraphen ist get_norm meist bequemer. " +
        SEARCH_SYNTAX_HELP,
      inputSchema: searchBundesrechtShape,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (args) =>
      safely(async () => {
        const a = args as RechtArgs & { applikation: keyof typeof BUNDESRECHT_APPS };
        return runRechtSearch(client, BUNDESRECHT_APPS[a.applikation], a, "Bundesrecht");
      }),
  );

  server.registerTool(
    "search_landesrecht",
    {
      title: "RIS: Landesrecht durchsuchen",
      description:
        "Durchsucht das Landesrecht aller neun Bundesländer im RIS: konsolidierte Fassungen (LrKons, Standard) mit Stichtag, " +
        "authentische Landesgesetzblätter (LgblAuth), ältere LGBl (Lgbl, LgblNO) und Verordnungsblätter (Vbl). " +
        "Filter nach Bundesland. Kompakte Treffer ohne Volltext. " +
        SEARCH_SYNTAX_HELP,
      inputSchema: searchLandesrechtShape,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (args) =>
      safely(async () => {
        const a = args as RechtArgs & { applikation: keyof typeof LANDESRECHT_APPS };
        return runRechtSearch(client, LANDESRECHT_APPS[a.applikation], a, "Landesrecht");
      }),
  );

  server.registerTool(
    "search_sonstige",
    {
      title: "RIS: Gemeinderecht, Bezirke und sonstige Kundmachungen",
      description:
        "Durchsucht die übrigen RIS-Sammlungen: Gemeinderecht (Gr, GrA), Kundmachungen der Bezirksverwaltungsbehörden (Bvb), " +
        "Erlässe der Ministerien, Verlautbarungen der Sozialversicherung (Avsv), Veterinärnachrichten (Avn), " +
        "Strukturpläne Gesundheit (Spg), Kundmachungen/Geschäftsverteilungen der Gerichte (KmGer), Prüfungsordnungen (PruefGewO), " +
        "Ministerratsprotokolle (Mrp) und Entscheidungen des Parteien-Transparenz-Senats (Upts). " +
        SEARCH_SYNTAX_HELP,
      inputSchema: searchSonstigeShape,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (args) =>
      safely(async () => {
        const a = args as RechtArgs & { applikation: keyof typeof SONSTIGE_APPS };
        return runRechtSearch(client, SONSTIGE_APPS[a.applikation], a, "Sonstige");
      }),
  );
}
