import { test } from "node:test";
import assert from "node:assert/strict";
import { RisHttp } from "../src/ris/http.js";
import { RisError } from "../src/ris/errors.js";
import { loadConfig } from "../src/config.js";
import { fakeClock, fakeFetch, testConfig } from "./helpers.js";

const API = "https://data.bka.gv.at/ris/api/v2.6/Judikatur?Applikation=Justiz&Suchworte=";

test("Rate-Limit: aufeinanderfolgende Requests mit mindestens 2 s Abstand, seriell", async () => {
  const clock = fakeClock();
  const starts: number[] = [];
  const ff = fakeFetch(() => {
    starts.push(clock.now());
    return { body: "{}" };
  });
  const http = new RisHttp(testConfig(), { fetch: ff.fetch, now: clock.now, sleep: clock.sleep });
  // parallel angestoßen – müssen trotzdem seriell mit Abstand laufen
  await Promise.all([1, 2, 3].map((i) => http.getText(API + i, { accept: "json", cacheTtlMs: 0 })));
  assert.equal(starts.length, 3);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i]! - starts[i - 1]! >= 2000, `Abstand ${starts[i]! - starts[i - 1]!} ms`);
});

test("Konfiguration: Intervall kann nicht unter 2000 ms gesenkt werden", () => {
  assert.equal(loadConfig({ RIS_MIN_INTERVAL_MS: "100" }).minIntervalMs, 2000);
  assert.equal(loadConfig({ RIS_MIN_INTERVAL_MS: "5000" }).minIntervalMs, 5000);
});

test("User-Agent identifiziert die Anwendung", async () => {
  let ua = "";
  const http = new RisHttp(testConfig(), {
    fetch: async (_u, init) => {
      ua = String((init?.headers as Record<string, string>)["User-Agent"]);
      return new Response("{}", { headers: { "content-type": "application/json" } });
    },
    sleep: async () => {},
  });
  await http.getText(API + "ua", { accept: "json", cacheTtlMs: 0 });
  assert.match(ua, /^OpenLaw-RIS-MCP\/\d/);
});

test("Retry mit Backoff bei 503, danach Erfolg", async () => {
  const clock = fakeClock();
  let n = 0;
  const ff = fakeFetch(() => (++n < 3 ? { status: 503, body: "busy", contentType: "text/html" } : { body: '{"ok":1}' }));
  const http = new RisHttp(testConfig(), { fetch: ff.fetch, now: clock.now, sleep: clock.sleep });
  const t = await http.getText(API + "retry", { accept: "json", cacheTtlMs: 0 });
  assert.equal(t, '{"ok":1}');
  assert.equal(ff.calls.length, 3);
  assert.ok(clock.sleeps.includes(2000) && clock.sleeps.includes(4000), `Backoff-Pausen: ${clock.sleeps.join(",")}`);
});

test("Nach allen Versuchen: unavailable", async () => {
  const clock = fakeClock();
  const ff = fakeFetch(() => ({ status: 500, body: "x", contentType: "text/html" }));
  const http = new RisHttp(testConfig({ maxAttempts: 2 }), { fetch: ff.fetch, now: clock.now, sleep: clock.sleep });
  await assert.rejects(
    http.getText(API + "down", { accept: "json", cacheTtlMs: 0 }),
    (e: unknown) => e instanceof RisError && e.kind === "unavailable",
  );
  assert.equal(ff.calls.length, 2);
});

test("Kein Retry bei 404", async () => {
  const clock = fakeClock();
  const ff = fakeFetch(() => ({ status: 404, body: "<html>", contentType: "text/html" }));
  const http = new RisHttp(testConfig(), { fetch: ff.fetch, now: clock.now, sleep: clock.sleep });
  await assert.rejects(
    http.getText("https://ogd.ris.bka.gv.at/Dokumente/Justiz/X/X.xml", { accept: "xml", cacheTtlMs: 0 }),
    (e: unknown) => e instanceof RisError && e.kind === "not_found",
  );
  assert.equal(ff.calls.length, 1);
});

test("Timeout wird als unavailable gemeldet", async () => {
  const http = new RisHttp(testConfig({ timeoutMs: 20, maxAttempts: 1 }), {
    fetch: (_u, init) =>
      new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))),
    sleep: async () => {},
  });
  await assert.rejects(
    http.getText(API + "slow", { accept: "json", cacheTtlMs: 0 }),
    (e: unknown) => e instanceof RisError && e.kind === "unavailable" && /Zeitüberschreitung/.test(e.message),
  );
});

test("SSRF-Schutz: fremde Hosts, http und Redirects nach außen werden abgelehnt", async () => {
  const ff = fakeFetch((u) =>
    u.pathname === "/redir" ? { status: 302, headers: { location: "https://evil.example.com/x" } } : { body: "{}" },
  );
  const http = new RisHttp(testConfig(), { fetch: ff.fetch, sleep: async () => {} });
  for (const bad of ["https://evil.example.com/x", "http://data.bka.gv.at/x", "https://data.bka.gv.at:8443/x", "file:///etc/passwd"]) {
    await assert.rejects(
      http.getText(bad, { accept: "json", cacheTtlMs: 0 }),
      (e: unknown) => e instanceof RisError && e.kind === "invalid_params",
      bad,
    );
  }
  await assert.rejects(
    http.getText("https://data.bka.gv.at/redir", { accept: "json", cacheTtlMs: 0 }),
    (e: unknown) => e instanceof RisError && /nicht erlaubt/.test(e.message),
  );
  assert.ok(!ff.calls.some((c) => c.includes("evil")), "fremder Host darf nie kontaktiert werden");
});

test("Antwortgröße ist begrenzt", async () => {
  const ff = fakeFetch(() => ({ body: "x".repeat(5000) }));
  const http = new RisHttp(testConfig({ maxResponseBytes: 1000 }), { fetch: ff.fetch, sleep: async () => {} });
  await assert.rejects(
    http.getText(API + "big", { accept: "json", cacheTtlMs: 0 }),
    (e: unknown) => e instanceof RisError && /zu groß/.test(e.message),
  );
});

test("XML erwartet, HTML geliefert → not_found", async () => {
  const ff = fakeFetch(() => ({ body: "<html>", contentType: "text/html" }));
  const http = new RisHttp(testConfig(), { fetch: ff.fetch, sleep: async () => {} });
  await assert.rejects(
    http.getText("https://ogd.ris.bka.gv.at/Dokumente/Justiz/X/X.xml", { accept: "xml", cacheTtlMs: 0 }),
    (e: unknown) => e instanceof RisError && e.kind === "not_found",
  );
});

test("Cache: zweiter Abruf derselben URL ohne neuen Request", async () => {
  const ff = fakeFetch(() => ({ body: "{}" }));
  const http = new RisHttp(testConfig(), { fetch: ff.fetch, sleep: async () => {} });
  await http.getText(API + "cache", { accept: "json", cacheTtlMs: 60_000 });
  await http.getText(API + "cache", { accept: "json", cacheTtlMs: 60_000 });
  assert.equal(ff.calls.length, 1);
});
