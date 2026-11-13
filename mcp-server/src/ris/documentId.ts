import { ALL_APPS, findApp, type AppInfo } from "./applications.js";
import { RisError } from "./errors.js";

/**
 * Dokumentnummern des RIS: Buchstaben (auch Umlaute, z. B. "UPTS_…_KPÖ"),
 * Ziffern, Unterstrich, Punkt, Bindestrich. Keine Schrägstriche, keine URLs.
 */
const ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{1,150}$/u;

/** Präfix der Dokumentnummer → Applikation (laut Live-Stichproben). */
const PREFIX_RULES: Array<[RegExp, string]> = [
  [/^JJ[TR]_/, "Justiz"],
  [/^JF[TR]_/, "Vfgh"],
  [/^JW[TR]_/, "Vwgh"],
  [/^BVWG[TR]_/, "Bvwg"],
  [/^LVWG[TR]_/, "Lvwg"],
  [/^DS[BK][TR]_/, "Dsk"],
  [/^GBK_/, "Gbk"],
  [/^DK[TR]_/, "Dok"],
  [/^PVA[BK][TR]_/, "Pvak"],
  [/^ASYLGH[TR]_/, "AsylGH"],
  [/^JU[TR]_/, "Uvs"],
  [/^UMSE[TR]_/, "Umse"],
  [/^UBAS[TR]_/, "Ubas"],
  [/^VERG[TR]_/, "Verg"],
  [/^BKS[TR]_/, "Bks"],
  [/^NL\d/, "Normenliste"],
  [/^NOR\d/, "BrKons"],
  [/^BGBLA_/, "BgblAuth"],
  [/^\d{4}_\d+_\d+$/, "BgblPdf"],
  [/^BEGUT_/, "Begut"],
  [/^REGV_/, "RegV"],
  [/^ERV_/, "Erv"],
  [/^LGBLA_/, "LgblAuth"],
  [/^LGBL_/, "Lgbl"],
  [/^LRNI_/, "LgblNO"],
  [/^VBL_/, "Vbl"],
  [/^L[A-Z]{2}\d{5,}$/, "LrKons"],
  [/^GEMREA_/, "GrA"],
  [/^GEMRE_/, "Gr"],
  [/^BVB_/, "Bvb"],
  [/^ERL_/, "Erlaesse"],
  [/^AVSV_/, "Avsv"],
  [/^AVN_/, "Avn"],
  [/^SPG_/, "Spg"],
  [/^KMGER_/, "KmGer"],
  [/^MRP_/, "Mrp"],
  [/^UPTS_/, "Upts"],
];

export function validateDocumentId(raw: string): string {
  const id = raw.trim();
  if (!ID_PATTERN.test(id)) {
    throw new RisError(
      "invalid_params",
      `Ungültige Dokumentnummer "${raw.slice(0, 80)}".`,
      'Erwartet wird die RIS-Dokumentnummer aus einem Suchtreffer (z. B. "JJT_20260225_OGH0002_0150OS00149_25P0000_000" oder "NOR40234381"), keine URL.',
    );
  }
  return id;
}

/** Ermittelt die Applikation zu einer Dokumentnummer; optional explizit vorgegeben. */
export function resolveDocumentApp(id: string, explicitApp?: string): AppInfo {
  if (explicitApp) {
    const a = findApp(explicitApp);
    if (!a) {
      throw new RisError(
        "invalid_params",
        `Unbekannte Applikation "${explicitApp}".`,
        `Gültig: ${Object.keys(ALL_APPS).join(", ")}`,
      );
    }
    return a;
  }
  for (const [re, name] of PREFIX_RULES) {
    if (re.test(id)) return ALL_APPS[name]!;
  }
  throw new RisError(
    "invalid_params",
    `Applikation für Dokumentnummer "${id}" nicht erkennbar.`,
    "Bitte den Parameter `applikation` angeben (steht im Suchtreffer).",
  );
}

export function contentUrl(contentBase: string, appInfo: AppInfo, id: string, ext: "xml" | "html"): string {
  const enc = encodeURIComponent(id);
  return `${contentBase}/${appInfo.folder}/${enc}/${enc}.${ext}`;
}

/** Menschenlesbarer Link (leitet bei ris.bka.gv.at auf die Dokumentansicht). */
export function documentLink(linkBase: string, appInfo: AppInfo, id: string): string {
  return `${linkBase}/Dokument.wxe?Abfrage=${encodeURIComponent(appInfo.folder)}&Dokumentnummer=${encodeURIComponent(id)}`;
}
