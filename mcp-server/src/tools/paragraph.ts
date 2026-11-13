import { RisError } from "../ris/errors.js";

export type AbschnittTyp = "Paragraph" | "Artikel" | "Anlage";

export interface ParagraphQuery {
  von: string;
  bis: string;
  typ: AbschnittTyp;
  /** Exakte Bezeichnung (z. B. "5a"), wenn clientseitig gefiltert werden muss. */
  exact?: string;
}

/**
 * Zerlegt Eingaben wie "288", "§ 288", "5a", "§§ 278-279", "Art 7", "Art. 15a", "Anlage 1".
 * Die API filtert per Abschnitt.Von/Bis nur numerisch: "5a" erfordert Von=5, Bis=6 und
 * anschließendes exaktes Filtern.
 */
export function parseParagraph(input: string, typHint?: AbschnittTyp): ParagraphQuery {
  let s = input.trim();
  let typ: AbschnittTyp | undefined = typHint;
  if (/^(artikel|art\.?)\s*/i.test(s)) {
    typ = "Artikel";
    s = s.replace(/^(artikel|art\.?)\s*/i, "");
  } else if (/^anlage\s*/i.test(s)) {
    typ = "Anlage";
    s = s.replace(/^anlage\s*/i, "");
  } else {
    s = s.replace(/^§§?\s*/, "");
  }
  // Untergliederungen ("Abs 1", "Z 3", "lit a", "Satz 2") betreffen nur den Text, nicht die Suche.
  s = s.replace(/\s*(Abs\.?|Absatz|Z\s*\d|Ziffer|lit\.?|Satz|S\s*\d)\b.*$/i, "");
  s = s.replace(/\s+/g, "").replace(/\.$/, "");

  const range = s.match(/^(\d+)([a-z]?)(?:-|–|bis)(\d+)([a-z]?)$/i);
  if (range) {
    const von = range[1]!;
    const bisNum = Number.parseInt(range[3]!, 10) + (range[4] ? 1 : 0);
    return { von, bis: String(bisNum), typ: typ ?? "Paragraph" };
  }
  const single = s.match(/^(\d+)([a-z]{0,2})$/i);
  if (!single) {
    throw new RisError(
      "invalid_params",
      `Paragraph/Artikel "${input}" nicht verständlich.`,
      'Beispiele: "288", "5a", "278-279", "Art 7", "Art 15a", "Anlage 1".',
    );
  }
  const num = single[1]!;
  const suffix = single[2]!.toLowerCase();
  if (suffix) {
    return { von: num, bis: String(Number.parseInt(num, 10) + 1), typ: typ ?? "Paragraph", exact: num + suffix };
  }
  return { von: num, bis: num, typ: typ ?? "Paragraph", exact: num };
}

/** "§ 5a" / "Art. 15a" / "Anlage 1" → "5a" / "15a" / "1" (für exakten Vergleich). */
export function normalizeParagraphLabel(label: string): string {
  return label
    .replace(/^(§§?|artikel|art\.?|anlage)\s*/i, "")
    .replace(/[\s.]/g, "")
    .toLowerCase();
}
