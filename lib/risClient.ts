import { execFile } from "child_process";

// Note: ris.bka.gv.at uses a certificate not in Node's default CA store.
// fetchDocumentHtml handles this via a curl subprocess with -k (scoped to that
// one call). The RIS API base (data.bka.gv.at) has a valid cert and needs no
// special handling. The former global NODE_TLS_REJECT_UNAUTHORIZED=0 has been
// removed to avoid disabling TLS verification process-wide.

/**
 * RIS OGD API Client v2.6
 *
 * Basis-URL: https://data.bka.gv.at/ris/api/v2.6/Bundesrecht
 * Dokumentation: https://www.data.gv.at/katalog/dataset/0fb9ae1a-92cb-4ab8-a589-470c16d4fe21
 *
 * Suche: GET /Bundesrecht?Applikation=BrKons&Gesetzesnummer=<nr>&Fassung.FassungVom=<date>
 * Dokument-HTML: DokumentUrl aus Response-Metadaten (eli-URL) → ergibt HTML
 * Gesamtgesetz-HTML: GesamteRechtsvorschriftUrl
 *
 * Response-Struktur (v2.6):
 *   OgdSearchResult.OgdDocumentResults.OgdDocumentReference[].Data.Metadaten.{Technisch,Allgemein,Bundesrecht.BrKons}
 */

const RIS_API_BASE = "https://data.bka.gv.at/ris/api/v2.6";

export interface RisDocumentRef {
  dokumentnummer: string;   // = Technisch.ID (NORxxxxxxxx)
  artikelParagraphAnlage: string;
  kurztitel: string;
  abkuerzung?: string;
  dokumentUrl: string;
  gesetzesnummer?: string;
  inkrafttretedatum?: string;
}

export interface RisSearchResult {
  totalHits: number;
  pageNumber: number;
  pageSize: number;
  documents: RisDocumentRef[];
}

/**
 * Suche nach Dokumenten im konsolidierten Bundesrecht.
 */
export async function searchBundesrecht(params: {
  suchworte?: string;
  gesetzesnummer?: string;
  typ?: "Paragraph" | "Artikel" | "Alle" | "Anlage";
  seitennummer?: number;
  seitengroesse?: number;
}): Promise<RisSearchResult> {
  const url = new URL(`${RIS_API_BASE}/Bundesrecht`);
  url.searchParams.set("Applikation", "BrKons");

  if (params.suchworte) url.searchParams.set("Suchworte", params.suchworte);
  if (params.gesetzesnummer) url.searchParams.set("Gesetzesnummer", params.gesetzesnummer);
  if (params.typ && params.typ !== "Alle") {
    url.searchParams.set("Abschnitt.Typ", params.typ);
  }

  const today = new Date().toISOString().split("T")[0];
  url.searchParams.set("Fassung.FassungVom", today);

  if (params.seitennummer && params.seitennummer > 1) {
    url.searchParams.set("Seitennummer", String(params.seitennummer));
  }
  url.searchParams.set("Seitengroesse", String(params.seitengroesse ?? 100));

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`RIS API error ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  return parseSearchResult(json);
}

function parseSearchResult(json: any): RisSearchResult {
  const result = json?.OgdSearchResult?.OgdDocumentResults;
  if (!result) return { totalHits: 0, pageNumber: 1, pageSize: 100, documents: [] };

  const hits = result.Hits;
  const totalHits = parseInt(typeof hits === "object" ? hits["#text"] ?? "0" : String(hits), 10) || 0;
  const pageNumber = parseInt(hits?.["@pageNumber"] ?? "1", 10);
  const pageSize = parseInt(hits?.["@pageSize"] ?? "100", 10);

  const refs = result.OgdDocumentReference;
  if (!refs) return { totalHits, pageNumber, pageSize, documents: [] };

  const refsArr = Array.isArray(refs) ? refs : [refs];

  const documents: RisDocumentRef[] = refsArr.map((ref: any) => {
    // v2.6 structure: ref.Data.Metadaten.{Technisch, Allgemein, Bundesrecht.BrKons}
    const meta = ref?.Data?.Metadaten;
    const tech = meta?.Technisch ?? {};
    const allg = meta?.Allgemein ?? {};
    const br = meta?.Bundesrecht ?? {};
    const brkons = br?.BrKons ?? {};

    // Fallback to flat structure (older API versions)
    const dokumentnummer = tech?.ID ?? ref?.Dokumentnummer ?? "";
    const artikelParagraphAnlage = brkons?.ArtikelParagraphAnlage ?? ref?.ArtikelParagraphAnlage ?? "";
    const kurztitel = br?.Kurztitel ?? ref?.Kurzinformation ?? "";
    const abkuerzung = brkons?.Abkuerzung ?? ref?.Abkuerzung;
    const dokumentUrl = allg?.DokumentUrl ?? ref?.DokumentUrl ?? `https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer=${dokumentnummer}`;
    const gesetzesnummer = brkons?.Gesetzesnummer ?? ref?.Gesetzesnummer;
    const inkrafttretedatum = brkons?.Inkrafttretensdatum ?? ref?.Inkrafttretedatum;

    return { dokumentnummer, artikelParagraphAnlage, kurztitel, abkuerzung, dokumentUrl, gesetzesnummer, inkrafttretedatum };
  });

  return { totalHits, pageNumber, pageSize, documents };
}

/**
 * Lädt den HTML-Inhalt eines einzelnen RIS-Dokuments via curl.
 * Verwendet curl statt fetch, da der RIS-WAF (myracloud) Node.js-Requests blockt.
 */
export async function fetchDocumentHtml(dokumentUrl: string): Promise<string> {
  // Prefer Dokument.wxe URL format (more reliable than eli URLs)
  let url: string;
  if (dokumentUrl.includes("Dokument.wxe") || dokumentUrl.includes("Bundesnormen")) {
    url = dokumentUrl;
  } else if (dokumentUrl.startsWith("http")) {
    // eli URL — extract NOR number and use Dokument.wxe
    const norMatch = dokumentUrl.match(/NOR\w+/);
    url = norMatch
      ? `https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer=${norMatch[0]}`
      : dokumentUrl;
  } else {
    url = `https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer=${dokumentUrl}`;
  }

  return new Promise((resolve, reject) => {
    execFile(
      "curl",
      [
        "-sk",
        "--max-time", "20",
        "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "-H", "Accept: text/html,application/xhtml+xml",
        "-H", "Accept-Language: de-AT,de;q=0.9,en;q=0.8",
        "-L",
        url,
      ],
      { maxBuffer: 6 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`curl failed: ${err.message}`));
        const html = stdout.toString("utf8");
        resolve(extractRisContent(html));
      }
    );
  });
}

/**
 * Extrahiert den Gesetzestext aus dem RIS-HTML-Response.
 * RIS-Struktur: documentContent > documentLinks + contentBlock(law text)
 * Der eigentliche Gesetzestext ist in class="contentBlock".
 */
function extractRisContent(html: string): string {
  // 1. Suche nach contentBlock (enthält den eigentlichen Gesetzestext)
  const cbIdx = html.indexOf('class="contentBlock"');
  if (cbIdx !== -1) {
    const divStart = html.lastIndexOf('<div', cbIdx);
    // Finde Ende: BottomDocumentNavigation oder Ende des documentContent
    let endIdx = html.indexOf('class="BottomDocumentNavigation"', cbIdx);
    if (endIdx === -1) endIdx = html.indexOf('</div>\n</div>\n</div>', cbIdx + 500);
    if (endIdx === -1) endIdx = divStart + 8000;
    const extracted = html.slice(divStart, endIdx);
    if (extracted.length > 50) {
      return `<div class="ris-content">${extracted}</div>`;
    }
  }

  // 2. Fallback: ParagraphMitAbsatzzahl und ähnliche
  const paraPattern = /<div[^>]+class="[^"]*(ParagraphMit|contentBlock|Abs )[^"]*"[^>]*>[\s\S]{20,3000}?<\/div>/gi;
  const paras: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = paraPattern.exec(html)) !== null) {
    paras.push(m[0]);
    if (paras.length > 20) break;
  }
  if (paras.length > 0) return `<div class="ris-content">${paras.join("\n")}</div>`;

  // 3. Fallback: gesamter body bereinigt
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (body) {
    return body[1]
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "");
  }

  return html;
}

/**
 * Extrahiert den paragraphen-spezifischen Titel aus dem RIS-HTML.
 *
 * RIS verwendet mehrere Varianten zur Darstellung der Paragraphenüberschrift.
 * Reihenfolge der Versuche:
 *   1. <h4 class="UeberschrPara…">Titel</h4>         (Standard)
 *   2. <span class="UeberschrG2…">Titel</span>      (Artikel-Gliederung)
 *   3. Erstes <b>/<strong> im contentBlock, das nicht nur "§ X" ist
 *      (häufig bei StPO, wo der Paragraphentitel als schlichtes <b> über
 *       der Paragraphennummer steht)
 *
 * Gibt `null` zurück, wenn kein sinnvoller Titel gefunden wurde.
 *
 * @param html RIS-HTML (gern bereits durch extractRisContent() gelaufen, aber
 *             auch rohes Dokument-HTML funktioniert — die Muster sind eng genug.)
 * @param paragraphLabel optional: die Paragraph-/Artikelnummer (z. B. "§ 10"),
 *        um ähnlich lautenden Text als Titel auszuschließen.
 */
export function extractParagraphTitle(
  html: string,
  paragraphLabel?: string,
  lawTitle?: string,
): string | null {
  if (!html) return null;

  const cleanText = (raw: string): string =>
    raw
      .replace(/<br\s*\/?>(\s*)/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#xa0;/gi, " ")
      .replace(/&#x?[0-9a-f]+;/gi, "")
      .replace(/\s+/g, " ")
      .trim();

  // Normalize for fuzzy equality checks: lowercased, no spaces, no punctuation,
  // ß → ss, ß-variants. Used to detect when a candidate *is* the law title
  // in disguise (e.g. "Strafprozeßordnung 1975" vs "Strafprozessordnung 1975").
  const normalize = (s: string) => (s ?? "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
  const normLawTitle = lawTitle ? normalize(lawTitle) : "";

  // Helper: accept a candidate title if it's non-trivial and not just the
  // paragraph number / law name noise.
  const isValidTitle = (txt: string): boolean => {
    if (!txt || txt.length < 2 || txt.length > 300) return false;
    // Reject pure paragraph markers like "§ 10", "§ 10.", "Art. 5"
    if (/^(§|Art\.?|Artikel|Anlage)\s*\d+[a-z]?\.?$/i.test(txt)) return false;
    // Reject if it matches the paragraph label itself (e.g. "§ 10")
    if (paragraphLabel && txt.replace(/[.\s]/g, "") === paragraphLabel.replace(/[.\s]/g, "")) return false;
    // Reject boilerplate
    if (/^(Inhaltsverzeichnis|Beachte|Anmerkung|Hinweis|Text|Kurztitel|Abkürzung|Typ|Index|Kundmachungsorgan)$/i.test(txt)) return false;
    // Reject dates, plain numbers
    if (/^\d{1,4}([./-]\d{1,4}){0,2}$/.test(txt)) return false;
    // Reject when candidate equals the law-wide Kurztitel.
    if (normLawTitle && normalize(txt) === normLawTitle) return false;
    return true;
  };

  // 1. <h4 class="UeberschrPara…">…</h4>
  const mPara = html.match(/class="[^"]*UeberschrPara[^"]*"[^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (mPara) {
    const t = cleanText(mPara[1]);
    if (isValidTitle(t)) return t;
  }

  // 2. <span class="UeberschrG2…">…</span>  (Gliederungsüberschrift, Hauptstück etc.)
  const mG2 = html.match(/class="[^"]*UeberschrG[12][^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  if (mG2) {
    const t = cleanText(mG2[1]);
    if (isValidTitle(t)) return t;
  }

  // 3. "Text"-Marker: RIS-Einzelnorm-Seiten haben immer den Aufbau
  //      <h3>Text</h3> <title> <h5>§ X.</h5> …
  //    D. h. zwischen dem Label "Text" und dem nächsten "§ X" steht exakt der
  //    Paragraphen-Titel. Wir nehmen das erste nicht-triviale Textstück in
  //    diesem Fenster.
  const textMarker = html.match(/<h[1-6][^>]*>\s*Text\s*<\/h[1-6]>/i);
  if (textMarker && textMarker.index !== undefined) {
    const after = html.slice(textMarker.index + textMarker[0].length);
    // Ende = Anfang des Paragraphen-Markers (§ X.) oder Gliederungs-Symbols
    const paraMarker = after.search(/<h5[^>]*class="[^"]*GldSymbol[^"]*"|§\s*(&nbsp;|&#xa0;|\s)*\d+[a-z]?\./i);
    const scope = paraMarker > 0 ? after.slice(0, paraMarker) : after.slice(0, 2000);
    // Suche fett/h1-6 Inhalte in diesem Fenster.
    const candidates: string[] = [];
    const headRe = /<(?:h[1-6]|b|strong|p|div|span)[^>]*>([\s\S]*?)<\/(?:h[1-6]|b|strong|p|div|span)>/gi;
    let mm: RegExpExecArray | null;
    while ((mm = headRe.exec(scope)) !== null) {
      const t = cleanText(mm[1]);
      if (isValidTitle(t)) candidates.push(t);
      if (candidates.length >= 3) break;
    }
    if (candidates.length) return candidates[0];
    // Fallback: puren Text im Fenster
    const plain = cleanText(scope);
    if (isValidTitle(plain)) {
      // Nimm erste ~120 Zeichen bis zu einem Punkt/Abs.zeichen
      const cut = plain.split(/\s§\s|(?:\.\s+[A-ZÄÖÜ])/)[0];
      if (isValidTitle(cut)) return cut;
    }
  }

  // 4. Erstes <b>/<strong> im contentBlock, das nicht der Paragraphenmarker ist.
  //    WICHTIG: Nur aktivieren, wenn der contentBlock tatsächlich einen
  //    Paragraphen enthält (§-Marker oder Ueberschr*-Element). Sonst gibt es
  //    False-Positives bei Dokumenten ohne echte Überschrift (z. B. reine
  //    BGBl.-Listen wie StPO §0).
  const cbIdx = html.indexOf('class="contentBlock"');
  const searchScope = cbIdx !== -1
    ? html.slice(cbIdx, cbIdx + 4000)
    : html.slice(0, 4000);

  const hasParaStructure =
    /class="[^"]*(UeberschrPara|UeberschrG[12]|GldSymbol)[^"]*"/i.test(searchScope) ||
    /§\s*(?:&nbsp;|&#xa0;|\s)*\d+[a-z]?\./i.test(searchScope);

  if (hasParaStructure) {
    // Fett-Kandidat muss VOR dem §-Marker stehen (sonst ist es Fließtext).
    const paraMarkerIdx = searchScope.search(/<h5[^>]*class="[^"]*GldSymbol[^"]*"|§\s*(?:&nbsp;|&#xa0;|\s)*\d+[a-z]?\./i);
    const boldScope = paraMarkerIdx > 0 ? searchScope.slice(0, paraMarkerIdx) : searchScope;

    const boldRe = /<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi;
    let m: RegExpExecArray | null;
    while ((m = boldRe.exec(boldScope)) !== null) {
      const t = cleanText(m[1]);
      if (isValidTitle(t)) return t;
    }
  }

  return null;
}

/**
 * Lädt alle Paragraphen/Artikel eines Gesetzes (paginiert).
 */
export async function fetchAllDocumentsForLaw(gesetzesnummer: string): Promise<RisDocumentRef[]> {
  const allDocs: RisDocumentRef[] = [];
  let page = 1;
  // RIS API is hard-limited to 20 results per page regardless of Seitengroesse parameter
  const PAGE_SIZE = 20;
  const MAX_PAGES = 100; // safety cap (100 * 20 = 2000 docs)

  while (page <= MAX_PAGES) {
    const result = await searchBundesrecht({
      gesetzesnummer,
      seitennummer: page,
      seitengroesse: PAGE_SIZE,
    });

    allDocs.push(...result.documents);

    // Stop if we got fewer results than requested (last page) or nothing
    if (result.documents.length < PAGE_SIZE || result.documents.length === 0) break;

    // Also stop if we've loaded at least totalHits
    if (allDocs.length >= result.totalHits) break;

    page++;

    // Rate limiting: 150ms between pages
    await new Promise((r) => setTimeout(r, 150));
  }

  return allDocs;
}

/**
 * Extrahiert Abschnitts-/Teil-Informationen aus dem RIS-HTML eines Paragraphen.
 *
 * RIS verwendet folgende CSS-Klassen für die Gliederung:
 *   UeberschrG1          → Hauptgliederung (z. B. "Allgemeiner Teil")
 *   UeberschrG2          → Untergliederung (z. B. "Erster Abschnitt")
 *   UeberschrG1-AfterG2  → Weitere Unterüberschrift (z. B. "Allgemeine Bestimmungen")
 *
 * Gibt null zurück, wenn keine Gliederungsinfo gefunden wurde.
 */
export function extractSectionInfo(html: string): { g1?: string; g2?: string; g3?: string } | null {
  if (!html) return null;

  const cleanText = (raw: string): string =>
    raw
      .replace(/<br\s*\/?>(\s*)/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#xa0;/gi, " ")
      .replace(/&#x?[0-9a-f]+;/gi, "")
      .replace(/\s+/g, " ")
      .trim();

  const result: { g1?: string; g2?: string; g3?: string } = {};

  // G1: Hauptteil (e.g. "Allgemeiner Teil", "Besonderer Teil")
  const g1Match = html.match(/<[^>]+class="[^"]*UeberschrG1(?:\s[^"]*)?(?<!AfterG2)[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i);
  if (g1Match) {
    // Extract G2 from within G1 before cleaning
    const g2Match = g1Match[1].match(/<[^>]+class="[^"]*UeberschrG2[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i);
    if (g2Match) {
      const g2Text = cleanText(g2Match[1]);
      if (g2Text && g2Text.length > 1) result.g2 = g2Text;
    }
    // G1 text = g1 content minus any inner tags
    const g1Text = cleanText(g1Match[1]);
    if (g1Text && g1Text.length > 1) result.g1 = g1Text;
  }

  // G2 standalone (if not nested inside G1)
  if (!result.g2) {
    const g2Match = html.match(/<[^>]+class="[^"]*UeberschrG2[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i);
    if (g2Match) {
      const g2Text = cleanText(g2Match[1]);
      if (g2Text && g2Text.length > 1) result.g2 = g2Text;
    }
  }

  // G3: Sub-section after G2 (e.g. "Allgemeine Bestimmungen")
  const g3Match = html.match(/<[^>]+class="[^"]*UeberschrG1-AfterG2[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i);
  if (g3Match) {
    const g3Text = cleanText(g3Match[1]);
    if (g3Text && g3Text.length > 1) result.g3 = g3Text;
  }

  // Return null if nothing found
  if (!result.g1 && !result.g2 && !result.g3) return null;
  return result;
}
