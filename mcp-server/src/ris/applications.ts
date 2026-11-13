/**
 * Katalog aller RIS-OGD-Applikationen (API v2.6).
 *
 * Die Parameterlisten stammen aus den offiziellen Beispielformularen
 * (https://data.bka.gv.at/ris/api/v2.6/Content/Examples.zip). Die API ignoriert
 * unbekannte Parameter stillschweigend – deshalb wird jeder Parameter vor dem
 * Request gegen diese Whitelist geprüft.
 */

export type Endpoint = "Judikatur" | "Bundesrecht" | "Landesrecht" | "Gemeinden" | "Bezirke" | "Sonstige";

/** Wie eine Applikation das Bundesland erwartet. */
export type BundeslandStyle = "none" | "checkbox" | "ascii" | "umlaut";

export interface AppInfo {
  /** Wert für den Parameter `Applikation`. */
  name: string;
  endpoint: Endpoint;
  /** Anzeigename. */
  label: string;
  /** Ordner unter https://ogd.ris.bka.gv.at/Dokumente/ und `Abfrage` für Links. */
  folder: string;
  /** Erlaubte Request-Parameter (zusätzlich zu Applikation). */
  params: readonly string[];
  bundesland: BundeslandStyle;
}

const PAGING = ["DokumenteProSeite", "Seitennummer", "Sortierung.SortedByColumn", "Sortierung.SortDirection"] as const;
const JUD_BASE = [
  "Suchworte",
  "Dokumenttyp.SucheInRechtssaetzen",
  "Dokumenttyp.SucheInEntscheidungstexten",
  "Geschaeftszahl",
  "Norm",
  "EntscheidungsdatumVon",
  "EntscheidungsdatumBis",
  "ImRisSeit",
  ...PAGING,
] as const;
const FASSUNG = [
  "Fassung.FassungVom",
  "Fassung.VonInkrafttretensdatum",
  "Fassung.BisInkrafttretensdatum",
  "Fassung.VonAusserkrafttretensdatum",
  "Fassung.BisAusserkrafttretensdatum",
] as const;
const BL_CHECKBOX = [
  "Bundesland.SucheInBurgenland",
  "Bundesland.SucheInKaernten",
  "Bundesland.SucheInNiederoesterreich",
  "Bundesland.SucheInOberoesterreich",
  "Bundesland.SucheInSalzburg",
  "Bundesland.SucheInSteiermark",
  "Bundesland.SucheInTirol",
  "Bundesland.SucheInVorarlberg",
  "Bundesland.SucheInWien",
] as const;
const TYP_CHECKBOX = ["Typ.SucheInGesetzen", "Typ.SucheInKundmachungen", "Typ.SucheInVerordnungen", "Typ.SucheInSonstiges"] as const;

function app(
  name: string,
  endpoint: Endpoint,
  label: string,
  params: readonly string[],
  opts: { folder?: string; bundesland?: BundeslandStyle } = {},
): AppInfo {
  return { name, endpoint, label, params, folder: opts.folder ?? name, bundesland: opts.bundesland ?? "none" };
}

export const JUDIKATUR_APPS = {
  Justiz: app("Justiz", "Judikatur", "Justiz (OGH, OLG, LG, BG)", [
    ...JUD_BASE,
    "Rechtsgebiet",
    "Fachgebiet",
    "Gericht",
    "Rechtssatznummer",
    "Spruch",
    "RechtlicheBeurteilung",
    "Fundstelle",
    "Entscheidungsart",
    "AenderungenSeit.Periode",
  ]),
  Vfgh: app("Vfgh", "Judikatur", "Verfassungsgerichtshof (VfGH)", [...JUD_BASE, "Entscheidungsart", "Index", "Sammlungsnummer"]),
  Vwgh: app("Vwgh", "Judikatur", "Verwaltungsgerichtshof (VwGH)", [...JUD_BASE, "Entscheidungsart", "Index", "Sammlungsnummer"]),
  Bvwg: app("Bvwg", "Judikatur", "Bundesverwaltungsgericht (BVwG)", [...JUD_BASE, "Entscheidungsart"]),
  Lvwg: app("Lvwg", "Judikatur", "Landesverwaltungsgerichte (LVwG)", [...JUD_BASE, "Entscheidungsart", "Bundesland"], {
    bundesland: "ascii",
  }),
  Dsk: app("Dsk", "Judikatur", "Datenschutzbehörde / Datenschutzkommission", [
    ...JUD_BASE,
    "Entscheidungsart",
    "EntscheidendeBehoerde",
  ]),
  Gbk: app("Gbk", "Judikatur", "Gleichbehandlungskommissionen", [
    ...JUD_BASE,
    "Entscheidungsart",
    "Kommission",
    "Senat",
    "Diskriminierungsgrund",
  ]),
  Dok: app("Dok", "Judikatur", "Disziplinarkommissionen/-behörden (Bundesdienst)", [...JUD_BASE, "EntscheidendeBehoerde"]),
  Pvak: app("Pvak", "Judikatur", "Personalvertretungsaufsicht", [...JUD_BASE, "EntscheidendeBehoerde"]),
  AsylGH: app("AsylGH", "Judikatur", "Asylgerichtshof (bis 2013)", [...JUD_BASE, "Entscheidungsart"]),
  Uvs: app("Uvs", "Judikatur", "Unabhängige Verwaltungssenate (bis 2013)", [
    ...JUD_BASE,
    "Bundesland",
    "Entscheidungsart",
    "Sammlungsnummer",
    "Index",
  ], { bundesland: "ascii" }),
  Umse: app("Umse", "Judikatur", "Umweltsenat (bis 2013)", [...JUD_BASE, "Kurzbezeichnung"]),
  Ubas: app("Ubas", "Judikatur", "Unabhängiger Bundesasylsenat (bis 2008)", [
    ...JUD_BASE,
    "Entscheidungsart",
    "Verfasser",
    "Index",
    "Spruch",
  ]),
  Verg: app("Verg", "Judikatur", "Vergabekontrollbehörden (bis 2013)", [...JUD_BASE, "EntscheidendeBehoerde", "Entscheidungsart"]),
  Bks: app("Bks", "Judikatur", "Bundeskommunikationssenat (bis 2013)", [...JUD_BASE, "Bereich"]),
  Normenliste: app("Normenliste", "Judikatur", "Normenliste des VwGH", [
    "Suchworte",
    "Titel",
    "Norm",
    "Index",
    "Typ",
    "Kundmachungsorgan",
    "ImRisSeit",
    ...PAGING,
  ]),
} as const satisfies Record<string, AppInfo>;

export const BUNDESRECHT_APPS = {
  BrKons: app("BrKons", "Bundesrecht", "Bundesrecht konsolidiert", [
    "Suchworte",
    "Titel",
    "Abschnitt.Von",
    "Abschnitt.Bis",
    "Abschnitt.Typ",
    "Kundmachungsorgan",
    "Kundmachungsorgannummer",
    "Typ",
    "Index",
    "Gesetzesnummer",
    "Unterzeichnungsdatum",
    ...FASSUNG,
    "ImRisSeit",
    ...PAGING,
  ], { folder: "Bundesnormen" }),
  BgblAuth: app("BgblAuth", "Bundesrecht", "Bundesgesetzblatt authentisch (ab 2004)", [
    "Suchworte",
    "Titel",
    "Bgblnummer",
    "Kundmachung.Periode",
    "Kundmachung.Von",
    "Kundmachung.Bis",
    "EinbringendeStelle",
    "Teil.SucheInTeil1",
    "Teil.SucheInTeil2",
    "Teil.SucheInTeil3",
    ...TYP_CHECKBOX,
    ...PAGING,
  ]),
  BgblPdf: app("BgblPdf", "Bundesrecht", "Bundesgesetzblatt 1945–2003 (PDF)", [
    "Suchworte",
    "Titel",
    "Bundesgesetzblatt",
    "Kundgemacht.Von",
    "Kundgemacht.Bis",
    ...TYP_CHECKBOX,
    "Teil.SucheInAlt",
    "Teil.SucheInTeil1",
    "Teil.SucheInTeil2",
    "Teil.SucheInTeil3",
    ...PAGING,
  ]),
  BgblAlt: app("BgblAlt", "Bundesrecht", "Staats- und Reichsgesetzblatt 1848–1940 (ALEX)", [
    "Titel",
    "Gesetzblattnummer",
    "Jahrgang",
    "Stuecknummer",
    "Kundgemacht.Von",
    "Kundgemacht.Bis",
    ...PAGING,
  ]),
  Begut: app("Begut", "Bundesrecht", "Begutachtungsentwürfe", [
    "Suchworte",
    "Titel",
    "InBegutachtungAm",
    "EinbringendeStelle",
    "ImRisSeit",
    ...PAGING,
  ]),
  RegV: app("RegV", "Bundesrecht", "Regierungsvorlagen", [
    "Suchworte",
    "Titel",
    "BeschlussdatumVon",
    "BeschlussdatumBis",
    "EinbringendeStelle",
    "ImRisSeit",
    ...PAGING,
  ]),
  Erv: app("Erv", "Bundesrecht", "Englische Übersetzungen (Austrian Laws)", ["SearchTerms", "Title", "Source", "ImRisSeit", ...PAGING]),
} as const satisfies Record<string, AppInfo>;

export const LANDESRECHT_APPS = {
  LrKons: app("LrKons", "Landesrecht", "Landesrecht konsolidiert", [
    ...BL_CHECKBOX,
    "Suchworte",
    "Titel",
    "Abschnitt.Von",
    "Abschnitt.Bis",
    "Abschnitt.Typ",
    "Kundmachungsorgan",
    "Kundmachungsorgannummer",
    "Typ",
    "Index",
    "Gesetzesnummer",
    "Unterzeichnungsdatum",
    ...FASSUNG,
    "ImRisSeit",
    ...PAGING,
  ], { folder: "Landesnormen", bundesland: "checkbox" }),
  LgblAuth: app("LgblAuth", "Landesrecht", "Landesgesetzblätter authentisch", [
    "Suchworte",
    "Titel",
    "Lgblnummer",
    ...BL_CHECKBOX,
    "Kundmachung.Periode",
    "Kundmachung.Von",
    "Kundmachung.Bis",
    ...TYP_CHECKBOX,
    ...PAGING,
  ], { bundesland: "checkbox" }),
  Lgbl: app("Lgbl", "Landesrecht", "Landesgesetzblätter (nicht authentisch)", [
    "Suchworte",
    "Titel",
    "Lgblnummer",
    ...BL_CHECKBOX.filter((p) => !p.endsWith("Niederoesterreich") && !p.endsWith("Wien")),
    "Kundmachung.Von",
    "Kundmachung.Bis",
    ...TYP_CHECKBOX,
    ...PAGING,
  ], { bundesland: "checkbox" }),
  LgblNO: app("LgblNO", "Landesrecht", "Landesgesetzblatt Niederösterreich (bis 2014)", [
    "Suchworte",
    "Titel",
    "Gliederungszahl",
    ...TYP_CHECKBOX,
    "Index",
    "FassungVom",
    "ImRisSeit.Von",
    "ImRisSeit.Bis",
    ...PAGING,
  ]),
  Vbl: app("Vbl", "Landesrecht", "Verordnungsblätter der Länder", [
    "Suchworte",
    "Titel",
    "Bundesland",
    "Einbringer",
    "Kundmachungsnummer",
    "Kundmachungsdatum.Von",
    "Kundmachungsdatum.Bis",
    "ImRisSeit",
    ...PAGING,
  ], { bundesland: "ascii" }),
} as const satisfies Record<string, AppInfo>;

export const SONSTIGE_APPS = {
  Gr: app("Gr", "Gemeinden", "Gemeinderecht", [
    "Suchworte",
    "Titel",
    "Bundesland",
    "Gemeinde",
    "Geschaeftszahl",
    "Index",
    "FassungVom",
    "ImRisSeit",
    ...PAGING,
  ], { folder: "Gemeinderecht", bundesland: "ascii" }),
  GrA: app("GrA", "Gemeinden", "Gemeinderecht authentisch (Amtsblätter)", [
    "Suchworte",
    "Titel",
    "Bundesland",
    "Bezirk",
    "Gemeinde",
    "Gemeindeverband",
    "Kundmachungsnummer",
    "Kundmachungsdatum.Von",
    "Kundmachungsdatum.Bis",
    "ImRisSeit",
    ...PAGING,
  ], { folder: "GemeinderechtAuth", bundesland: "ascii" }),
  Bvb: app("Bvb", "Bezirke", "Kundmachungen der Bezirksverwaltungsbehörden", [
    "Suchworte",
    "Titel",
    "Bundesland",
    "Bezirksverwaltungsbehoerde",
    "Kundmachungsnummer",
    "Kundmachungsdatum.Von",
    "Kundmachungsdatum.Bis",
    "ImRisSeit",
    ...PAGING,
  ], { bundesland: "umlaut" }),
  Erlaesse: app("Erlaesse", "Sonstige", "Erlässe der Bundesministerien", [
    "Suchworte",
    "Titel",
    "VonInkrafttretensdatum",
    "BisInkrafttretensdatum",
    "FassungVom",
    "Bundesministerium",
    "Abteilung",
    "Fundstelle",
    "Geschaeftszahl",
    "Norm",
    "ImRisSeit",
    ...PAGING,
  ]),
  Avsv: app("Avsv", "Sonstige", "Amtliche Verlautbarungen der Sozialversicherung", [
    "Suchworte",
    "Titel",
    "Dokumentart",
    "Urheber",
    "Kundmachung.Periode",
    "Kundmachung.Von",
    "Kundmachung.Bis",
    "Avsvnummer",
    ...PAGING,
  ]),
  Avn: app("Avn", "Sonstige", "Amtliche Veterinärnachrichten", [
    "Suchworte",
    "Titel",
    "Avnnummer",
    "Typ.SucheInKundmachungen",
    "Typ.SucheInVeroeffentlichungenAufGrundVEVO",
    "Typ.SucheInSonstigeVeroeffentlichungen",
    "FassungVom",
    "Geschaeftszahl",
    "Norm",
    "Kundmachung.Periode",
    "Kundmachung.Von",
    "Kundmachung.Bis",
    ...PAGING,
  ]),
  Spg: app("Spg", "Sonstige", "Strukturpläne Gesundheit (ÖSG/RSG)", [
    "Suchworte",
    "Titel",
    "Spgnummer",
    "OsgSuchEinschraenkung.SpgStrukturplanType",
    "RsgSuchEinschraenkung.SpgStrukturplanType",
    "RsgSuchEinschraenkung.Land",
    "Kundmachungsdatum.Von",
    "Kundmachungsdatum.Bis",
    "ImRisSeit",
    ...FASSUNG,
    ...PAGING,
  ]),
  KmGer: app("KmGer", "Sonstige", "Kundmachungen der Gerichte (Geschäftsverteilungen)", [
    "Suchworte",
    "Titel",
    "Typ",
    "Gericht",
    "Kundmachungsdatum.Von",
    "Kundmachungsdatum.Bis",
    "ImRisSeit",
    ...FASSUNG,
    ...PAGING,
  ]),
  PruefGewO: app("PruefGewO", "Sonstige", "Prüfungsordnungen nach der GewO", [
    "Suchworte",
    "Titel",
    "Typ",
    "Kundmachungsdatum.Von",
    "Kundmachungsdatum.Bis",
    "ImRisSeit",
    ...FASSUNG,
    ...PAGING,
  ]),
  Mrp: app("Mrp", "Sonstige", "Ministerratsprotokolle", [
    "Suchworte",
    "SitzungsdatumVon",
    "SitzungsdatumBis",
    "Sitzungsnummer",
    "Gesetzgebungsperiode",
    "Einbringer",
    "ImRisSeit",
    ...PAGING,
  ]),
  Upts: app("Upts", "Sonstige", "Unabhängiger Parteien-Transparenz-Senat", [
    "Suchworte",
    "EntscheidungsdatumVon",
    "EntscheidungsdatumBis",
    "Partei",
    "Geschaeftszahl",
    "Norm",
    "ImRisSeit",
    ...PAGING,
  ]),
} as const satisfies Record<string, AppInfo>;

export type JudikaturApp = keyof typeof JUDIKATUR_APPS;
export type BundesrechtApp = keyof typeof BUNDESRECHT_APPS;
export type LandesrechtApp = keyof typeof LANDESRECHT_APPS;
export type SonstigeApp = keyof typeof SONSTIGE_APPS;

export const ALL_APPS: Record<string, AppInfo> = {
  ...JUDIKATUR_APPS,
  ...BUNDESRECHT_APPS,
  ...LANDESRECHT_APPS,
  ...SONSTIGE_APPS,
};

export const JUDIKATUR_APP_NAMES = Object.keys(JUDIKATUR_APPS) as [JudikaturApp, ...JudikaturApp[]];
export const BUNDESRECHT_APP_NAMES = Object.keys(BUNDESRECHT_APPS) as [BundesrechtApp, ...BundesrechtApp[]];
export const LANDESRECHT_APP_NAMES = Object.keys(LANDESRECHT_APPS) as [LandesrechtApp, ...LandesrechtApp[]];
export const SONSTIGE_APP_NAMES = Object.keys(SONSTIGE_APPS) as [SonstigeApp, ...SonstigeApp[]];

/** Applikation anhand des Namens (case-insensitive) finden. */
export function findApp(name: string): AppInfo | undefined {
  const lower = name.toLowerCase();
  return Object.values(ALL_APPS).find((a) => a.name.toLowerCase() === lower || a.folder.toLowerCase() === lower);
}

export const BUNDESLAENDER = [
  "Burgenland",
  "Kärnten",
  "Niederösterreich",
  "Oberösterreich",
  "Salzburg",
  "Steiermark",
  "Tirol",
  "Vorarlberg",
  "Wien",
] as const;
export type Bundesland = (typeof BUNDESLAENDER)[number];

export function bundeslandAscii(b: Bundesland): string {
  return b.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue");
}

/** Prüft, ob alle Parameter für die Applikation erlaubt sind. Liefert die unerlaubten. */
export function disallowedParams(appInfo: AppInfo, params: Record<string, string>): string[] {
  const allowed = new Set(appInfo.params);
  return Object.keys(params).filter((k) => k !== "Applikation" && !allowed.has(k));
}

export const PAGE_SIZES = { 10: "Ten", 20: "Twenty", 50: "Fifty", 100: "OneHundred" } as const;
export type PageSize = keyof typeof PAGE_SIZES;
