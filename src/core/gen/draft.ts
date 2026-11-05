// The draft steps' answers as files (in-app generation, M2b and F2 → M3 and F3): the strict schemas
// write "" for none and carry no file header, so code turns a map draft into lecnote-structure/1 —
// null for a thread's parent and a whole-map tour step, `coreWhy` kept beside a node while the map
// is made (ops.ts `GenNode`) — and the drafts of the lecture ranges into one lecnote-formulas/1
// sheet, or, in an update, into the adopted sheet. `lectures` is left as it was (empty for a new
// file): autofix's fillLectures sets it from what the refs cite.

import { FORMULAS_SCHEMA, type Formula, type FormulaSheet } from "../formulas";
import { STRUCTURE_SCHEMA, type CourseStructure, type PageRef } from "../structure";
import type { GenNode } from "./ops";
import { uniqueId } from "./remap";
import type { DraftAnswer, FormulaDraftAnswer } from "./schemas";
import { squash } from "./squash";

/** What a generated file says about itself. */
export interface GenMeta {
  course: string;
  /** ISO date. */
  createdAt: string;
  /** The model that wrote it. */
  model: string;
}

const refs = (rs: readonly PageRef[]): PageRef[] => rs.map(({ lecture, page, role, quote }) => ({ lecture, page, role, quote }));

/** A draft as a map (variant `id`, its prose in Chinese), without English: M7 writes it. */
export function draftToStructure(draft: DraftAnswer, meta: GenMeta & { id: string }): CourseStructure {
  const nodes: GenNode[] = draft.nodes.map((n) => ({
    id: n.id,
    parent: n.parent || null,
    kind: n.kind,
    title: n.title,
    term: n.term,
    question: n.question,
    gist: n.gist,
    core: n.core,
    origin: n.origin,
    refs: refs(n.refs),
    ...(n.coreWhy.kind === "none" ? {} : { coreWhy: { kind: n.coreWhy.kind, ref: { ...n.coreWhy.ref } } }),
  }));
  return {
    schema: STRUCTURE_SCHEMA,
    id: meta.id,
    course: meta.course,
    label: draft.label,
    lang: "zh",
    createdAt: meta.createdAt,
    generator: { by: "ai", model: meta.model },
    lectures: [],
    summary: draft.summary,
    tour: draft.tour.map((s) => ({ node: s.node || null, title: s.title, text: s.text })),
    nodes,
    links: draft.links.map((l) => ({ ...l, refs: refs(l.refs) })),
    contrasts: draft.contrasts.map((c) => ({ ...c, nodes: [...c.nodes] })),
  };
}

/**
 * The drafts of the lecture ranges as one sheet, in their order: a formula the same as an earlier
 * one (its concept and squashed LaTeX) is dropped, an id taken already gets a suffix, and each is
 * said in `changes`. `basis` is what the sheet was made for (the exam's form, the note, the map's id).
 * `base`: an update's adopted sheet (design §4.6: the new lectures' formulas, deduplicated against
 * it), whose formulas come first and stay as they are — their ids frozen (context.ts `frozenFrom`).
 */
export function sheetFromDrafts(drafts: readonly FormulaDraftAnswer[], meta: GenMeta & { basis: FormulaSheet["basis"] }, base?: FormulaSheet): { sheet: FormulaSheet; changes: string[] } {
  const key = (f: { concept: string; tex: string }) => `${f.concept}\u0001${squash(f.tex)}`;
  const formulas: Formula[] = base ? JSON.parse(JSON.stringify(base.formulas)) : [];
  const changes: string[] = [];
  const same = new Map(formulas.map((f) => [key(f), f.id]));
  const taken = new Set(formulas.map((f) => f.id));
  for (const f of drafts.flatMap((d) => d.formulas)) {
    const first = same.get(key(f));
    if (first !== undefined) {
      changes.push(`formula ${f.id}: dropped, the same as ${first}`);
      continue;
    }
    const id = uniqueId(f.id, taken);
    if (id !== f.id) changes.push(`formula ${f.id}: renamed ${id}, its id was taken`);
    taken.add(id);
    same.set(key(f), id);
    formulas.push({ id, concept: f.concept, name: f.name, tex: f.tex, note: f.note, trap: f.trap, refs: refs(f.refs), en: { ...f.en } });
  }
  const lectures = base ? JSON.parse(JSON.stringify(base.lectures)) : [];
  return { sheet: { schema: FORMULAS_SCHEMA, course: meta.course, createdAt: meta.createdAt, generator: { by: "ai", model: meta.model }, basis: { ...meta.basis }, lectures, formulas }, changes };
}
