import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRisXml } from "../src/ris/xmlText.js";
import { parseSearchResponse, simplifyApiError, getStr, getList } from "../src/ris/normalize.js";
import { RisError } from "../src/ris/errors.js";
import { fixture } from "./helpers.js";

test("XML: Rechtssatz wird in Rubriken zerlegt, Kopf-/Fußzeilen entfernt", () => {
  const secs = parseRisXml(fixture("rechtssatz-JJR.xml"));
  const titles = secs.map((s) => s.title);
  assert.deepEqual(titles, [
    "Gericht",
    "Rechtssatznummer",
    "Entscheidungsdatum",
    "Geschäftszahl",
    "Norm",
    "Rechtssatz",
    "Entscheidungstexte",
    "European Case Law Identifier",
  ]);
  const all = secs.map((s) => s.text).join("\n");
  assert.ok(!all.includes("Seite"), "Fußzeile 'Seite x von y' darf nicht im Text stehen");
  assert.ok(!all.includes("www.ris.bka.gv.at"), "Fußzeile darf nicht im Text stehen");
  assert.match(secs.find((s) => s.title === "Rechtssatz")!.text, /Europäischer Ermittlungsanordnung/);
});

test("XML: Normtext mit Gliederung, § -Symbol und Absätzen", () => {
  const secs = parseRisXml(fixture("norm-stgb288.xml"));
  const text = secs.find((s) => s.title === "Text")!.text;
  assert.match(text, /^Einundzwanzigster Abschnitt\n\nStrafbare Handlungen gegen die Rechtspflege\n\nFalsche Beweisaussage\n\n§ 288\. \(1\) Wer vor Gericht/);
  assert.match(text, /\n\n\(4\) Nach Abs\. 1 ist auch zu bestrafen/);
});

test("XML: Aufzählungen werden je Ebene eingerückt", () => {
  const text = parseRisXml(fixture("norm-stgb74-liste.xml")).find((s) => s.title === "Text")!.text;
  assert.match(text, /\n\n1\. unmündig: wer das vierzehnte Lebensjahr/);
  assert.match(text, /\n\n {2}b\. für den Bund, ein Land/, "lit. b auf Ebene 2 ist eingerückt");
  assert.match(text, /\(Anm\.: Z 2 aufgehoben durch BGBl\. I Nr\. 19\/2001\)/);
});

test("XML: <gdash/> wird zum Bindestrich (Doppelnamen)", () => {
  const all = parseRisXml(fixture("vwgh-JWT.xml"))
    .map((s) => s.text)
    .join("\n");
  assert.match(all, /Maurer-Kober/);
});

test("XML: DOCTYPE/ENTITY wird abgelehnt", () => {
  const evil = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><risdok><nutzdaten>&e;</nutzdaten></risdok>`;
  assert.throws(() => parseRisXml(evil), (e: unknown) => e instanceof RisError && e.kind === "bad_response");
});

test("JSON: Trefferliste, Gesamtzahl und flache Metadaten", () => {
  const r = parseSearchResponse(JSON.parse(fixture("search-justiz.json")));
  assert.equal(r.total, 39);
  assert.equal(r.pageSize, 10);
  assert.equal(r.hits.length, 3);
  const h = r.hits[0]!;
  assert.equal(h.applikation, "Justiz");
  assert.equal(h.kategorie, "Judikatur");
  assert.equal(getStr(h.meta, "Geschaeftszahl"), "9Bs127/25b");
  assert.equal(getStr(h.meta, "Gericht"), "OLG Linz");
  assert.equal(getStr(h.meta, "EuropeanCaseLawIdentifier"), "ECLI:AT:OLG0459:2026:0090BS00127.25B.0625.000");
  assert.ok(h.content.some((c) => c.dataType === "Xml"));
});

test("JSON: Einzeltreffer als Objekt statt Array wird normalisiert", () => {
  const r = parseSearchResponse(JSON.parse(fixture("search-single.json")));
  assert.equal(r.total, 1);
  assert.equal(r.hits.length, 1);
});

test("JSON: Rechtssatz mit Normen-Liste und verknüpften Entscheidungstexten", () => {
  const r = parseSearchResponse(JSON.parse(fixture("search-vfgh-rechtssatz.json")));
  const h = r.hits[0]!;
  assert.equal(getStr(h.meta, "Dokumenttyp"), "Rechtssatz");
  assert.ok(getList(h.meta, "Normen").length > 1);
  assert.ok(h.entscheidungstexte.length >= 1);
  assert.match(h.entscheidungstexte[0]!.id, /^JFT_/);
});

test("JSON: 0 Treffer", () => {
  const r = parseSearchResponse(JSON.parse(fixture("search-empty.json")));
  assert.equal(r.total, 0);
  assert.deepEqual(r.hits, []);
});

test("JSON: API-Fehler (HTTP 200 mit Error) → RisError invalid_params, lesbar", () => {
  assert.throws(
    () => parseSearchResponse(JSON.parse(fixture("search-error.json"))),
    (e: unknown) => e instanceof RisError && e.kind === "invalid_params" && /Ungültiger Wert "Foo" für DokumenteProSeite/.test(e.message),
  );
  assert.equal(simplifyApiError("soap:Client. irgendwas"), "irgendwas");
});
