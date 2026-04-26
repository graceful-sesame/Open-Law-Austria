/**
 * linkifyRefs.ts — Intelligente §-Verlinkung im RIS-HTML
 *
 *   Bug 1: "§§ 429 ff StPO" / "§§ 157 f, 164 ff StVG" korrekt verlinkt.
 *          FOLLOW_SUFFIX konsumiert "f"/"ff" (und folgende) als Teil von SINGLE,
 *          sodass ABBREV_PART die nachfolgende Gesetzesabkürzung korrekt erkennt.
 *   Bug 2: "§§ 75, 76, 84 Abs. 4 oder Abs. 5 Z 1 oder 3, 85 Abs. 2, 86 Abs. 2 oder 87"
 *          → alle Paragraphen werden einzeln verlinkt.
 *          - ABS erweitert: erlaubt "oder/und Abs. X" und "Z X oder Y" Ziffer-Klauseln
 *          - "oder" und "bis" als weitere Listenseparatoren in LIST_SEP
 */

export interface LawRegistryEntry {
  lawId: string;
  abkuerzung: string;
  gesetzesnummer: string;
}

export interface ParaDoc {
  dokumentnummer: string;
  artikelParagraphAnlage: string;
}

function normPara(s: string): string {
  return s.trim().toLowerCase();
}

export function findNorForPara(docs: ParaDoc[], paraNum: string): string | null {
  const target = normPara(paraNum);
  const found = docs.find((d) => {
    const m = d.artikelParagraphAnlage?.match(
      /^(?:§§?|Art\.?|Artikel|Anlage)\s*(\S+)/i
    );
    return m != null && normPara(m[1]) === target;
  });
  return found?.dokumentnummer ?? null;
}

const PROPAGATED_MARKER = '\x01';

const HTML_ARTIFACT_ABBREVS = new Set(['Ab', 'Abs']);

function propagateTrailingAbbrev(text: string): string {
  const WS = '(?:&nbsp;|[ \\t])';
  const NUM = '\\d+[a-zA-Z]?';
  const ABS = `(?:${WS}+Abs\\.?${WS}*\\d+(?:${WS}+und${WS}+\\d+(?!\\d)(?!${WS}*Abs))?)?`;
  const FOLLOW_SUFFIX = `(?:${WS}+ff?(?![a-zA-Z\u00f6\u00e4\u00fc\u00d6\u00c4\u00dc\u00df0-9]))?`;
  const BARE_PARA = `\u00a7\u00a7?${WS}+${NUM}${ABS}${FOLLOW_SUFFIX}`;
  const LIST_SEP = `(?:,${WS}*(?:(?:und|sowie|oder)${WS}+)?|${WS}+(?:und|sowie|oder|bis)${WS}+)`;
  const ABBREV = `[A-Z\u00d6\u00c4\u00dc][A-Za-z\u00f6\u00e4\u00fc\u00d6\u00c4\u00dc0-9]+`;

  const re = new RegExp(
    `(${BARE_PARA}(?:${LIST_SEP}${BARE_PARA})+)` +
    `(?:${WS}+(${ABBREV})(?!\\.))`,
    'g'
  );

  const bareParaRe = new RegExp(BARE_PARA, 'g');

  return text.replace(re, (_fullMatch: string, paraGroup: string, abbrev: string) => {
    const totalMatches = (paraGroup.match(new RegExp(BARE_PARA, 'g')) ?? []).length;
    let matchCount = 0;
    bareParaRe.lastIndex = 0;
    return paraGroup.replace(bareParaRe, (m: string) => {
      matchCount++;
      const isLast = matchCount === totalMatches;
      return isLast ? `${m} ${abbrev}` : `${m} ${PROPAGATED_MARKER}${abbrev}`;
    });
  });
}

function processTextNode(
  text: string,
  docs: ParaDoc[],
  lawRegistry: LawRegistryEntry[],
  currentLawId: string,
  currentGesetzesnummer: string
): string {
  if (!text.includes('\u00a7')) return text;

  const preprocessed = propagateTrailingAbbrev(text);

  const WS = '(?:&nbsp;|[ \\t])';
  const NUM = '\\d+[a-zA-Z]?';
  // damit ABBREV_PART die Gesetzesabkürzung danach korrekt erkennt.
  // (?![a-zA-ZöäüÖÄÜß0-9]) verhindert, dass "f" aus "für", "folgende" etc.
  // fälschlicherweise als Suffix erkannt wird.
  const FOLLOW_SUFFIX = `(?:${WS}+ff?(?![a-zA-Z\u00f6\u00e4\u00fc\u00d6\u00c4\u00dc\u00df0-9]))?`;
  const ABS_CLAUSE = `Abs\\.?${WS}*\\d+(?:${WS}+Z${WS}+\\d+(?:${WS}+oder${WS}+\\d+(?!\\d))*)?`;
  const ABS = `(?:${WS}+${ABS_CLAUSE}(?:${WS}+(?:und|oder)${WS}+${ABS_CLAUSE})*)?`;

  const SINGLE = `${NUM}${ABS}${FOLLOW_SUFFIX}`;
  const LIST_SEP = `(?:,${WS}*(?:(?:und|sowie|oder)${WS}+)?|${WS}+(?:und|sowie|oder|bis)${WS}+)`;
  const LIST = `${SINGLE}(?:${LIST_SEP}${SINGLE})*`;

  const ABBREV_PART = `(?:${WS}+(\x01?[A-Z\u00d6\u00c4\u00dc][A-Za-z\u00f6\u00e4\u00fc\u00d6\u00c4\u00dc0-9]+)(?!\\.))?`;

  const re = new RegExp(`(\u00a7\u00a7?)${WS}+(${LIST})${ABBREV_PART}`, 'g');

  return preprocessed.replace(re, (fullMatch, signum, paraList, abbrev) => {
    let targetLawId = currentLawId;
    let targetGesetzesnummer = currentGesetzesnummer;
    let effectiveAbbrev: string | undefined = abbrev;

    const abbrevClean = abbrev ? abbrev.replace(PROPAGATED_MARKER, '') : abbrev;
    const abbrevIsPropagated = abbrev ? abbrev.startsWith(PROPAGATED_MARKER) : false;

    if (abbrevClean) {
      const targetLaw = lawRegistry.find(
        (l) => l.abkuerzung.toLowerCase() === abbrevClean.toLowerCase()
      );
      if (!targetLaw) {
        effectiveAbbrev = undefined;
      } else {
        targetLawId = targetLaw.lawId;
        targetGesetzesnummer = targetLaw.gesetzesnummer;
        effectiveAbbrev = abbrevIsPropagated ? undefined : abbrevClean;
      }
    }

    const isSameLaw = !abbrevClean || (!lawRegistry.find(
      (l) => l.abkuerzung.toLowerCase() === abbrevClean.toLowerCase()
    ));

    const singleRe = new RegExp(`(${SINGLE})|(${LIST_SEP})`, 'g');
    type Token = { type: 'para' | 'sep'; text: string };
    const tokens: Token[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;

    while ((m = singleRe.exec(paraList)) !== null) {
      if (m.index > lastIdx) {
        tokens.push({ type: 'sep', text: paraList.slice(lastIdx, m.index) });
      }
      if (m[1] !== undefined) {
        tokens.push({ type: 'para', text: m[1] });
      } else if (m[2] !== undefined) {
        tokens.push({ type: 'sep', text: m[2] });
      }
      lastIdx = singleRe.lastIndex;
    }
    if (lastIdx < paraList.length) {
      tokens.push({ type: 'sep', text: paraList.slice(lastIdx) });
    }

    const paraTokens = tokens.filter((t) => t.type === 'para');
    if (paraTokens.length === 0) return fullMatch;

    const wsAfterSignum =
      fullMatch.slice(signum.length).match(/^(?:&nbsp;|[ \t])+/)?.[0] ?? ' ';

    let result = '';
    let isFirst = true;

    for (const token of tokens) {
      if (token.type === 'sep') {
        result += token.text;
      } else {
        const paraNum = token.text.trim().match(/^(\d+[a-zA-Z]?)/)?.[1] ?? '';
        if (!paraNum) {
          result += token.text;
          continue;
        }

        const norId = isSameLaw ? findNorForPara(docs, paraNum) : null;
        let dataAtts: string;
        if (norId) {
          dataAtts = `data-nor="${norId}" data-law-id="${targetLawId}" data-paras="${paraNum}"`;
        } else {
          dataAtts = `data-para="${paraNum}" data-law-id="${targetLawId}" data-gn="${targetGesetzesnummer}" data-paras="${paraNum}"`;
        }

        const prefix = isFirst ? signum + wsAfterSignum : '';
        result += `<a class="ola-para-link" ${dataAtts}>${prefix}${token.text}</a>`;
        isFirst = false;
      }
    }

    if (effectiveAbbrev) {
      result += ' ' + effectiveAbbrev;
    } else if (abbrevClean && !abbrevIsPropagated && !HTML_ARTIFACT_ABBREVS.has(abbrevClean)) {
      result += ' ' + abbrevClean;
    }

    return result;
  });
}

export function linkifyLegalRefs(
  html: string,
  docs: ParaDoc[],
  lawRegistry: LawRegistryEntry[],
  currentLawId: string,
  currentGesetzesnummer: string
): string {
  if (!html.includes('\u00a7')) return html;

  const parts = html.split(/(<[^>]*(?:"[^"]*"[^>]*)?>)/);

  let insideLink = 0;

  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        const tag = part.toLowerCase();
        if (/^<a[\s>]/.test(tag)) insideLink++;
        if (/^<\/a\s*>/.test(tag)) insideLink = Math.max(0, insideLink - 1);
        return part;
      }
      if (insideLink > 0) return part;
      return processTextNode(part, docs, lawRegistry, currentLawId, currentGesetzesnummer);
    })
    .join('');
}
