import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { parseParagraph, normalizeParagraphLabel } from "../src/tools/paragraph.js";
import { buildJudikaturParams, searchJudikaturShape } from "../src/tools/searchJudikatur.js";
import { buildRechtParams } from "../src/tools/searchRecht.js";
import { renderDocument, excerptByKeyword } from "../src/tools/getDokument.js";
import { lawMatchScore } from "../src/tools/getNorm.js";
import { normalizeDate, bundeslandParams } from "../src/tools/common.js";
import { BUNDESRECHT_APPS, JUDIKATUR_APPS, LANDESRECHT_APPS, SONSTIGE_APPS } from "../src/ris/applications.js";
import { resolveDocumentApp, validateDocumentId, contentUrl } from "../src/ris/documentId.js";
import { RisError } from "../src/ris/errors.js";
import { parseRisXml } from "../src/ris/xmlText.js";
import { z } from "zod";
import { fixture, makeClient, standardRoute } from "./helpers.js";

const isInvalid = (e: unknown) => e instanceof RisError && e.kind === "invalid_params";
const judArgs = (a: Record<string, unknown>) => z.object(searchJudikaturShape).parse(a);

// ─────────── Paragraphen ───────────

test("parseParagraph: Paragraph, Buchstabe, Bereich, Artikel, Anlage", () => {
  assert.deepEqual(parseParagraph("288"), { von: "288", bis: "288", typ: "Paragraph", exact: "288" });
  assert.deepEqual(parseParagraph("§ 288"), { von: "288", bis: "288", typ: "Paragraph", exact: "288" });
  assert.deepEqual(parseParagraph("5a"), { von: "5", bis: "6", typ: "Paragraph", exact: "5a" });
  assert.deepEqual(parseParagraph("§§ 278-279"), { von: "278", bis: "279", typ: "Paragraph" });
  assert.deepEqual(parseParagraph("278 bis 279b"), { von: "278", bis: "280", typ: "Paragraph" });
  assert.deepEqual(parseParagraph("Art. 15a"), { von: "15", bis: "16", typ: "Artikel", exact: "15a" });
  assert.deepEqual(parseParagraph("Artikel 7"), { von: "7", bis: "7", typ: "Artikel", exact: "7" });
  assert.deepEqual(parseParagraph("Anlage 1"), { von: "1", bis: "1", typ: "Anlage", exact: "1" });
  assert.throws(() => parseParagraph("blabla"), isInvalid);
  assert.equal(normalizeParagraphLabel("§ 5a"), "5a");
  assert.equal(normalizeParagraphLabel("Art. 7"), "7");
});

test("normalizeDate: ISO und deutsches Format, ungültige Daten", () => {
  assert.equal(normalizeDate("2024-03-01", "x"), "2024-03-01");
  assert.equal(normalizeDate("1.3.2024", "x"), "2024-03-01");
  assert.throws(() => normalizeDate("31.02.2024", "x"), isInvalid);
  assert.equal(normalizeDate(undefined, "x"), undefined);
});

// ─────────── Dokumentnummern ───────────

test("Dokumentnummer: Validierung und Zuordnung zur Applikation", () => {
  const cases: Record<string, string> = {
    JJT_20260225_OGH0002_0150OS00149_25P0000_000: "Justiz",
    JJR_20250402_OGH0002_0120OS00026_25B0000_000: "Justiz",
    JFT_20261007_26E01471_00: "Vfgh",
    JWR_2026070002_20261021F00: "Vwgh",
    BVWGT_20261109_L525_2293203_1_00: "Bvwg",
    LVWGT_WI_20270702_VGW_101_070_875_2026_00: "Lvwg",
    DSBT_20260916_2026_0_690_562_00: "Dsk",
    NOR40234381: "BrKons",
    LST40034250: "LrKons",
    BGBLA_2026_I_94: "BgblAuth",
    LGBLA_WI_20261109_40: "LgblAuth",
    GEMREA_TI_70220_20261112_37: "GrA",
    GEMRE_KA_20701_851_0__2018_ke_: "Gr",
    "UPTS_20261103_2026_0_495_016_UPTS_KPÖ": "Upts",
  };
  for (const [id, app] of Object.entries(cases)) {
    assert.equal(resolveDocumentApp(validateDocumentId(id)).name, app, id);
  }
  for (const bad of ["https://evil.example.com/x", "../../etc/passwd", "JJT 123", "a", "NOR/../x"]) {
    assert.throws(() => validateDocumentId(bad), isInvalid, bad);
  }
  assert.throws(() => resolveDocumentApp("XYZ_123"), isInvalid);
  assert.equal(resolveDocumentApp("XYZ_123", "PruefGewO").name, "PruefGewO");
  assert.equal(
    contentUrl("https://ogd.ris.bka.gv.at/Dokumente", SONSTIGE_APPS.Upts, "UPTS_X_KPÖ", "xml"),
    "https://ogd.ris.bka.gv.at/Dokumente/Upts/UPTS_X_KP%C3%96/UPTS_X_KP%C3%96.xml",
  );
});

// ─────────── Parameterbau ───────────

test("Judikatur: Dokumenttyp-Checkboxen nur als True senden (API-Eigenheit)", () => {
  const rs = buildJudikaturParams(judArgs({ suchworte: "x", dokumenttyp: "rechtssatz" }));
  assert.equal(rs["Dokumenttyp.SucheInRechtssaetzen"], "True");
  assert.equal(rs["Dokumenttyp.SucheInEntscheidungstexten"], undefined);
  const alle = buildJudikaturParams(judArgs({ suchworte: "x" }));
  assert.equal(alle["Dokumenttyp.SucheInRechtssaetzen"], "True");
  assert.equal(alle["Dokumenttyp.SucheInEntscheidungstexten"], "True");
  assert.equal(alle.DokumenteProSeite, "Twenty");
});

test("Judikatur: app-fremde Parameter und fehlende Kriterien werden abgelehnt", () => {
  assert.throws(() => buildJudikaturParams(judArgs({ applikation: "Vfgh", gericht: "OGH", suchworte: "x" })), isInvalid);
  assert.throws(() => buildJudikaturParams(judArgs({ applikation: "Justiz" })), isInvalid);
  const lvwg = buildJudikaturParams(judArgs({ applikation: "Lvwg", bundesland: "Kärnten", suchworte: "x" }));
  assert.equal(lvwg.Bundesland, "Kaernten");
  const datum = buildJudikaturParams(judArgs({ norm: "StGB §288", entscheidungsdatum_von: "01.01.2020", seite: 3, pro_seite: 50 }));
  assert.equal(datum.EntscheidungsdatumVon, "2020-01-01");
  assert.equal(datum.Seitennummer, "3");
  assert.equal(datum.DokumenteProSeite, "Fifty");
});

test("Recht: BrKons setzt Stichtag (Standard heute), alle_fassungen lässt ihn weg", () => {
  const p = buildRechtParams(BUNDESRECHT_APPS.BrKons, { titel: "StGB", paragraph: "288" }).params;
  assert.match(p["Fassung.FassungVom"]!, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(p["Abschnitt.Von"], "288");
  assert.equal(p["Abschnitt.Typ"], "Paragraph");
  const alle = buildRechtParams(BUNDESRECHT_APPS.BrKons, { titel: "StGB", alle_fassungen: true }).params;
  assert.equal(alle["Fassung.FassungVom"], undefined);
  const st = buildRechtParams(BUNDESRECHT_APPS.BrKons, { titel: "StGB", stichtag: "2020-01-01" }).params;
  assert.equal(st["Fassung.FassungVom"], "2020-01-01");
});

test("Recht: Nummern-, Datums- und Bundesland-Mapping je Applikation", () => {
  const bgbl = buildRechtParams(BUNDESRECHT_APPS.BgblAuth, { nummer: "I Nr. 94/2026", kundmachung_von: "2026-01-01" }).params;
  assert.equal(bgbl.Bgblnummer, "I Nr. 94/2026");
  assert.equal(bgbl["Kundmachung.Von"], "2026-01-01");
  const lr = buildRechtParams(LANDESRECHT_APPS.LrKons, { titel: "Bauordnung", bundesland: ["Wien", "Niederösterreich"] }).params;
  assert.equal(lr["Bundesland.SucheInWien"], "True");
  assert.equal(lr["Bundesland.SucheInNiederoesterreich"], "True");
  const erv = buildRechtParams(BUNDESRECHT_APPS.Erv, { suchworte: "criminal" }).params;
  assert.equal(erv.SearchTerms, "criminal");
  assert.throws(() => buildRechtParams(BUNDESRECHT_APPS.BgblAuth, { paragraph: "5" }), isInvalid);
  assert.throws(() => buildRechtParams(BUNDESRECHT_APPS.BrKons, {}), isInvalid);
  assert.throws(() => bundeslandParams(LANDESRECHT_APPS.Vbl, ["Tirol", "Wien"]), isInvalid);
  assert.deepEqual(bundeslandParams(SONSTIGE_APPS.Bvb, ["Kärnten"]), { Bundesland: "Kärnten" });
});

test("Applikationskatalog: alle Judikatur-Apps kennen Paging-Parameter", () => {
  for (const app of Object.values(JUDIKATUR_APPS)) {
    assert.ok(app.params.includes("DokumenteProSeite"), app.name);
    assert.equal(app.endpoint, "Judikatur");
  }
});

// ─────────── Dokumentdarstellung ───────────

const vwghDoc = () => ({
  id: "JWT_TEST",
  app: JUDIKATUR_APPS.Vwgh,
  link: "https://ris.bka.gv.at/x",
  sections: parseRisXml(fixture("vwgh-JWT.xml")),
});

test("renderDocument: Metadaten im Kopf, Paginierung mit Fortsetzungshinweis", () => {
  const doc = vwghDoc();
  const r = renderDocument(doc, { maxChars: 2000 });
  assert.ok(r.text.includes("Geschäftszahl:"));
  assert.ok(r.text.includes("Gliederung:"));
  assert.ok(r.nextOffset !== undefined && r.nextOffset <= 2000);
  assert.ok(r.text.includes(`offset=${r.nextOffset}`));
  // Fortsetzung bis zum Ende ergibt den gesamten Text ohne Lücken
  let offset = 0;
  let pieces = 0;
  while (true) {
    const p = renderDocument(doc, { maxChars: 3000, offset });
    pieces++;
    if (p.nextOffset === undefined) break;
    offset = p.nextOffset;
  }
  assert.ok(pieces > 2);
});

test("renderDocument: Abschnittsfilter und unbekannte Rubrik", () => {
  const r = renderDocument(vwghDoc(), { abschnitte: ["spruch"] });
  assert.ok(r.text.includes("## Spruch"));
  assert.ok(!r.text.includes("## Begründung"));
  assert.throws(() => renderDocument(vwghDoc(), { abschnitte: ["gibtsnicht"] }), isInvalid);
});

test("excerptByKeyword: nur passende Absätze mit Nachbarn, Platzhalter *", () => {
  const sections = [{ title: "Text", text: ["A eins", "B Ermittlungsanordnung hier", "C drei", "D vier", "E fünf"].join("\n\n") }];
  const { text, matches } = excerptByKeyword(sections, "Ermittlungsanord*");
  assert.equal(matches, 1);
  assert.match(text, /A eins\n\nB Ermittlungsanordnung hier\n\nC drei\n\n\[…\]/);
  assert.ok(!text.includes("E fünf"));
  assert.equal(excerptByKeyword(sections, "nirgends").matches, 0);
});

test("lawMatchScore: Abkürzung schlägt Teiltreffer im Titel", () => {
  const hit = (abk: string, kurz: string) => ({ meta: { Abkuerzung: abk, Kurztitel: kurz } }) as never;
  assert.equal(lawMatchScore(hit("B-VG", "Bundes-Verfassungsgesetz"), "B-VG"), 3);
  assert.equal(lawMatchScore(hit("", "Grundversorgungsvereinbarung – Art. 15a B-VG"), "B-VG"), 1);
  assert.equal(lawMatchScore(hit("StPO", "Strafprozeßordnung 1975"), "Strafprozessordnung"), 2);
});

// ─────────── MCP-Integration (In-Memory-Transport, Fake-API) ───────────

async function connect(route = standardRoute()) {
  const { client: ris, calls } = makeClient(route);
  const server = createServer(ris);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(ct);
  return { client, calls };
}

const textOf = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]!.text);

test("MCP: alle Tools registriert, read-only annotiert", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "get_dokument",
    "get_norm",
    "search_bundesrecht",
    "search_judikatur",
    "search_landesrecht",
    "search_sonstige",
  ]);
  for (const t of tools) {
    assert.equal(t.annotations?.readOnlyHint, true, t.name);
  }
  const sj = tools.find((t) => t.name === "search_judikatur")!;
  assert.match(sj.description!, /Platzhalter \*/);
  assert.match(sj.description!, /Varianten/);
});

test("MCP: search_judikatur liefert kompakte Liste mit Quellenangabe", async () => {
  const { client, calls } = await connect();
  const r = await client.callTool({ name: "search_judikatur", arguments: { suchworte: "Ermittlungsanordnung", pro_seite: 10 } });
  const t = textOf(r);
  assert.ok(!r.isError);
  assert.match(t, /39 Treffer · Seite 1\/4/);
  assert.match(t, /\[1\] Entscheidungstext · OLG Linz · 2026-06-25/);
  assert.match(t, /ID: JJT_20260625_OLG0459_0090BS00127_25B0000_000/);
  assert.match(t, /Datenquelle: RIS – Rechtsinformationssystem des Bundes/);
  assert.match(t, /seite=2/);
  const url = new URL(calls[0]!);
  assert.equal(url.searchParams.get("Applikation"), "Justiz");
  assert.equal(url.searchParams.get("DokumenteProSeite"), "Ten");
});

test("MCP: get_dokument liefert bereinigten Text mit Metadatenkopf", async () => {
  const { client } = await connect();
  const r = await client.callTool({ name: "get_dokument", arguments: { dokument_id: "JJR_TEST" } });
  const t = textOf(r);
  assert.ok(!r.isError, t);
  assert.match(t, /Rechtssatznummer: RS0142801/);
  assert.match(t, /## Rechtssatz\n\nDie gerichtliche Prüfung im Vollstreckungsstaat/);
  assert.ok(!/<absatz|<\/|kzinhalt/.test(t), "kein XML-Ballast");
});

test("MCP: Fehler werden als isError mit verständlicher Meldung geliefert", async () => {
  const { client } = await connect();
  const a = await client.callTool({ name: "get_dokument", arguments: { dokument_id: "https://evil.example.com" } });
  assert.equal(a.isError, true);
  assert.match(textOf(a), /Ungültige Anfrage: Ungültige Dokumentnummer/);
  const b = await client.callTool({ name: "get_dokument", arguments: { dokument_id: "JJT_GIBTSNICHT" } });
  assert.equal(b.isError, true);
  assert.match(textOf(b), /Nicht gefunden/);
  const { client: c2 } = await connect(() => ({ body: fixture("search-error.json") }));
  const c = await c2.callTool({ name: "search_judikatur", arguments: { suchworte: "x" } });
  assert.equal(c.isError, true);
  assert.match(textOf(c), /RIS-API lehnt die Anfrage ab/);
});

test("MCP: keine Treffer → Hinweise auf Suchwort-Varianten", async () => {
  const { client } = await connect(() => ({ body: fixture("search-empty.json") }));
  const r = await client.callTool({ name: "search_judikatur", arguments: { suchworte: "Xylophon" } });
  assert.ok(!r.isError);
  assert.match(textOf(r), /keine Treffer/);
  assert.match(textOf(r), /Platzhalter \*/);
});
