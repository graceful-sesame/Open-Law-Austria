/**
 * Laufzeit-Konfiguration. Alle Werte haben sichere Defaults; nichts davon ist
 * geheim. Überschreibbar per Umgebungsvariable (z. B. im "env"-Block von
 * claude_desktop_config.json).
 */

export const SERVER_NAME = "openlaw-ris";
export const SERVER_VERSION = "0.1.0";

/** Netiquette der RIS-OGD-Schnittstelle: höchstens 0,5 Requests/Sekunde. */
export const MIN_REQUEST_INTERVAL_FLOOR_MS = 2000;

export interface RisConfig {
  /** Basis-URL der OGD-API (Suche). */
  apiBase: string;
  /** Basis-URL für Dokumentinhalte (XML/HTML). */
  contentBase: string;
  /** Basis-URL für menschenlesbare Links. */
  linkBase: string;
  /** Abstand zwischen zwei Requests (nie unter 2000 ms). */
  minIntervalMs: number;
  /** Timeout pro Request. */
  timeoutMs: number;
  /** Maximale Versuche pro Request (inkl. erstem Versuch). */
  maxAttempts: number;
  /** Maximale Antwortgröße in Bytes. */
  maxResponseBytes: number;
  /** User-Agent-Header. */
  userAgent: string;
  /** Cache-Lebensdauer für Suchergebnisse. */
  searchCacheTtlMs: number;
  /** Cache-Lebensdauer für Dokumente. */
  documentCacheTtlMs: number;
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RisConfig {
  const contact = env.RIS_CONTACT?.trim();
  const ua =
    `OpenLaw-RIS-MCP/${SERVER_VERSION} (+https://github.com/graceful-sesame/Open-Law-Austria` +
    (contact ? `; ${contact}` : "") +
    ")";
  return {
    apiBase: "https://data.bka.gv.at/ris/api/v2.6",
    contentBase: "https://ogd.ris.bka.gv.at/Dokumente",
    linkBase: "https://ris.bka.gv.at",
    minIntervalMs: Math.max(MIN_REQUEST_INTERVAL_FLOOR_MS, intEnv(env, "RIS_MIN_INTERVAL_MS", MIN_REQUEST_INTERVAL_FLOOR_MS)),
    timeoutMs: Math.max(5000, intEnv(env, "RIS_TIMEOUT_MS", 30000)),
    maxAttempts: Math.min(5, Math.max(1, intEnv(env, "RIS_MAX_ATTEMPTS", 3))),
    maxResponseBytes: 15 * 1024 * 1024,
    userAgent: ua,
    searchCacheTtlMs: intEnv(env, "RIS_SEARCH_CACHE_TTL_MS", 10 * 60 * 1000),
    documentCacheTtlMs: intEnv(env, "RIS_DOCUMENT_CACHE_TTL_MS", 60 * 60 * 1000),
  };
}

/** Erlaubte Hosts für ausgehende Requests (Schutz gegen SSRF). */
export const ALLOWED_HOSTS = new Set(["data.bka.gv.at", "ogd.ris.bka.gv.at"]);

export const ATTRIBUTION =
  "Datenquelle: RIS – Rechtsinformationssystem des Bundes (https://www.ris.bka.gv.at), CC BY 4.0. " +
  "Nicht amtlich; rechtsverbindlich sind nur die authentischen Kundmachungen.";
