import { readFileSync } from "node:fs";
import { loadConfig, type RisConfig } from "../src/config.js";
import { RisClient } from "../src/ris/client.js";
import { RisHttp, type FetchLike } from "../src/ris/http.js";

export function fixture(name: string): string {
  // build/test/helpers.js → ../../test/fixtures
  return readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), "utf8");
}

export interface FakeResponse {
  status?: number;
  body?: string;
  contentType?: string;
  headers?: Record<string, string>;
}

export type Route = (url: URL) => FakeResponse | undefined;

/** Fake-fetch, protokolliert alle Aufrufe. */
export function fakeFetch(route: Route): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetch: FetchLike = async (input) => {
    calls.push(input);
    const r = route(new URL(input));
    if (!r) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(r.body ?? "", {
      status: r.status ?? 200,
      headers: { "content-type": r.contentType ?? "application/json; charset=utf-8", ...(r.headers ?? {}) },
    });
  };
  return { fetch, calls };
}

/** Virtuelle Uhr: sleep() rückt die Zeit vor statt zu warten. */
export function fakeClock(start = 1_000_000) {
  let now = start;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    sleeps,
  };
}

export function testConfig(overrides: Partial<RisConfig> = {}): RisConfig {
  return { ...loadConfig({}), ...overrides };
}

export function makeClient(route: Route, overrides: Partial<RisConfig> = {}) {
  const config = testConfig(overrides);
  const clock = fakeClock();
  const ff = fakeFetch(route);
  const http = new RisHttp(config, { fetch: ff.fetch, now: clock.now, sleep: clock.sleep });
  return { client: new RisClient(config, http), calls: ff.calls, clock, config };
}

/** Standard-Routen: Suche → JSON-Fixture, Dokument → XML-Fixture. */
export function standardRoute(searchFixture = "search-justiz.json"): Route {
  return (url) => {
    if (url.hostname === "data.bka.gv.at") return { body: fixture(searchFixture) };
    if (url.hostname === "ogd.ris.bka.gv.at") {
      const map: Record<string, string> = {
        "/Dokumente/Justiz/JJR_TEST/JJR_TEST.xml": "rechtssatz-JJR.xml",
        "/Dokumente/Bundesnormen/NOR40166560/NOR40166560.xml": "norm-stgb288.xml",
        "/Dokumente/Vwgh/JWT_TEST/JWT_TEST.xml": "vwgh-JWT.xml",
      };
      const f = map[url.pathname];
      if (f) return { body: fixture(f), contentType: "application/xml; charset=utf-8" };
    }
    return undefined;
  };
}
