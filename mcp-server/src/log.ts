/**
 * Logging ausschließlich nach stderr: Bei stdio-Transport gehört stdout allein
 * dem JSON-RPC-Protokoll. Niemals console.log verwenden.
 */
export function log(message: string): void {
  if (process.env.RIS_QUIET === "1") return;
  process.stderr.write(`[openlaw-ris] ${message}\n`);
}
