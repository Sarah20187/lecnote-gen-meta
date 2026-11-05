// What the checks of a generated map or sheet are given (in-app generation, design §4.3 M1, §4.5,
// §4.6), made from what Stage I and Stage R left: the decks with their page texts and what the reader
// saw on the pages whose image it read; the pages where the slides state the course's structure and
// those with the teacher's own signal (anchors.ts — never sample questions, D5, D8); the course's
// language; and for an update, what the current map keeps. One context serves validateStructure,
// validateFormulas (with the map's concepts), autofix and dropUnverifiable, so they cannot disagree.

import type { FormulaSheet } from "../formulas";
import { STRUCTURE_SCHEMA, type CourseStructure } from "../structure";
import { buildAnchors } from "./anchors";
import type { Digests, Inventory, PageDigest } from "./bundle";
import { heldRef, linkHolder, refHolder, type CheckContext, type Deck, type StructureContext } from "./checkStructure";
import { HAND_MADE, type CheckMode, type Limits } from "./limits";

/** The words the reader transcribed from a page's image: its title, figure, edges, question, roadmap and terms. */
function seenOn(d: PageDigest): string {
  return [d.title, d.figureText, ...d.edges.flatMap((e) => [e.from, e.to, e.label]), d.teacherQuestion, ...d.roadmapItems, ...d.terms].filter((s) => s.trim()).join("\n");
}

/**
 * The course's decks as the checks read them: each lecture pinned as a map's `lectures` entry, its
 * page texts (`texts[i]` is page i + 1), and `seen` — for a page whose image the reader read, the
 * words it transcribed from it, where a ref marked `checked: "image"` is found; "" elsewhere.
 */
export function decksFrom(inventory: Pick<Inventory, "lectures">, digests: Digests): Deck[] {
  return [...inventory.lectures]
    .sort((a, b) => a.no - b.no)
    .map((l) => {
      const count = Math.max(l.pages.length, ...l.pages.map((p) => p.page));
      const texts = Array.from({ length: count }, () => "");
      const seen = Array.from({ length: count }, () => "");
      const readings = new Map((digests[l.sha256] ?? []).map((d) => [d.page, d]));
      for (const p of l.pages) {
        texts[p.page - 1] = p.text;
        const d = readings.get(p.page);
        if (p.image && d) seen[p.page - 1] = seenOn(d);
      }
      return { no: l.no, file: l.file, sha256: l.sha256, pages: count, title: l.title, texts, seen };
    });
}

/** The course's language for its quotes: the first exam that states one (考试信息.json `language`); "unknown" when none does. */
export function courseLang(exams: Inventory["exams"]): NonNullable<CheckContext["lang"]> {
  return exams.find((e) => e.language !== "unknown")?.language ?? "unknown";
}

/**
 * What an update keeps of the current map or sheet: its nodes with their kind and parent (the
 * checks' `frozen`), the ids ops may not remove, move or edit (`ApplyOptions.frozenIds`): every
 * node and contrast of a map, every formula of a sheet; and the refs it had (`heldRef` keys: the
 * checks' and ops' `heldRefs`), of its nodes and links, or of its formulas — the only refs of what it
 * keeps that stay whatever they check to.
 */
export function frozenFrom(doc: CourseStructure | FormulaSheet): { nodes: NonNullable<StructureContext["frozen"]>; ids: string[]; refs: string[] } {
  if (doc.schema !== STRUCTURE_SCHEMA) return { nodes: [], ids: doc.formulas.map((f) => f.id), refs: doc.formulas.flatMap((f) => f.refs.map((r) => heldRef(refHolder("formula", f.id), r))) };
  return {
    nodes: doc.nodes.map(({ id, kind, parent }) => ({ id, kind, parent })),
    ids: [...doc.nodes.map((n) => n.id), ...doc.contrasts.map((c) => c.id)],
    refs: [...doc.nodes.flatMap((n) => n.refs.map((r) => heldRef(refHolder("node", n.id), r))), ...doc.links.flatMap((l) => l.refs.map((r) => heldRef(linkHolder(l.from, l.to), r)))],
  };
}

export interface ReadingsContextOptions {
  limits: Limits;
  /** Renders LaTeX as the app does (KaTeX, passed in): null when it renders, else the error. */
  katex?: CheckContext["katex"];
  /** An update: the adopted map it folds new lectures into, kept whole (patch mode). Absent: a new map (full mode). */
  update?: CourseStructure;
  /** An update: the adopted sheet, whose formulas' refs it keeps too (`heldRefs`). */
  sheet?: FormulaSheet | null;
}

/**
 * The context the checks of a run take, from its inventory and readings: decks with texts and what
 * was seen on images, the course's language, the roadmap and signal pages from the readings (M1
 * anchors, the sample papers' pages left out), and for an update the current map's nodes, frozen,
 * with counts as warnings — and what it keeps checked with the hand-made limits (HAND_MADE): an
 * update may fold lectures into a map made by hand, whose gists and quotes were never held to the
 * app's (D9), and no op may change them; a map the app made passed its own tighter ones. Only the
 * refs the map and the sheet (`opts.sheet`) had are kept that way (`heldRefs`): one the update adds
 * is checked as the app's.
 */
export function contextFromReadings(inventory: Pick<Inventory, "lectures" | "exams" | "examFiles">, digests: Digests, opts: ReadingsContextOptions): StructureContext {
  const anchors = buildAnchors(inventory.lectures, digests, inventory.examFiles);
  const mode: CheckMode = opts.update ? "patch" : "full";
  const kept = opts.update ? frozenFrom(opts.update) : null;
  return {
    decks: decksFrom(inventory, digests),
    ...(opts.katex ? { katex: opts.katex } : {}),
    mode,
    limits: opts.limits,
    lang: courseLang(inventory.exams),
    roadmapPages: anchors.roadmap.map(({ lecture, page }) => ({ lecture, page })),
    signalPages: anchors.signals.map(({ lecture, page, kind }) => ({ lecture, page, kind })),
    ...(kept ? { frozen: kept.nodes, frozenLimits: HAND_MADE, heldRefs: [...kept.refs, ...(opts.sheet ? frozenFrom(opts.sheet).refs : [])] } : {}),
  };
}
