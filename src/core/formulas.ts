// Course formula sheet (lecnote-formulas/1; the user's decision of 2026-10-27): review material
// kept apart from the knowledge map but sharing its concepts and slide pages. Every formula names
// the map concept it belongs to, so the sheet can follow any map's branches and a formula and its
// concept lead to each other. One file per course, <course>/LecNote/review/formulas.json. What is
// particular to a course comes from its slides, its exam and a short course note (`basis`), not
// from settings. Reading is tolerant, like the map's: what does not fit is dropped and named.

import { conceptsUnder, deckReader, enBlock, indexStructure, isRecord, withEn, type CourseStructure, type PageRef, type StructureLecture, type StructureNode } from "./structure";

export const FORMULAS_SCHEMA = "lecnote-formulas/1";
/** The sheet's file name in <course>/LecNote/review/. */
export const FORMULAS_FILE = "formulas.json";

export interface Formula {
  id: string;
  /** The knowledge-map concept it belongs to (shared by every variant of the map). */
  concept: string;
  /** What the formula is. */
  name: string;
  /** LaTeX for KaTeX, in the slides' notation. */
  tex: string;
  /** Every symbol, and when the formula holds. */
  note: string;
  /** The mistake an exam question would test; "" when there is none. */
  trap: string;
  /** The page that states it first (role `home`), then pages that use it again. */
  refs: PageRef[];
  en?: { name: string; note: string; trap: string };
}

export interface FormulaSheet {
  schema: typeof FORMULAS_SCHEMA;
  course: string;
  createdAt: string;
  generator: { by: string; model?: string; note?: string };
  /** What the sheet was made for: the exam's form and the course note; a generated sheet also names the map it was built on. */
  basis: { exam: string; note: string; structure?: string };
  lectures: StructureLecture[];
  formulas: Formula[];
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Parses a formula sheet. Throws when it is not one (not JSON, another schema); otherwise drops
 * formulas without an id, a concept, a name or LaTeX (and later copies of an id), and refs outside
 * the cited decks, and says what was dropped.
 */
export function parseFormulaSheet(text: string): { sheet: FormulaSheet; dropped: string[] } {
  const v: unknown = JSON.parse(text);
  if (!isRecord(v) || v.schema !== FORMULAS_SCHEMA) throw new Error(`not a ${FORMULAS_SCHEMA} file`);
  const dropped: string[] = [];
  const { lectures, refs } = deckReader(v.lectures, dropped);
  const seen = new Set<string>();
  const formulas: Formula[] = list(v.formulas)
    .filter(isRecord)
    .flatMap((f) => {
      const id = str(f.id);
      if (!id || seen.has(id) || !str(f.concept) || !str(f.name) || !str(f.tex).trim()) {
        dropped.push(`formula ${id || "?"}`);
        return [];
      }
      seen.add(id);
      return [{ id, concept: str(f.concept), name: str(f.name), tex: str(f.tex), note: str(f.note), trap: str(f.trap), refs: refs(f.refs, `formula ${id}`), ...withEn(enBlock(f, ["name", "note", "trap"] as const)) }];
    });
  const basis = isRecord(v.basis) ? { exam: str(v.basis.exam), note: str(v.basis.note), ...(str(v.basis.structure) ? { structure: str(v.basis.structure) } : {}) } : { exam: "", note: "" };
  const generator = isRecord(v.generator) ? { by: str(v.generator.by), model: str(v.generator.model) || undefined, note: str(v.generator.note) || undefined } : { by: "" };
  return { sheet: { schema: FORMULAS_SCHEMA, course: str(v.course), createdAt: str(v.createdAt), generator, basis, lectures, formulas }, dropped };
}

export interface FormulaGroup {
  /** The map branch (`byBranch`) or the lecture number (`byLecture`); null for the rest. */
  key: string | number | null;
  formulas: Formula[];
}

/**
 * The sheet along a map's top branches: a group per thread holding its concepts' formulas in the
 * map's concept order (the sheet's order within a concept); formulas whose concept the map does
 * not have come last, in a group of their own. Threads without formulas are left out.
 */
export function byBranch(sheet: FormulaSheet, tree: CourseStructure): FormulaGroup[] {
  const index = indexStructure(tree);
  const groups: FormulaGroup[] = [];
  const placed = new Set<string>();
  for (const thread of index.children.get(null) ?? []) {
    const order = conceptsUnder(index, thread.id).map((c) => c.id);
    const formulas = order.flatMap((c) => sheet.formulas.filter((f) => f.concept === c && !placed.has(f.id)));
    for (const f of formulas) placed.add(f.id);
    if (formulas.length) groups.push({ key: thread.id, formulas });
  }
  const rest = sheet.formulas.filter((f) => !placed.has(f.id));
  if (rest.length) groups.push({ key: null, formulas: rest });
  return groups;
}

/** The sheet in slide order: a group per lecture of the formula's first page; formulas without pages last. */
export function byLecture(sheet: FormulaSheet): FormulaGroup[] {
  const home = (f: Formula) => f.refs[0] ?? null;
  const sorted = [...sheet.formulas].sort((a, b) => {
    const x = home(a);
    const y = home(b);
    if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1);
    return x.lecture - y.lecture || x.page - y.page;
  });
  const groups: FormulaGroup[] = [];
  for (const f of sorted) {
    const key = home(f)?.lecture ?? null;
    const last = groups.at(-1);
    if (last && last.key === key) last.formulas.push(f);
    else groups.push({ key, formulas: [f] });
  }
  return groups;
}

/** A concept's formulas, in the sheet's order. */
export function formulasOf(sheet: FormulaSheet | null, concept: StructureNode | string): Formula[] {
  const id = typeof concept === "string" ? concept : concept.id;
  return sheet ? sheet.formulas.filter((f) => f.concept === id) : [];
}
