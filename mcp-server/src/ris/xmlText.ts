import { XMLParser } from "fast-xml-parser";
import { RisError } from "./errors.js";

/**
 * Wandelt RIS-Dokument-XML (<risdok>) in strukturierten Klartext um.
 *
 * Aufbau: nutzdaten > abschnitt > Folge von
 *   <ueberschrift typ="titel">Rubrik</ueberschrift>  (z. B. "Gericht", "Spruch", "Text")
 *   <absatz>…</absatz>, <liste>…</liste>, <table>…</table>, Unterüberschriften (g1/g2/para) …
 * Kopf-/Fußzeilen (kzinhalt/fzinhalt) und Layoutdaten werden verworfen.
 */

export interface DocSection {
  title: string;
  text: string;
}

type XNode = Record<string, unknown>;

const SKIP = new Set(["kzinhalt", "fzinhalt", "layoutdaten", "metadaten", "?xml", "#comment", "img", "binary"]);
const BLOCK_INLINE = new Set(["absatz", "ueberschrift", "listelem", "schlussteil", "td", "th"]);

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: false,
  removeNSPrefix: true,
});

function tagOf(node: XNode): string | undefined {
  return Object.keys(node).find((k) => k !== ":@");
}

function attrs(node: XNode): Record<string, string> {
  return (node[":@"] as Record<string, string> | undefined) ?? {};
}

function children(node: XNode, tag: string): XNode[] {
  const c = node[tag];
  return Array.isArray(c) ? (c as XNode[]) : [];
}

/** Inline-Text eines Elements (rekursiv). */
function inlineText(nodes: XNode[]): string {
  let out = "";
  for (const n of nodes) {
    const tag = tagOf(n);
    if (!tag) continue;
    if (tag === "#text") {
      out += String(n["#text"] ?? "");
      continue;
    }
    if (SKIP.has(tag)) continue;
    switch (tag) {
      case "tab":
        out += " ";
        break;
      case "br":
        out += "\n";
        break;
      case "gdash":
        out += "-";
        break;
      case "symbol":
      case "gldsym":
        out += inlineText(children(n, tag)) + " ";
        break;
      case "sup":
        out += "^" + inlineText(children(n, tag));
        break;
      default:
        out += inlineText(children(n, tag));
    }
  }
  return out;
}

function normalizeInline(s: string): string {
  return s
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t\r\f\v]+/g, " ").trim())
    .filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n")
    .trim();
}

interface WalkState {
  sections: { title: string; blocks: string[] }[];
  level: number;
}

function current(state: WalkState) {
  let s = state.sections[state.sections.length - 1];
  if (!s) {
    s = { title: "", blocks: [] };
    state.sections.push(s);
  }
  return s;
}

function walk(nodes: XNode[], state: WalkState): void {
  for (const n of nodes) {
    const tag = tagOf(n);
    if (!tag || SKIP.has(tag)) continue;
    if (tag === "#text") {
      const t = normalizeInline(String(n["#text"] ?? ""));
      if (t) current(state).blocks.push(t);
      continue;
    }
    const a = attrs(n);
    const kids = children(n, tag);

    if (tag === "ueberschrift" && a.typ === "titel") {
      state.sections.push({ title: normalizeInline(inlineText(kids)), blocks: [] });
      continue;
    }
    if (tag === "aufzaehlung" || tag === "schlussteil") {
      const ebene = Number.parseFloat(a.ebene ?? "1");
      const prev = state.level;
      state.level = Number.isFinite(ebene) ? Math.max(0, Math.ceil(ebene)) : prev;
      if (tag === "schlussteil") {
        const t = normalizeInline(inlineText(kids));
        if (t) current(state).blocks.push(indent(t, Math.max(0, state.level - 1)));
      } else {
        walk(kids, state);
      }
      state.level = prev;
      continue;
    }
    if (tag === "tr") {
      const cells = kids
        .filter((c) => {
          const t = tagOf(c);
          return t === "td" || t === "th";
        })
        .map((c) => normalizeInline(inlineText(children(c, tagOf(c)!))).replace(/\n/g, " "));
      if (cells.some((c) => c !== "")) current(state).blocks.push("| " + cells.join(" | ") + " |");
      continue;
    }
    if (BLOCK_INLINE.has(tag)) {
      const t = normalizeInline(inlineText(kids));
      if (!t) continue;
      const lvl = tag === "listelem" ? Math.max(0, state.level - 1) : 0;
      current(state).blocks.push(indent(t, lvl));
      continue;
    }
    // Container (risdok, nutzdaten, abschnitt, liste, table, tbody, …)
    walk(kids, state);
  }
}

function indent(text: string, level: number): string {
  if (level <= 0) return text;
  const pad = "  ".repeat(level);
  return text
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

export function parseRisXml(xml: string): DocSection[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml.slice(0, 2000))) {
    throw new RisError("bad_response", "Dokument enthält eine DOCTYPE-Deklaration und wird aus Sicherheitsgründen nicht verarbeitet.");
  }
  let tree: XNode[];
  try {
    tree = parser.parse(xml) as XNode[];
  } catch (e) {
    throw new RisError("bad_response", `Dokument-XML nicht lesbar: ${(e as Error).message}`);
  }
  const state: WalkState = { sections: [], level: 0 };
  walk(tree, state);
  return state.sections
    .map((s) => ({ title: s.title, text: s.blocks.join("\n\n") }))
    .filter((s) => s.title !== "" || s.text !== "");
}
