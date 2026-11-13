import type { RisConfig } from "../config.js";
import { disallowedParams, type AppInfo } from "./applications.js";
import { contentUrl, documentLink, resolveDocumentApp, validateDocumentId } from "./documentId.js";
import { RisError } from "./errors.js";
import { RisHttp } from "./http.js";
import { parseSearchResponse, type SearchResult } from "./normalize.js";
import { parseRisXml, type DocSection } from "./xmlText.js";

export interface RisDocument {
  id: string;
  app: AppInfo;
  link: string;
  xmlUrl: string;
  sections: DocSection[];
}

/**
 * Transport-unabhängiger RIS-Client: kennt nur die API, kein MCP.
 * Wiederverwendbar für stdio- und (später) HTTP-Transport.
 */
export class RisClient {
  constructor(
    readonly config: RisConfig,
    private readonly http: RisHttp,
  ) {}

  /** Suche in einer Applikation. `params` sind API-Parameternamen → Wert. */
  async search(appInfo: AppInfo, params: Record<string, string>, signal?: AbortSignal): Promise<SearchResult> {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (k.toLowerCase() === "applikation") {
        throw new RisError("invalid_params", "Der Parameter \"Applikation\" darf nicht überschrieben werden – bitte das Feld `applikation` des Tools verwenden.");
      }
      if (v === undefined || v === null || String(v).trim() === "") continue;
      // Checkbox-Parameter (…SucheInX) wertet die API nach Anwesenheit aus: "False" würde
      // als "True" gelten. Daher werden falsche Werte weggelassen.
      if (/\.SucheIn/.test(k) && /^(false|0|nein)$/i.test(String(v).trim())) continue;
      clean[k] = String(v).trim();
    }
    const bad = disallowedParams(appInfo, clean);
    if (bad.length) {
      throw new RisError(
        "invalid_params",
        `Parameter ${bad.map((b) => `"${b}"`).join(", ")} wird von Applikation ${appInfo.name} nicht unterstützt.`,
        `Erlaubte API-Parameter für ${appInfo.name}: ${appInfo.params.join(", ")}`,
      );
    }
    const url = new URL(`${this.config.apiBase}/${appInfo.endpoint}`);
    url.searchParams.set("Applikation", appInfo.name);
    for (const [k, v] of Object.entries(clean)) url.searchParams.set(k, v);
    const json = await this.http.getJson(url.toString(), this.config.searchCacheTtlMs, signal);
    return parseSearchResponse(json);
  }

  /** Lädt ein Dokument als strukturierten Text (über die XML-Fassung). */
  async getDocument(rawId: string, explicitApp?: string, signal?: AbortSignal): Promise<RisDocument> {
    const id = validateDocumentId(rawId);
    const app = resolveDocumentApp(id, explicitApp);
    const xmlUrl = contentUrl(this.config.contentBase, app, id, "xml");
    const link = documentLink(this.config.linkBase, app, id);
    let xml: string;
    try {
      xml = await this.http.getText(xmlUrl, { accept: "xml", cacheTtlMs: this.config.documentCacheTtlMs, signal });
    } catch (e) {
      if (e instanceof RisError && e.kind === "not_found") {
        throw new RisError(
          "not_found",
          `Zu "${id}" (${app.name}) gibt es keinen maschinenlesbaren Volltext.`,
          `Entweder ist die Dokumentnummer falsch oder das Dokument liegt nur als PDF vor. Ansicht im RIS: ${link}`,
        );
      }
      throw e;
    }
    const sections = parseRisXml(xml);
    if (sections.length === 0) {
      throw new RisError("not_found", `Dokument "${id}" enthält keinen Text.`, `Ansicht im RIS: ${link}`);
    }
    return { id, app, link, xmlUrl, sections };
  }
}

export function createRisClient(config: RisConfig, http?: RisHttp): RisClient {
  return new RisClient(config, http ?? new RisHttp(config));
}
