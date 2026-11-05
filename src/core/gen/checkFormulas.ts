// Checks a formula sheet (lecnote-formulas/1) against the course's slides and its map, in code
// (in-app generation). A port of docs/formats/check_formulas.py, the reference: every problem it
// reports is reported here under the same `where`, with a stable code. The English is checked
// apart (checkEnglish.ts). Works on the parsed JSON as it came, so a malformed sheet is reported,
// never thrown on.

import { FORMULAS_SCHEMA } from "../formulas";
import { isRecord } from "../structure";
import { checkLectures, checkRef, heldBy, heldIssue, issue, objects, py, refHolder, type CheckContext, type Deck, type Issue } from "./checkStructure";
import { TEXT } from "./limits";
import { cpLength } from "./squash";

export interface FormulaContext extends CheckContext {
  /** The map's concept ids: a formula's `concept` must be one of them. */
  concepts: readonly string[];
  /** An update: the adopted sheet's formulas, kept as they are; the refs they had (`heldRefs`) are checked with `frozenLimits`. */
  frozenFormulas?: readonly string[];
}

const TOP = ["schema", "course", "createdAt", "generator", "basis", "lectures", "formulas"];
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const F = TEXT.formula;

/** A formula's `where`, as check_formulas.py names it: by its id, or by its place when it has none. */
export const formulaWhere = (f: Record<string, unknown>, i: number) => `formula ${py(Object.hasOwn(f, "id") ? f.id : `#${i}`)}`;

/** Checks a parsed formula sheet: everything check_formulas.py checks but the English. Every issue is an error, but a held ref's that an op cannot mend (`heldIssue`). */
export function validateFormulas(sheet: unknown, ctx: FormulaContext): Issue[] {
  if (!isRecord(sheet)) return [issue("top", "bad-schema", `not a ${FORMULAS_SCHEMA} object`)];
  const out: Issue[] = [];
  const err = (where: string, code: string, message: string) => out.push(issue(where, code, message));

  for (const key of TOP) if (!Object.hasOwn(sheet, key)) err("top", "missing-field", `missing ${key}`);
  if (sheet.schema !== FORMULAS_SCHEMA) err("top", "bad-schema", `schema must be ${FORMULAS_SCHEMA}`);
  const basis = isRecord(sheet.basis) ? sheet.basis : {};
  if (typeof basis.exam !== "string" || typeof basis.note !== "string") err("top", "basis", "basis needs exam and note");
  const decks = new Map<unknown, Deck>(ctx.decks.map((d) => [d.no, d]));
  out.push(...checkLectures(sheet.lectures, decks));
  const cited = new Set(objects(sheet, "lectures", "lecture", out).map(([l]) => l.no ?? null));
  const concepts = new Set<unknown>(ctx.concepts);
  const frozen = new Set<unknown>(ctx.frozenFormulas ?? []);
  const isHeld = heldBy(ctx);

  const ids = new Set<unknown>();
  let last: readonly [number, number] = [0, 0];
  for (const [f, i] of objects(sheet, "formulas", "formula", out)) {
    const w = formulaWhere(f, i);
    const id = Object.hasOwn(f, "id") ? f.id : `#${i}`;
    if (typeof id !== "string" || !ID.test(id)) err(w, "bad-id", "the id must be kebab-case");
    if (ids.has(id ?? null)) err(w, "duplicate-id", "duplicate id");
    ids.add(id ?? null);
    if (!concepts.has(f.concept)) err(w, "unknown-concept", `concept ${JSON.stringify(f.concept ?? null)} is not a concept of the map`);
    if (typeof f.tex !== "string" || !f.tex.trim()) err(w, "tex-missing", "needs tex");
    else {
      const error = ctx.katex?.(f.tex, true) ?? null;
      if (error !== null) err(w, "katex", `KaTeX cannot render it: ${error.split("\n")[0]}`);
    }
    for (const [key, limit] of [["name", F.name], ["note", F.note], ["trap", F.trap]] as const) {
      const v = f[key];
      if (typeof v !== "string" || (key !== "trap" && !v)) err(w, "missing-field", `${key} missing`);
      else if (cpLength(v) > limit) err(w, `${key}-length`, `the ${key} is longer than ${limit} characters`);
    }

    // Refs: the home first, a few `also`, each quote on its page; the sheet in the order of its home pages.
    const refs = Array.isArray(f.refs) ? f.refs : [];
    const home = refs[0];
    if (!isRecord(home) || home.role !== "home") err(w, "home-first", "the first ref must be the home ref");
    if (refs.filter((r) => isRecord(r) && r.role === "also").length > F.alsoRefs) err(w, "also-count", `more than ${F.alsoRefs} also refs`);
    refs.forEach((r, j) => {
      const held = isHeld(refHolder("formula", id), frozen.has(id), r);
      const found = checkRef(`${w} ref ${j}`, r, ["home", "also"], cited, decks, { limits: (held && ctx.frozenLimits) || ctx.limits, lang: ctx.lang });
      out.push(...(held ? found.map(heldIssue) : found));
    });
    if (isRecord(home) && Number.isInteger(home.lecture) && Number.isInteger(home.page)) {
      const here = [home.lecture as number, home.page as number] as const;
      const before = here[0] < last[0] || (here[0] === last[0] && here[1] < last[1]);
      if (before) err(w, "order", `out of order: its home L${here[0]} p${here[1]} comes before L${last[0]} p${last[1]}`);
      else last = here;
    }
  }
  return out;
}
