// How big a generated knowledge map may be and how long its texts (in-app generation). The
// numbers are docs/formats/check_structure.py's and check_formulas.py's, set on REFERENCE (12 lectures,
// 426 pages); a map's counts scale with the course. A file the app makes is held to the user's
// tighter limits (D9: gist ≤ 60, en gist ≤ 140) and its core flags need evidence (D8); a
// hand-made file keeps the checkers' numbers. Counts are errors for a new map and warnings for an
// update, which must not reshape what the student already knows.

export type Severity = "error" | "warning";
/** `full`: a new map or sheet; `patch`: an update to one whose ids are frozen. */
export type CheckMode = "full" | "patch";
export type Range = readonly [min: number, max: number];

export interface StructureTargets {
  threads: Range;
  strandsPerThread: Range;
  conceptsPerStrand: Range;
  concepts: Range;
  /** The share of concepts flagged core, at most. */
  coreShare: number;
  links: Range;
  contrasts: Range;
  contrastMembers: Range;
  tour: Range;
}

/** The fixed text limits, in code points (Python's `len`), and ref counts. */
export const TEXT = {
  title: 24,
  alsoRefs: 6,
  /** A quote squashed (squash.ts) is at least this long. */
  quoteChars: 4,
  nodeFormulaNote: 70,
  en: { label: 60, title: 70, question: 160, nodeFormulaNote: 160, contrastTitle: 70, tourTitle: 60, tourText: 700 },
  formula: { name: 24, note: 80, trap: 60, alsoRefs: 3, en: { name: 70, note: 180, trap: 140 } },
} as const;

export interface Limits {
  /** Made by the app: a core flag needs the teacher's own signal on a slide as evidence (D8). */
  appMade: boolean;
  /** A node's Chinese gist. */
  gist: number;
  /** A node's English gist. */
  enGist: number;
  /** Words in a quote. */
  quoteWords: Range;
  targets: StructureTargets;
}

/** The course the numbers were set on. */
const REFERENCE = { pages: 426, lectures: 12 };

/** A course's size next to REFERENCE's: half by pages (how much the slides say), half by lectures (how many topics). */
const courseScale = (pages: number, lectures: number) => (pages / REFERENCE.pages + lectures / REFERENCE.lectures) / 2;
/** REFERENCE's range scaled, never below `least` (and its top never below twice that). */
const scaled = ([lo, hi]: Range, s: number, least: number): Range => [Math.max(least, Math.round(lo * s)), Math.max(2 * least, Math.round(hi * s))];

/**
 * The map's size for a course of these pages and lectures: REFERENCE's 55–85 concepts, 10–30 links and
 * 6–12 contrasts scaled to the course (at least the smallest tree the shape allows: 12 concepts);
 * the tree's shape, the core share and the tour do not scale.
 */
export function structureTargets(pages: number, lectures: number): StructureTargets {
  const s = courseScale(pages, lectures);
  return {
    threads: [3, 6],
    strandsPerThread: [2, 5],
    conceptsPerStrand: [2, 7],
    concepts: scaled([55, 85], s, 12),
    coreShare: 0.25,
    links: scaled([10, 30], s, 1),
    contrasts: scaled([6, 12], s, 1),
    contrastMembers: [2, 6],
    tour: [8, 14],
  };
}

/** How many formulas to expect on the sheet (lecnote-formulas.md: roughly 40–70 for 12 lectures), scaled like the map. Guidance for the draft, not a check. */
export function formulaTargets(pages: number, lectures: number): { formulas: Range } {
  return { formulas: scaled([40, 70], courseScale(pages, lectures), 1) };
}

/** How a count outside its range is reported: an error in a new map, a warning in an update. */
export const countRule = (mode: CheckMode): Severity => (mode === "full" ? "error" : "warning");

/** The checkers' limits, for files made by hand (REFERENCE's): gist ≤ 90, en gist ≤ 180, quotes up to 14 words. */
export const HAND_MADE: Limits = { appMade: false, gist: 90, enGist: 180, quoteWords: [1, 14], targets: structureTargets(REFERENCE.pages, REFERENCE.lectures) };

/** The limits for a file the app makes for a course of these pages and lectures (D8, D9; quotes of 2–12 words). */
export function appLimits(pages: number, lectures: number): Limits {
  return { appMade: true, gist: 60, enGist: 140, quoteWords: [2, 12], targets: structureTargets(pages, lectures) };
}
