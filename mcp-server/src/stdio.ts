#!/usr/bin/env node
/**
 * Einstiegspunkt für den stdio-Transport (Claude Desktop, Claude Code).
 * Kein Netzwerk-Listener, kein offener Port. stdout gehört ausschließlich
 * dem MCP-Protokoll – Logs gehen nach stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_VERSION } from "./config.js";
import { log } from "./log.js";
import { createDefaultClient, createServer } from "./server.js";

const [major] = process.versions.node.split(".").map(Number);
if (!major || major < 22) {
  process.stderr.write(`[openlaw-ris] Node.js >= 22 erforderlich, gefunden: ${process.versions.node}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const server = createServer(createDefaultClient());
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`RIS-MCP-Server ${SERVER_VERSION} bereit (stdio).`);

  const shutdown = async () => {
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("close", shutdown);
}

main().catch((e) => {
  log(`Startfehler: ${(e as Error)?.stack ?? String(e)}`);
  process.exit(1);
});
