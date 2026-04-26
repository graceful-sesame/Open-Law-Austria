/**
 * Zentrale Konfiguration aller Collections und Gesetze.
 *
 * Gesetzesnummern (RIS BrKons):
 *   StGB  = 10002296
 *   StPO  = 10002326
 *   ABGB  = 10001622
 *   ASVG  = 10008147
 *   JN    = 10001736 (Jurisdiktionsnorm)
 *   ZPO   = 10001699
 *   MRK   = 10002425 (EMRK)
 *   B-VG  = 10000138 (Bundes-Verfassungsgesetz)
 *   StVG  = 10005770 (Verwaltungsstrafgesetz)
 *   VStG  = 10005770
 *   SPG   = 10005792
 *   JGG   = 10002825
 *
 * Hinweis: Gesetzesnummern sind nichtamtliche interne Nummern des RIS.
 * Korrekte Zuordnung basiert auf RIS-Recherche (BrKons-Abfrage nach Titel/Abkürzung).
 */

export interface LawConfig {
  id: string;          // eindeutiger Bezeichner für Routing
  gesetzesnummer: string;
  abkuerzung: string;
  title: string;
  shortDescription?: string;
}

export interface CollectionConfig {
  id: string;
  title: string;
  description: string;
  color: string;       // Tailwind accent color class
  icon: string;        // Lucide icon name
  laws: LawConfig[];
}

export const COLLECTIONS: CollectionConfig[] = [
  {
    id: "strafrecht",
    title: "Strafrecht",
    description: "Materielles Strafrecht, Strafprozessrecht, Jugendstrafrecht und Verwaltungsstrafrecht.",
    color: "red",
    icon: "Gavel",
    laws: [
      {
        id: "stgb",
        gesetzesnummer: "10002296",
        abkuerzung: "StGB",
        title: "Strafgesetzbuch",
        shortDescription: "Allgemeiner und besonderer Teil des materiellen Strafrechts.",
      },
      {
        id: "stpo",
        gesetzesnummer: "10002326",
        abkuerzung: "StPO",
        title: "Strafprozessordnung",
        shortDescription: "Verfahrensrecht für Strafverfahren.",
      },
      {
        id: "jgg",
        gesetzesnummer: "10002825",
        abkuerzung: "JGG",
        title: "Jugendgerichtsgesetz",
        shortDescription: "Strafrechtliche Sonderregelungen für Jugendliche und junge Erwachsene.",
      },
      {
        id: "vstg",
        gesetzesnummer: "10005770",
        abkuerzung: "VStG",
        title: "Verwaltungsstrafgesetz",
        shortDescription: "Allgemeines Verwaltungsstrafrecht.",
      },
    ],
  },
  {
    id: "zivilrecht",
    title: "Bürgerliches Recht",
    description: "Allgemeines bürgerliches Gesetzbuch, Zivilprozessordnung, Außerstreitgesetz.",
    color: "blue",
    icon: "BookOpen",
    laws: [
      {
        id: "abgb",
        gesetzesnummer: "10001622",
        abkuerzung: "ABGB",
        title: "Allgemeines bürgerliches Gesetzbuch",
        shortDescription: "Das österreichische Zivilgesetzbuch (1811).",
      },
      {
        id: "zpo",
        gesetzesnummer: "10001699",
        abkuerzung: "ZPO",
        title: "Zivilprozessordnung",
        shortDescription: "Verfahrensrecht für zivilrechtliche Streitigkeiten.",
      },
      {
        id: "jn",
        gesetzesnummer: "10001736",
        abkuerzung: "JN",
        title: "Jurisdiktionsnorm",
        shortDescription: "Zuständigkeit und Organisation der ordentlichen Gerichte.",
      },
    ],
  },
  {
    id: "verfassungsrecht",
    title: "Verfassungsrecht",
    description: "Bundesverfassung, Grundrechte und Menschenrechtskonvention.",
    color: "amber",
    icon: "Shield",
    laws: [
      {
        id: "bvg",
        gesetzesnummer: "10000138",
        abkuerzung: "B-VG",
        title: "Bundes-Verfassungsgesetz",
        shortDescription: "Grundlegendes Verfassungsgesetz der Republik Österreich.",
      },
      {
        id: "mrk",
        gesetzesnummer: "10002425",
        abkuerzung: "MRK",
        title: "Europäische Menschenrechtskonvention",
        shortDescription: "EMRK – Grundrechte und Freiheiten im Verfassungsrang.",
      },
    ],
  },
  {
    id: "sicherheitsrecht",
    title: "Sicherheitsrecht",
    description: "Polizeirecht, Sicherheitspolizeigesetz, Grenzkontrolle.",
    color: "green",
    icon: "ShieldCheck",
    laws: [
      {
        id: "spg",
        gesetzesnummer: "10005792",
        abkuerzung: "SPG",
        title: "Sicherheitspolizeigesetz",
        shortDescription: "Aufgaben und Befugnisse der Sicherheitsbehörden.",
      },
    ],
  },
];

// Hilfsfunktionen
export function getCollectionById(id: string): CollectionConfig | undefined {
  return COLLECTIONS.find((c) => c.id === id);
}

export function getLawById(lawId: string): { law: LawConfig; collection: CollectionConfig } | undefined {
  for (const collection of COLLECTIONS) {
    const law = collection.laws.find((l) => l.id === lawId);
    if (law) return { law, collection };
  }
  return undefined;
}

export function getLawByGesetzesnummer(gesetzesnummer: string): { law: LawConfig; collection: CollectionConfig } | undefined {
  for (const collection of COLLECTIONS) {
    const law = collection.laws.find((l) => l.gesetzesnummer === gesetzesnummer);
    if (law) return { law, collection };
  }
  return undefined;
}

export function getAllLaws(): Array<LawConfig & { collection: CollectionConfig }> {
  return COLLECTIONS.flatMap((c) => c.laws.map((l) => ({ ...l, collection: c })));
}
