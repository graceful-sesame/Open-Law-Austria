/** Regressionstests zu den Befunden des Code-Reviews. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { RisHttp, parseRetryAfter } from "../src/ris/http.js";
import { RisError } from "../src/ris/errors.js";
import { cleanText, parseSearchResponse } from "../src/ris/normalize.js";
import { parseRisXml } from "../src/ris/xmlText.js";
import { validateDocumentId } from "../src/ris/documentId.js";
import { excerptByKeyword, parseKeywordTerms } from "../src/tools/getDokument.js";
import { buildJudikaturParams, searchJudikaturShape } from "../src/tools/searchJudikatur.js";
import { buildRechtParams } from "../src/tools/searchRecht.js";
import { parseParagraph } from "../src/tools/paragraph.js";
import { todayVienna } from "../src/tools/common.js";
import { BUNDESRECHT_APPS, JUDIKATUR_APPS } from "../src/ris/applications.js";
import { fakeClock, fakeFetch, fixture, makeClient, testConfig } from "./helpers.js";

const isInvalid = (e: unknown) => e instanceof RisError && e.kind === "invalid_params";
const API = "https://data.bka.gv.at/ris/api/v2.6/Judikatur?Applikation=Justiz&Suchworte=";

test("Stichwort: kein katastrophales Backtracking (ReDoS)", () => {
  const text = "e".repeat(5000) + " " + "§ 288 ".repeat(2000);
  const sections = [{ title: "Text", text: Array.from({ length: 200 }, () => text).join("\n\n") }];
  const t0 = Date.now();
  excerptByKeyword(sections, "e*x ****§ e*e");
  assert.ok(Date.now() - t0 < 2000, `dauerte ${Date.now() - t0} ms`);
  assert.throws(() => parseKeywordTerms("e*e*e*x"), isInvalid);
  assert.deepEqual(parseKeywordTerms("Vernehm***"), [{ prefix: "vernehm", suffix: "" }]);
});

test("Stichwort: ganze Wörter – '§ 288' trifft nicht '1288'", () => {
  const sections = [{ title: "T", text: "Absatz mit 1288 Euro.\n\nVerstoß gegen § 288 StGB.\n\nNichts." }];
  const r = excerptByKeyword(sections, "§ 288");
  assert.equal(r.matches, 1);
  assert.match(r.text, /§ 288 StGB/);
  assert.equal(excerptByKeyword(sections, "Verstoß").matches, 1);
  assert.equal(excerptByKeyword(sections, "Verst*").matches, 1);
});

test("Abbruch durch den Client stoppt Warteschlange und Retries", async () => {
  const ctl = new AbortController();
  let calls = 0;
  const http = new RisHttp(testConfig(), {
    fetch: async () => {
      calls++;
      ctl.abort();
      return new Response("busy", { status: 503, headers: { "content-type": "text/html" } });
    },
    sleep: async (_ms, signal) => {
      if (signal?.aborted) throw new Error("aborted");
    },
  });
  await assert.rejects(
    http.getText(API + "abort", { accept: "json", cacheTtlMs: 0, signal: ctl.signal }),
    (e: unknown) => e instanceof RisError && e.kind === "unavailable",
  );
  assert.equal(calls, 1, "nach Abbruch kein weiterer Versuch");
  // bereits abgebrochenes Signal: gar kein Request
  await assert.rejects(http.getText(API + "abort2", { accept: "json", cacheTtlMs: 0, signal: ctl.signal }));
  assert.equal(calls, 1);
});

test("Retry-After > 60 s: kein Retry, Wartezeit wird gemeldet", async () => {
  const clock = fakeClock();
  const ff = fakeFetch(() => ({ status: 503, body: "x", contentType: "text/html", headers: { "retry-after": "600" } }));
  const http = new RisHttp(testConfig(), { fetch: ff.fetch, now: clock.now, sleep: clock.sleep });
  await assert.rejects(
    http.getText(API + "ra", { accept: "json", cacheTtlMs: 0 }),
    (e: unknown) => e instanceof RisError && /600 s zu warten/.test(e.message),
  );
  assert.equal(ff.calls.length, 1);
  assert.equal(parseRetryAfter("5", 0), 5000);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 0), 10_000);
  assert.equal(parseRetryAfter("quatsch", 0), undefined);
});

test("Gleichzeitige Abrufe derselben URL werden zusammengefasst", async () => {
  const ff = fakeFetch(() => ({ body: "{}" }));
  const http = new RisHttp(testConfig(), { fetch: ff.fetch, sleep: async () => {} });
  await Promise.all([1, 2, 3].map(() => http.getText(API + "same", { accept: "json", cacheTtlMs: 60_000 })));
  assert.equal(ff.calls.length, 1);
});

test("API-Fehlerantworten werden nicht gecacht", async () => {
  const { client, calls } = makeClient(() => ({ body: fixture("search-error.json") }));
  for (let i = 0; i < 2; i++) {
    await assert.rejects(client.search(JUDIKATUR_APPS.Justiz, { Suchworte: "x" }), isInvalid);
  }
  assert.equal(calls.length, 2);
});

test("Applikation kann nicht über weitere_parameter überschrieben werden", async () => {
  const { client, calls } = makeClient(() => ({ body: fixture("search-empty.json") }));
  await assert.rejects(client.search(JUDIKATUR_APPS.Justiz, { Suchworte: "x", Applikation: "Vfgh" }), isInvalid);
  const args = z.object(searchJudikaturShape).parse({ suchworte: "x", weitere_parameter: { applikation: "Vfgh" } });
  await assert.rejects(client.search(JUDIKATUR_APPS.Justiz, buildJudikaturParams(args)), isInvalid);
  assert.equal(calls.length, 0);
});

test("weitere_parameter darf typisierte Parameter nicht überschreiben", () => {
  const args = z.object(searchJudikaturShape).parse({ suchworte: "x", weitere_parameter: { Suchworte: "y" } });
  assert.throws(() => buildJudikaturParams(args), isInvalid);
  assert.throws(
    () => buildRechtParams(BUNDESRECHT_APPS.BrKons, { titel: "StGB", weitere_parameter: { "Fassung.FassungVom": "2000-01-01" } }),
    isInvalid,
  );
});

test("Paragraph mit Untergliederung ('288 Abs 1', '153 Abs. 2 Z 3')", () => {
  assert.equal(parseParagraph("288 Abs 1").exact, "288");
  assert.equal(parseParagraph("§ 153 Abs. 2 Z 3").exact, "153");
  assert.equal(parseParagraph("Art 7 Abs 1").typ, "Artikel");
});

test("Unicode-NFD-Dokumentnummer wird normalisiert", () => {
  const nfd = "UPTS_X_KPÖ";
  assert.equal(validateDocumentId(nfd), "UPTS_X_KPÖ");
});

test("XML: DOCTYPE auch nach langem Kommentar erkannt; numerische Entities dekodiert", () => {
  const evil = `<?xml version="1.0"?><!--${"x".repeat(5000)}--><!DOCTYPE x [<!ENTITY a "b">]><risdok/>`;
  assert.throws(() => parseRisXml(evil), (e: unknown) => e instanceof RisError);
  const xml = `<risdok xmlns="http://www.bka.gv.at"><nutzdaten><abschnitt><absatz>Mag.&#160;Dr.&#xA0;X</absatz></abschnitt></nutzdaten></risdok>`;
  assert.equal(parseRisXml(xml)[0]!.text, "Mag. Dr. X");
});

test("cleanText: Vergleichszeichen bleiben, keine Doppel-Dekodierung", () => {
  assert.equal(cleanText("x < 3 und y > 4"), "x < 3 und y > 4");
  assert.equal(cleanText("a &amp;lt; b"), "a &lt; b");
  assert.equal(cleanText("Titel<br/>StF: <A HREF=\"x\">LGBl</A>"), "Titel StF: LGBl");
});

test("defekte Prozent-Kodierung in Links bricht das Parsen nicht", () => {
  const json = JSON.parse(fixture("search-vfgh-rechtssatz.json"));
  const ref = json.OgdSearchResult.OgdDocumentResults.OgdDocumentReference[0];
  const et = ref.Data.Metadaten.Judikatur.Vfgh.Entscheidungstexte.item;
  (Array.isArray(et) ? et[0] : et).Dokumentnummer = "JFT_%E0%A4%A";
  assert.doesNotThrow(() => parseSearchResponse(json));
});

test("todayVienna liefert JJJJ-MM-TT in Wiener Zeit", () => {
  assert.equal(todayVienna(new Date("2026-12-31T23:30:00Z")), "2027-01-01");
  assert.match(todayVienna(), /^\d{4}-\d{2}-\d{2}$/);
});

test("HTTP 500 mit JSON-Fehler (Seite hinter dem Ende): kein Retry, verständliche Meldung", async () => {
  const body = JSON.stringify({ OgdSearchResult: { Error: { Applikation: "Judikatur", Message: "soap:Client Die Seitennummer ist höher als die Anzahl der Seiten" } } });
  const ff = fakeFetch(() => ({ status: 500, body }));
  const http = new RisHttp(testConfig(), { fetch: ff.fetch, sleep: async () => {} });
  await assert.rejects(
    http.getText(API + "page", { accept: "json", cacheTtlMs: 0 }),
    (e: unknown) => isInvalid(e) && /hinter dem Ende/.test((e as Error).message),
  );
  assert.equal(ff.calls.length, 1);
});
