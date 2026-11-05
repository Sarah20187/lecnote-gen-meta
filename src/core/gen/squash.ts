// How a quote is found on a slide (in-app generation; docs/formats/check_structure.py `squash`):
// both sides are folded the same way — NFKC, lower case, one form of quotes and dashes, the fi/fl
// ligatures spelt out, no whitespace — so a quote survives the text layer's line breaks and
// layout spacing. Matches the Python checkers exactly: their verdicts are the reference.

/** Python's `\s` on str: Unicode whitespace plus the separators \x1c–\x1f and \x85, which JS's `\s` leaves out. */
const SPACE = /[\s\x1c-\x1f\x85]+/g;
const FOLD: readonly (readonly [string, string])[] = [
  ["’", "'"],
  ["‘", "'"],
  ["“", '"'],
  ["”", '"'],
  ["–", "-"],
  ["—", "-"],
  ["−", "-"],
  ["ﬁ", "fi"],
  ["ﬂ", "fl"],
];

export function squash(s: string): string {
  let out = s.normalize("NFKC").toLowerCase();
  for (const [a, b] of FOLD) out = out.split(a).join(b);
  return out.replace(SPACE, "");
}

/** Is the quote on the page? Both are squashed; an empty quote is on no page. */
export function quoteOnPage(pageText: string, quote: string): boolean {
  const q = squash(quote);
  return q.length > 0 && squash(pageText).includes(q);
}

/** The 1-based pages of a deck whose text holds the quote, in page order. `deckTexts[i]` is page i + 1. */
export function findQuote(deckTexts: readonly string[], quote: string): number[] {
  const q = squash(quote);
  if (!q) return [];
  return deckTexts.flatMap((text, i) => (squash(text).includes(q) ? [i + 1] : []));
}

/** Length in code points, as Python's `len` counts it (an astral character such as 𝜃 is one, not two). */
export const cpLength = (s: string): number => [...s].length;

/** Python's `str.split()` word count: runs of whitespace separate words, leading and trailing ones count for nothing. */
export const wordCount = (s: string): number => s.split(SPACE).filter(Boolean).length;
