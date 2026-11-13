/**
 * Live-Tests gegen die echte RIS-API (opt-in: `npm run test:live`).
 * Bewusst wenige Requests – das Rate-Limit (2 s) gilt auch hier.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDefaultClient } from "../src/server.js";
import { JUDIKATUR_APPS, BUNDESRECHT_APPS } from "../src/ris/applications.js";
import { getStr } from "../src/ris/normalize.js";
import { runGetNorm } from "../src/tools/getNorm.js";

const client = createDefaultClient();

test("live: Judikatur-Suche (OGH-Rechtssätze zu § 288 StGB)", async () => {
  const res = await client.search(JUDIKATUR_APPS.Justiz, {
    Norm: "StGB §288",
    Gericht: "OGH",
    "Dokumenttyp.SucheInRechtssaetzen": "True",
    DokumenteProSeite: "Ten",
  });
  assert.ok(res.total > 10, `Treffer: ${res.total}`);
  assert.ok(res.hits.every((h) => getStr(h.meta, "Dokumenttyp") === "Rechtssatz"));
});

test("live: Rechtssatz-Volltext als XML", async () => {
  const doc = await client.getDocument("JJR_20250402_OGH0002_0120OS00026_25B0000_000");
  assert.ok(doc.sections.some((s) => s.title === "Rechtssatz" && /Europäischen Ermittlungsanordnung/.test(s.text)));
});

test("live: Bundesrecht mit Stichtag", async () => {
  const res = await client.search(BUNDESRECHT_APPS.BrKons, {
    Gesetzesnummer: "10002296",
    "Abschnitt.Von": "288",
    "Abschnitt.Bis": "288",
    "Abschnitt.Typ": "Paragraph",
    "Fassung.FassungVom": "2020-01-01",
  });
  assert.equal(res.hits.length, 1);
  assert.equal(getStr(res.hits[0]!.meta, "Inkrafttretensdatum"), "2014-12-30");
});

test("live: get_norm § 288 StGB", async () => {
  const r = await runGetNorm(client, { gesetz: "StGB", paragraph: "288" });
  const text = (r.content[0] as { text: string }).text;
  assert.match(text, /Falsche Beweisaussage/);
  assert.match(text, /Gesetzesnummer: 10002296/);
});
