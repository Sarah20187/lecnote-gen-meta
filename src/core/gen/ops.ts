// Patch operations on a generated map or formula sheet (in-app generation, design §4.3 M3/M6, §4.6).
// The model never rewrites a file: it returns ops (schemas.ts `opsSchema`, one flat record each),
// every op carrying the finding it implements as its `group`. A group applies whole or not at all,
// so a fix is never half made, and a group the diff check turns down is reverted by applying the
// other groups again to the original. Ops are model output: one that is malformed, points at what
// is not (or no longer) there, or changes what an update keeps (`frozenIds`) is rejected with a reason;
// so is a new strand or thread in an update, which only a regeneration may add (design §4.6).
// An op never leaves what no later op could mend on a frozen item: a second home, a ref of a role
// its holder does not take, one also ref or contrast member too many, a sheet out of page order.

import type { Formula, FormulaSheet } from "../formulas";
import { isRecord, STRUCTURE_SCHEMA, type CourseStructure, type PageRef, type StructureKind, type StructureLinkType, type StructureNode, type StructureOrigin, type TourStep } from "../structure";
import { CORE_EVIDENCE, heldRef, refHolder, type CoreEvidence } from "./checkStructure";
import { TEXT } from "./limits";

/**
 * One edit, as `opsSchema`'s flat record carries it, "" standing for none (a thread's `parent`, a
 * tour step over the whole map). `id` names a node or contrast of a map, a formula of a sheet, or
 * for `setField` with "" the map itself (label, summary). setField `core` takes "true" or "false",
 * `coreWhy` the evidence kind with its page as the first of `refs`. Ref ops name refs by lecture and
 * page; moveRef moves `id`'s refs at `refs`' pages to `to` (which may be `id`), taking `refs`' roles.
 * A link's texts are set by its two ends, a tour step's by its 1-based `step`.
 */
export type Op = { group: string } & (
  | { op: "addNode"; id: string; parent: string; kind: StructureKind; title: string; term: string; question: string; gist: string; origin: StructureOrigin }
  | { op: "setField"; id: string; field: string; value: string; refs?: PageRef[] }
  | { op: "moveNode"; id: string; parent: string }
  | { op: "removeNode"; id: string }
  | { op: "addRef"; id: string; refs: PageRef[] }
  | { op: "removeRef"; id: string; refs: PageRef[] }
  | { op: "moveRef"; id: string; to: string; refs: PageRef[] }
  | { op: "addLink"; from: string; to: string; type: StructureLinkType; note: string; origin: StructureOrigin; refs: PageRef[] }
  | { op: "removeLink"; from: string; to: string }
  | { op: "setLinkField"; from: string; to: string; field: string; value: string }
  | { op: "addContrast"; id: string; title: string; nodes: string[]; note: string }
  | { op: "addToContrast"; id: string; nodes: string[] }
  | { op: "setContrastField"; id: string; field: string; value: string }
  | { op: "removeContrast"; id: string }
  | { op: "setTour"; steps: { node: string; title: string; text: string }[] }
  | { op: "setTourField"; step: number; field: string; value: string }
  | { op: "addFormula"; id: string; concept: string; name: string; tex: string; note: string; trap: string; refs: PageRef[] }
  | { op: "setFormulaField"; id: string; field: string; value: string }
  | { op: "removeFormula"; id: string }
);

/** Why a concept is 重点 (D8): the teacher's question or recap page it rests on; kind "none" and page 0 when it is not. */
export interface CoreWhy {
  kind: "none" | CoreEvidence;
  ref: { lecture: number; page: number; quote: string };
}
/** A map node as generation writes it: a file's node plus, while the map is made, why it is core. */
export type GenNode = StructureNode & { coreWhy?: CoreWhy };

export interface ApplyOptions {
  /**
   * Ids an update keeps (patch mode): a frozen node, contrast or formula may gain refs (never a
   * second home), children, links, contrasts and contrast members, but is never removed, moved or
   * edited, and a link between two frozen nodes stays as it is. With any, the ops are an update's,
   * and a node they add is a concept: a new strand or thread is a proposal (`opsSchema`).
   */
  frozenIds?: Iterable<string>;
  /**
   * The refs the adopted file had (`heldRef` keys, context.ts `frozenFrom`): of a frozen node or
   * formula only these stay whatever happens — a ref an update gave it may be removed or moved, as
   * a repair must when it does not check. Absent: every ref of a frozen holder stays.
   */
  heldRefs?: Iterable<string>;
  /** The map's concept ids, which a sheet's formulas must name (unchecked when absent). */
  concepts?: Iterable<string>;
}

export interface Rejection {
  op: Op;
  reason: string;
}

export interface ApplyResult<D> {
  doc: D;
  /** In the order they were applied: group by group, in the order each group first appears. */
  applied: Op[];
  rejected: Rejection[];
}

interface Ctx {
  frozen: ReadonlySet<string>;
  /** null: every ref of a frozen holder is held. */
  held: ReadonlySet<string> | null;
  concepts: ReadonlySet<string> | null;
}

const KINDS = ["thread", "strand", "concept"] as const;
const ORIGINS = ["teacher", "canvas", "ai"] as const;
const ROLES = ["home", "also", "roadmap"] as const;
const LINK_TYPES = ["same-form", "builds-on", "contrast", "applies", "continues"] as const;
const PARENT_KIND: Record<StructureKind, StructureKind | null> = { thread: null, strand: "thread", concept: "strand" };
const NODE_FIELDS = ["title", "term", "question", "gist", "core", "coreWhy", "origin", "en.title", "en.question", "en.gist"] as const;
const MAP_FIELDS = ["label", "summary", "en.label", "en.summary"] as const;
const FORMULA_FIELDS = ["concept", "name", "tex", "note", "trap", "en.name", "en.note", "en.trap"] as const;
const LINK_FIELDS = ["note", "en.note"] as const;
const CONTRAST_FIELDS = ["title", "note", "en.title", "en.note"] as const;
const TOUR_FIELDS = ["title", "text", "en.title", "en.text"] as const;
/** Members of a contrast, as check_structure.py counts them. */
const CONTRAST_SIZE = [2, 6] as const;

/** What a holder of refs takes: the roles it cites (one home at most), and at most how many also refs. */
interface RefRules {
  roles: readonly PageRef["role"][];
  also: number;
}
const CONCEPT_REFS: RefRules = { roles: ["home", "also"], also: TEXT.alsoRefs };
const BRANCH_REFS: RefRules = { roles: ["roadmap"], also: 0 };
const FORMULA_REFS: RefRules = { roles: ["home", "also"], also: TEXT.formula.alsoRefs };

const isText = (v: unknown): v is string => typeof v === "string";
const isId = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isOneOf = <T extends string>(v: unknown, values: readonly T[]): v is T => values.includes(v as T);
const isLecture = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isPage = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1;
const at = (r: { lecture: number; page: number }) => `L${r.lecture} p${r.page}`;
const samePage = (a: PageRef, b: PageRef) => a.lecture === b.lecture && a.page === b.page;
const homeOf = (refs: readonly PageRef[]) => refs.find((r) => r.role === "home");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** An op's refs, or what is wrong with them. */
function readRefs(v: unknown): PageRef[] | string {
  if (!Array.isArray(v)) return "malformed: refs is not a list";
  const out: PageRef[] = [];
  for (const r of v) {
    if (!isRecord(r) || !isLecture(r.lecture) || !isPage(r.page) || !isOneOf(r.role, ROLES) || !isText(r.quote)) return "malformed: a ref needs a lecture, a page, a role and a quote";
    out.push({ lecture: r.lecture, page: r.page, role: r.role, quote: r.quote, ...(r.checked === "text" || r.checked === "image" ? { checked: r.checked } : {}) });
  }
  return out;
}

/** The home ref first, the others in lecture and page order (a list out of order keeps its order). */
function insertRef(refs: readonly PageRef[], ref: PageRef): PageRef[] {
  if (ref.role === "home") return [ref, ...refs];
  const i = refs.findIndex((r) => r.role !== "home" && (r.lecture > ref.lecture || (r.lecture === ref.lecture && r.page > ref.page)));
  return i < 0 ? [...refs, ref] : [...refs.slice(0, i), ref, ...refs.slice(i)];
}

/** Sets a text field, or `en.<key>` of the English block, which is made with "" for its other keys. */
function setText(o: object, field: string, value: string, enKeys: readonly string[]): void {
  const rec = o as Record<string, unknown>;
  if (!field.startsWith("en.")) {
    rec[field] = value;
    return;
  }
  const en = isRecord(rec.en) ? rec.en : {};
  rec.en = { ...Object.fromEntries(enKeys.map((k) => [k, ""])), ...en, [field.slice(3)]: value };
}

/** Gives `holder` (named `id`) the refs one by one, or says why it cannot take one: a role it does not cite, a page it cites, a second home, one also ref too many. */
function addRefs(id: string, holder: { refs: PageRef[] }, refs: readonly PageRef[], rules: RefRules): string | null {
  for (const r of refs) {
    if (!rules.roles.includes(r.role)) return `${id} takes no ${r.role} ref`;
    if (holder.refs.some((x) => samePage(x, r))) return `${id} already cites ${at(r)}`;
    const home = r.role === "home" ? homeOf(holder.refs) : undefined;
    if (home) return `${id} already has a home (${at(home)})`;
    if (r.role === "also" && holder.refs.filter((x) => x.role === "also").length >= rules.also) return `${id} already has ${rules.also} also refs`;
    holder.refs = insertRef(holder.refs, r);
  }
  return null;
}

/**
 * addRef, removeRef and moveRef on what holds refs: a node of a map, a formula of a sheet. A home
 * moves only to what has none: re-homing takes the old home away first (moveRef `id`→`id` as also).
 * A frozen holder gains refs, and loses only those an update gave it: the adopted file's stay.
 */
function refStep<H extends { refs: PageRef[] }>(op: Op & { op: "addRef" | "removeRef" | "moveRef" }, kind: "node" | "formula", find: (id: unknown) => H | undefined, rules: (h: H) => RefRules, c: Ctx): string | null {
  const holder = find(op.id);
  if (!holder) return `${String(op.id)} is not there`;
  const refs = readRefs(op.refs);
  if (typeof refs === "string") return refs;
  if (!refs.length) return "malformed: no refs";
  if (op.op === "addRef") return addRefs(op.id, holder, refs, rules(holder));
  // A frozen holder keeps the refs the adopted file had (all of them, when they are not given).
  const heldAt = (r: PageRef) => holder.refs.some((x) => samePage(x, r) && c.held!.has(heldRef(refHolder(kind, op.id), x)));
  if (c.frozen.has(op.id) && (!c.held || refs.some(heldAt))) return `${op.id} is frozen`;
  const to = op.op === "moveRef" ? op.to : op.id;
  const target = find(to);
  if (!target) return `${String(to)} is not there`;
  for (const r of refs) {
    const old = holder.refs.find((x) => samePage(x, r));
    if (!old) return `${op.id} has no ref to ${at(r)}`;
    holder.refs = holder.refs.filter((x) => x !== old);
    if (op.op === "removeRef") continue;
    const why = addRefs(to, target, [{ ...old, role: r.role }], rules(target));
    if (why) return why;
  }
  return null;
}

/** Applies one op to a map in place, or says why it cannot. */
function mapStep(t: CourseStructure, op: Op, c: Ctx): string | null {
  const nodes = t.nodes as GenNode[];
  const node = (id: unknown) => nodes.find((n) => n.id === id);
  const missing = (id: unknown) => `${String(id)} is not in the map`;
  const frozen = (id: string) => `${id} is frozen`;
  const contrast = (id: unknown) => t.contrasts.find((k) => k.id === id);
  const link = (from: unknown, to: unknown) => t.links.find((l) => l.from === from && l.to === to);
  /** Why `id` cannot be a contrast's member: a contrast compares concepts. */
  const notMember = (id: unknown): string | null => {
    const n = node(id);
    return !n ? missing(id) : n.kind === "concept" ? null : `${n.id} is a ${n.kind}; a contrast compares concepts`;
  };
  const placeUnder = (kind: StructureKind, parent: string | null): string | null => {
    const want = PARENT_KIND[kind];
    if (want === null) return parent === null ? null : "a thread has no parent";
    const p = parent === null ? undefined : node(parent);
    if (!p) return parent === null ? `a ${kind} needs a parent` : missing(parent);
    return p.kind === want ? null : `a ${kind} goes under a ${want}, not a ${p.kind}`;
  };

  switch (op.op) {
    case "addNode": {
      if (!isId(op.id) || !isOneOf(op.kind, KINDS) || !isOneOf(op.origin, ORIGINS) || !isId(op.title) || ![op.term, op.question, op.gist].every(isText)) return "malformed: a node needs an id, a kind, an origin and a title";
      if (node(op.id)) return `${op.id} already exists`;
      if (c.frozen.size && op.kind !== "concept") return `an update adds no ${op.kind}: propose it for 重新生成 instead`;
      const parent = isId(op.parent) ? op.parent : null;
      const why = placeUnder(op.kind, parent);
      if (why) return why;
      nodes.push({ id: op.id, parent, kind: op.kind, title: op.title, term: op.term, question: op.question, gist: op.gist, core: false, origin: op.origin, refs: [] });
      return null;
    }
    case "setField": {
      if (!isText(op.value)) return "malformed: no value";
      if (op.id === "") {
        if (!isOneOf(op.field, MAP_FIELDS)) return `the map has no field ${String(op.field)}`;
        setText(t, op.field, op.value, ["label", "summary"]);
        return null;
      }
      const n = node(op.id);
      if (!n) return contrast(op.id) ? `${op.id} is a contrast: setContrastField sets its texts` : missing(op.id);
      if (!isOneOf(op.field, NODE_FIELDS)) return `a node has no field ${String(op.field)}`;
      if (c.frozen.has(n.id)) return frozen(n.id);
      if (op.field === "core") {
        if (op.value !== "true" && op.value !== "false") return `core is "true" or "false", not ${op.value}`;
        n.core = op.value === "true";
      } else if (op.field === "origin") {
        if (!isOneOf(op.value, ORIGINS)) return `origin ${op.value}`;
        n.origin = op.value;
      } else if (op.field === "coreWhy") {
        const refs = readRefs(op.refs ?? []);
        if (typeof refs === "string") return refs;
        const kind = op.value === "none" || isOneOf(op.value, CORE_EVIDENCE) ? op.value : null;
        if (kind === null) return `coreWhy is none, ${CORE_EVIDENCE.join(" or ")}, not ${op.value}`;
        if (kind !== "none" && !refs.length) return "coreWhy needs the evidence page in refs";
        const r = refs[0];
        n.coreWhy = { kind, ref: kind === "none" || !r ? { lecture: 0, page: 0, quote: "" } : { lecture: r.lecture, page: r.page, quote: r.quote } };
      } else {
        if (op.field === "title" && !isId(op.value)) return "a title cannot be empty";
        setText(n, op.field, op.value, ["title", "question", "gist"]);
      }
      return null;
    }
    case "moveNode": {
      const n = node(op.id);
      if (!n) return missing(op.id);
      if (c.frozen.has(n.id)) return frozen(n.id);
      const parent = isId(op.parent) ? op.parent : null;
      const why = placeUnder(n.kind, parent);
      if (why) return why;
      n.parent = parent;
      return null;
    }
    case "removeNode": {
      const n = node(op.id);
      if (!n) return missing(op.id);
      if (c.frozen.has(n.id)) return frozen(n.id);
      if (nodes.some((x) => x.parent === n.id)) return `${n.id} still has children`;
      // What exists only through the node goes with it: its links, its place in contrasts, its tour steps.
      t.nodes = nodes.filter((x) => x !== n);
      t.links = t.links.filter((l) => l.from !== n.id && l.to !== n.id);
      t.contrasts = t.contrasts.map((k) => ({ ...k, nodes: k.nodes.filter((id) => id !== n.id) })).filter((k) => k.nodes.length >= 2);
      t.tour = t.tour.filter((s) => s.node !== n.id);
      return null;
    }
    case "addRef":
    case "removeRef":
    case "moveRef":
      return refStep(op, "node", node, (n) => (n.kind === "concept" ? CONCEPT_REFS : BRANCH_REFS), c);
    case "addLink": {
      const refs = readRefs(op.refs);
      if (typeof refs === "string") return refs;
      if (!isOneOf(op.type, LINK_TYPES) || !isOneOf(op.origin, ORIGINS) || !isText(op.note)) return "malformed: a link needs a type, an origin and a note";
      for (const end of [op.from, op.to]) if (!node(end)) return missing(end);
      if (op.from === op.to) return "a link needs two different ends";
      if (t.links.some((l) => l.from === op.from && l.to === op.to)) return `${op.from}→${op.to} already exists`;
      t.links.push({ from: op.from, to: op.to, type: op.type, note: op.note, origin: op.origin, refs });
      return null;
    }
    case "removeLink":
    case "setLinkField": {
      const l = link(op.from, op.to);
      if (!l) return `there is no link ${String(op.from)}→${String(op.to)}`;
      if (op.op === "setLinkField" && (!isOneOf(op.field, LINK_FIELDS) || !isText(op.value))) return `a link has no field ${String(op.field)}`;
      if (c.frozen.has(l.from) && c.frozen.has(l.to)) return `${l.from}→${l.to} links two frozen nodes`;
      if (op.op === "setLinkField") setText(l, op.field, op.value, ["note"]);
      else t.links = t.links.filter((x) => x !== l);
      return null;
    }
    case "addContrast": {
      if (!isId(op.id) || !isText(op.title) || !isText(op.note) || !Array.isArray(op.nodes)) return "malformed: a contrast needs an id, a title, a note and nodes";
      if (contrast(op.id)) return `${op.id} already exists`;
      const members = [...new Set(op.nodes)];
      if (members.length < CONTRAST_SIZE[0] || members.length > CONTRAST_SIZE[1]) return `a contrast needs ${CONTRAST_SIZE.join("–")} nodes`;
      for (const id of members) {
        const why = notMember(id);
        if (why) return why;
      }
      t.contrasts.push({ id: op.id, title: op.title, nodes: members, note: op.note });
      return null;
    }
    case "addToContrast": {
      // A gain, so a frozen contrast takes it too.
      const k = contrast(op.id);
      if (!k) return missing(op.id);
      if (!Array.isArray(op.nodes) || !op.nodes.length) return "malformed: no nodes";
      for (const id of op.nodes) {
        const why = notMember(id) ?? (k.nodes.includes(id) ? `${id} is already in ${k.id}` : null);
        if (why) return why;
        if (k.nodes.length >= CONTRAST_SIZE[1]) return `${k.id} already has ${CONTRAST_SIZE[1]} nodes`;
        k.nodes.push(id);
      }
      return null;
    }
    case "setContrastField": {
      const k = contrast(op.id);
      if (!k) return `${String(op.id)} is not a contrast`;
      if (!isOneOf(op.field, CONTRAST_FIELDS) || !isText(op.value)) return `a contrast has no field ${String(op.field)}`;
      if (c.frozen.has(k.id)) return frozen(k.id);
      setText(k, op.field, op.value, ["title", "note"]);
      return null;
    }
    case "removeContrast": {
      if (!contrast(op.id)) return missing(op.id);
      if (c.frozen.has(op.id)) return frozen(op.id);
      t.contrasts = t.contrasts.filter((k) => k.id !== op.id);
      return null;
    }
    case "setTour": {
      if (!Array.isArray(op.steps)) return "malformed: no steps";
      const tour: TourStep[] = [];
      for (const s of op.steps as unknown[]) {
        if (!isRecord(s) || !isText(s.node) || !isText(s.title) || !isId(s.text)) return "malformed: a tour step needs a node, a title and a text";
        const id = s.node || null;
        if (id !== null && !node(id)) return missing(id);
        // A step that did not change keeps its English.
        const same = t.tour.find((x) => x.node === id && x.title === s.title && x.text === s.text);
        tour.push({ node: id, title: s.title, text: s.text, ...(same?.en ? { en: same.en } : {}) });
      }
      t.tour = tour;
      return null;
    }
    case "setTourField": {
      const s = Number.isInteger(op.step) && op.step >= 1 ? t.tour[op.step - 1] : undefined;
      if (!s) return `the tour has no step ${String(op.step)}`;
      if (!isOneOf(op.field, TOUR_FIELDS) || !isText(op.value)) return `a tour step has no field ${String(op.field)}`;
      if (op.field === "text" && !isId(op.value)) return "a tour step's text cannot be empty";
      setText(s, op.field, op.value, ["title", "text"]);
      return null;
    }
    default:
      return `${String(op.op)} is not an op for a map`;
  }
}

/** A formula's home page: its first ref, when that is the home ref; check_formulas.py orders the sheet by it. */
const homeAt = (f: Formula) => (f.refs[0]?.role === "home" ? f.refs[0] : null);
const homeKey = (f: Formula) => {
  const h = homeAt(f);
  return h ? at(h) : "";
};

/** Puts `f` after the last formula homed at or before its home page, so the sheet stays in home-page order; a formula without a home stays where it is. */
function place(s: FormulaSheet, f: Formula): void {
  const home = homeAt(f);
  if (!home) return;
  const rest = s.formulas.filter((x) => x !== f);
  let i = 0;
  rest.forEach((x, j) => {
    const h = homeAt(x);
    if (h && (h.lecture < home.lecture || (h.lecture === home.lecture && h.page <= home.page))) i = j + 1;
  });
  s.formulas = [...rest.slice(0, i), f, ...rest.slice(i)];
}

/** Applies one op to a formula sheet in place, or says why it cannot. */
function sheetStep(s: FormulaSheet, op: Op, c: Ctx): string | null {
  const formula = (id: unknown) => s.formulas.find((f) => f.id === id);
  const missing = (id: unknown) => `${String(id)} is not in the sheet`;
  const unknownConcept = (id: string) => (c.concepts && !c.concepts.has(id) ? `${id} is not a concept of the map` : null);

  switch (op.op) {
    case "addFormula": {
      if (![op.id, op.concept, op.name, op.tex].every(isId) || !isText(op.note) || !isText(op.trap)) return "malformed: a formula needs an id, a concept, a name and LaTeX";
      const refs = readRefs(op.refs);
      if (typeof refs === "string") return refs;
      if (formula(op.id)) return `${op.id} already exists`;
      const f: Formula = { id: op.id, concept: op.concept, name: op.name, tex: op.tex, note: op.note, trap: op.trap, refs: [] };
      const why = unknownConcept(op.concept) ?? addRefs(op.id, f, refs, FORMULA_REFS) ?? (homeAt(f) ? null : "a formula needs its home ref");
      if (why) return why;
      s.formulas.push(f);
      place(s, f);
      return null;
    }
    case "setFormulaField": {
      const f = formula(op.id);
      if (!f) return missing(op.id);
      if (!isOneOf(op.field, FORMULA_FIELDS) || !isText(op.value)) return `a formula has no field ${String(op.field)}`;
      if (c.frozen.has(f.id)) return `${f.id} is frozen`;
      if ((op.field === "concept" || op.field === "name" || op.field === "tex") && !isId(op.value)) return `a formula's ${op.field} cannot be empty`;
      const why = op.field === "concept" ? unknownConcept(op.value) : null;
      if (why) return why;
      setText(f, op.field, op.value, ["name", "note", "trap"]);
      return null;
    }
    case "removeFormula": {
      if (!formula(op.id)) return missing(op.id);
      if (c.frozen.has(op.id)) return `${op.id} is frozen`;
      s.formulas = s.formulas.filter((f) => f.id !== op.id);
      return null;
    }
    case "addRef":
    case "removeRef":
    case "moveRef": {
      // A formula given another home moves to its place in the sheet.
      const homes = new Map(s.formulas.map((f) => [f, homeKey(f)]));
      const why = refStep(op, "formula", formula, () => FORMULA_REFS, c);
      if (why) return why;
      for (const [f, home] of homes) if (homeKey(f) !== home) place(s, f);
      return null;
    }
    default:
      return `${String(op.op)} is not an op for a formula sheet`;
  }
}

/**
 * Applies ops to a map or a sheet, group by group (in the order each group first appears; within a
 * group, in order). A group whose every op applies is kept; otherwise none of it is, and each of its
 * ops is rejected — the failing one with its reason, the others naming it. Never changes `doc`.
 */
export function applyOps<D extends CourseStructure | FormulaSheet>(doc: D, ops: readonly Op[], opts: ApplyOptions = {}): ApplyResult<D> {
  const c: Ctx = { frozen: new Set(opts.frozenIds ?? []), held: opts.heldRefs ? new Set(opts.heldRefs) : null, concepts: opts.concepts ? new Set(opts.concepts) : null };
  const groups = new Map<string, Op[]>();
  for (const op of ops) {
    const key = isRecord(op) && isText(op.group) ? op.group : "";
    groups.set(key, [...(groups.get(key) ?? []), op]);
  }
  let cur = clone(doc);
  const applied: Op[] = [];
  const rejected: Rejection[] = [];
  for (const [group, list] of groups) {
    const next = clone(cur);
    let failed: Rejection | null = null;
    for (const op of list) {
      const reason = !isRecord(op) ? "not an op" : !isId(group) ? "an op needs the finding it implements (group)" : next.schema === STRUCTURE_SCHEMA ? mapStep(next as CourseStructure, op, c) : sheetStep(next as FormulaSheet, op, c);
      if (reason) {
        failed = { op, reason };
        break;
      }
    }
    if (!failed) {
      cur = next;
      applied.push(...list);
      continue;
    }
    const cause = failed;
    rejected.push(...list.map((op) => (op === cause.op ? cause : { op, reason: `its group ${group} was rejected (${String(cause.op.op)}: ${cause.reason})` })));
  }
  return { doc: cur, applied, rejected };
}

/**
 * The document without some groups' effects: the other applied ops applied again, in their order,
 * to `original` — the document `applyOps` started from. A group that needed a reverted one (a link
 * to a node it added) is rejected this time, so nothing is left pointing at what is gone.
 */
export function revertGroups<D extends CourseStructure | FormulaSheet>(original: D, applied: readonly Op[], groups: readonly string[], opts: ApplyOptions = {}): ApplyResult<D> {
  const drop = new Set(groups);
  return applyOps(original, applied.filter((op) => !drop.has(op.group)), opts);
}
