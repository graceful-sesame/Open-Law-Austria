export type RisErrorKind =
  /** Ungültige Parameter (lokal geprüft oder von der API abgelehnt). */
  | "invalid_params"
  /** Dokument existiert nicht / kein Volltext verfügbar. */
  | "not_found"
  /** RIS nicht erreichbar, Timeout, 5xx nach allen Retries. */
  | "unavailable"
  /** Unerwartete Antwort (Format, Größe, Host). */
  | "bad_response";

export class RisError extends Error {
  constructor(
    public readonly kind: RisErrorKind,
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "RisError";
  }
}

export function isRisError(e: unknown): e is RisError {
  return e instanceof RisError;
}
