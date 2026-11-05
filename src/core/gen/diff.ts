// What changed between two versions of a map or a sheet (in-app generation, design §3.4, §4.6): the
// change summary on a candidate, the 「本次变化」 reading after 采用, and what the English pass of
// an update must write. Nodes, contrasts and formulas are compared by id, links by their two ends.
// The tour has a fingerprint: a student who read one version need not read it again unless it changed.
// And what the diff check (M6, F5) reads: the edits of each group of ops, field by field, old and new.

import type { Formula, FormulaSheet } from "../formulas";
import { STRUCTURE_SCHEMA, type CourseStructure, type PageRef, type StructureContrast, type StructureLink, type StructureNode } from "../structure";
import { tourStep } from "./checkStructure";
import { applyOps, type ApplyOptions, type Op } from "./ops";
import { squash } from "./squash";

export interface StructureDiff {
  /** Nodes only in the new map, in its order. */
  added: StructureNode[];
  /** Nodes only in the old map, in its order. */
  removed: StructureNode[];
  /** Nodes in both whose title changed. */
  renamed: { id: string; from: string; to: string }[];
  /** Nodes in both under another parent. */
  moved: { id: string; from: string | null; to: string | null }[];
  /** Concepts in both whose home page changed. */
  rehomed: { id: string; from: PageRef | null; to: PageRef | null }[];
  /** Nodes in both whose term, question, gist, core flag, origin or English changed. */
  edited: string[];
  /** Nodes in both whose refs changed in any way (pages, roles, quotes, order). */
  refs: string[];
  /** Links by their ends; `changed`: the new version of a link whose type, note, origin, refs or English changed. */
  links: { added: StructureLink[]; removed: StructureLink[]; changed: StructureLink[] };
  contrasts: { added: StructureContrast[]; removed: StructureContrast[]; changed: StructureContrast[] };
  /** The tour reads differently (`tourFingerprint`). */
  tour: boolean;
  /** The summary or its English changed. */
  summary: boolean;
}

export type FormulaChange = "concept" | "name" | "tex" | "note" | "trap" | "refs" | "en";

export interface SheetDiff {
  added: Formula[];
  removed: Formula[];
  /** Formulas in both, with the fields that changed. */
  changed: { id: string; fields: FormulaChange[] }[];
}

const refKey = (r: PageRef) => [r.lecture, r.page, r.role, r.quote, r.checked ?? ""].join("\u0001");
const refsKey = (refs: readonly PageRef[]) => refs.map(refKey).join("\u0002");
const enKey = (en: Readonly<Record<string, string>> | undefined, keys: readonly string[]) => (en ? keys.map((k) => en[k] ?? "").join("\u0001") : "");
const homeOf = (n: StructureNode) => n.refs.find((r) => r.role === "home") ?? null;
const linkKey = (l: StructureLink) => `${l.from}→${l.to}`;

/** What is only in `after`, only in `before`, and in both but different (`same` decides), by `key`. */
function compare<T>(before: readonly T[], after: readonly T[], key: (x: T) => string, same: (a: T, b: T) => boolean): { added: T[]; removed: T[]; changed: T[] } {
  const old = new Map(before.map((x) => [key(x), x]));
  const now = new Set(after.map(key));
  return {
    added: after.filter((x) => !old.has(key(x))),
    removed: before.filter((x) => !now.has(key(x))),
    changed: after.filter((x) => old.has(key(x)) && !same(old.get(key(x))!, x)),
  };
}

/** Compares two versions of a map (or two variants: A and T share their concepts). */
export function diffStructures(before: CourseStructure, after: CourseStructure): StructureDiff {
  const old = new Map(before.nodes.map((n) => [n.id, n]));
  const both = after.nodes.flatMap((n) => (old.has(n.id) ? [[old.get(n.id)!, n] as const] : []));
  const textKey = (n: StructureNode) => [n.term, n.question, n.gist, n.core, n.origin, enKey(n.en, ["title", "question", "gist"])].join("\u0001");
  const homeKey = (n: StructureNode) => {
    const h = homeOf(n);
    return h ? `${h.lecture}:${h.page}` : "";
  };
  const links = compare(before.links, after.links, linkKey, (a, b) => a.type === b.type && a.note === b.note && a.origin === b.origin && refsKey(a.refs) === refsKey(b.refs) && enKey(a.en, ["note"]) === enKey(b.en, ["note"]));
  const contrasts = compare(before.contrasts, after.contrasts, (c) => c.id, (a, b) => a.title === b.title && a.note === b.note && a.nodes.join("\u0001") === b.nodes.join("\u0001") && enKey(a.en, ["title", "note"]) === enKey(b.en, ["title", "note"]));
  const now = new Set(after.nodes.map((n) => n.id));
  return {
    added: after.nodes.filter((n) => !old.has(n.id)),
    removed: before.nodes.filter((n) => !now.has(n.id)),
    renamed: both.filter(([a, b]) => a.title !== b.title).map(([a, b]) => ({ id: b.id, from: a.title, to: b.title })),
    moved: both.filter(([a, b]) => a.parent !== b.parent).map(([a, b]) => ({ id: b.id, from: a.parent, to: b.parent })),
    rehomed: both.filter(([a, b]) => b.kind === "concept" && homeKey(a) !== homeKey(b)).map(([a, b]) => ({ id: b.id, from: homeOf(a), to: homeOf(b) })),
    edited: both.filter(([a, b]) => textKey(a) !== textKey(b)).map(([, b]) => b.id),
    refs: both.filter(([a, b]) => refsKey(a.refs) !== refsKey(b.refs)).map(([, b]) => b.id),
    links,
    contrasts,
    tour: changeTour(before, after).reread,
    summary: before.summary !== after.summary || (before.en?.summary ?? "") !== (after.en?.summary ?? ""),
  };
}

/** Compares two versions of a formula sheet by formula id. */
export function diffSheets(before: FormulaSheet, after: FormulaSheet): SheetDiff {
  const old = new Map(before.formulas.map((f) => [f.id, f]));
  const now = new Set(after.formulas.map((f) => f.id));
  const changed: SheetDiff["changed"] = [];
  for (const f of after.formulas) {
    const o = old.get(f.id);
    if (!o) continue;
    const fields = (["concept", "name", "tex", "note", "trap"] as const).filter((k) => o[k] !== f[k]) as FormulaChange[];
    if (refsKey(o.refs) !== refsKey(f.refs)) fields.push("refs");
    if (enKey(o.en, ["name", "note", "trap"]) !== enKey(f.en, ["name", "note", "trap"])) fields.push("en");
    if (fields.length) changed.push({ id: f.id, fields });
  }
  return { added: after.formulas.filter((f) => !old.has(f.id)), removed: before.formulas.filter((f) => !now.has(f.id)), changed };
}

/** FNV-1a, 32 bits, as 8 hex digits: enough to tell one version of a text from another. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * A fingerprint of what the guided reading says: each step's node and its squashed texts, Chinese
 * and English. Spacing and the kind of quotes or dashes do not change it; any other edit does.
 */
export function tourFingerprint(tree: Pick<CourseStructure, "tour">): string {
  return fnv1a(tree.tour.map((s) => [s.node ?? "", ...[s.title, s.text, s.en?.title ?? "", s.en?.text ?? ""].map(squash)].join("\u0001")).join("\u0002"));
}

/** Whether a student who read the old map's tour should read the new one, and the new one's fingerprint to remember. */
export function changeTour(before: Pick<CourseStructure, "tour">, after: Pick<CourseStructure, "tour">): { reread: boolean; fingerprint: string } {
  const fingerprint = tourFingerprint(after);
  return { reread: fingerprint !== tourFingerprint(before), fingerprint };
}

/** One field of one item that an edit changed: `field` "" for the whole item, added (`before` null) or removed (`after` null). */
export interface FieldChange {
  /** `map` (label, summary), `node <id>`, `link <from>→<to>`, `contrast <id>`, `tour step <n>`, `formula <id>`. */
  item: string;
  field: string;
  before: unknown;
  after: unknown;
}

type Item = Readonly<Record<string, unknown>>;
const NODE_KEYS = ["parent", "kind", "title", "term", "question", "gist", "core", "coreWhy", "origin", "refs", "en"];
const FORMULA_KEYS = ["concept", "name", "tex", "note", "trap", "refs", "en"];

/** The items of two lists, matched by `key` (`name` makes the item's label): each added, removed or changed field. */
function itemChanges(before: readonly Item[], after: readonly Item[], key: (x: Item, i: number) => string, name: (k: string) => string, fields: readonly string[]): FieldChange[] {
  const old = new Map(before.map((x, i) => [key(x, i), x]));
  const now = new Map(after.map((x, i) => [key(x, i), x]));
  const out: FieldChange[] = [];
  for (const [k, x] of now) {
    const o = old.get(k);
    if (!o) out.push({ item: name(k), field: "", before: null, after: x });
    else for (const f of fields) if (JSON.stringify(o[f] ?? null) !== JSON.stringify(x[f] ?? null)) out.push({ item: name(k), field: f, before: o[f] ?? null, after: x[f] ?? null });
  }
  for (const [k, o] of old) if (!now.has(k)) out.push({ item: name(k), field: "", before: o, after: null });
  return out;
}

/** Every field an edit changed between two versions of a map or a sheet, with its old and new value. */
export function fieldChanges<D extends CourseStructure | FormulaSheet>(before: D, after: D): FieldChange[] {
  if (before.schema !== STRUCTURE_SCHEMA || after.schema !== STRUCTURE_SCHEMA) {
    const [b, a] = [before as FormulaSheet, after as FormulaSheet];
    return itemChanges(b.formulas as unknown as Item[], a.formulas as unknown as Item[], (f) => String(f.id), (k) => `formula ${k}`, FORMULA_KEYS);
  }
  const [b, a] = [before as CourseStructure, after as CourseStructure];
  return [
    ...itemChanges([b as unknown as Item], [a as unknown as Item], () => "map", (k) => k, ["label", "summary", "en"]),
    ...itemChanges(b.nodes as unknown as Item[], a.nodes as unknown as Item[], (n) => String(n.id), (k) => `node ${k}`, NODE_KEYS),
    ...itemChanges(b.links as unknown as Item[], a.links as unknown as Item[], (l) => `${l.from}→${l.to}`, (k) => `link ${k}`, ["type", "note", "origin", "refs", "en"]),
    ...itemChanges(b.contrasts as unknown as Item[], a.contrasts as unknown as Item[], (c) => String(c.id), (k) => `contrast ${k}`, ["title", "nodes", "note", "en"]),
    ...itemChanges(b.tour as unknown as Item[], a.tour as unknown as Item[], (_, i) => String(i), (k) => tourStep(Number(k)), ["node", "title", "text", "en"]),
  ];
}

/**
 * The diff check's changes material (M6, F5): for each group of `applied` (`applyOps`' result, in
 * its order), the fields its ops changed, old and new — each group replayed on the document as the
 * groups before it left it, the way applyOps applied them. `opts` as applyOps had them.
 */
export function groupChanges<D extends CourseStructure | FormulaSheet>(before: D, applied: readonly Op[], opts: ApplyOptions = {}): { group: string; changes: FieldChange[] }[] {
  const groups = new Map<string, Op[]>();
  for (const op of applied) groups.set(op.group, [...(groups.get(op.group) ?? []), op]);
  let doc = before;
  return [...groups].map(([group, ops]) => {
    const next = applyOps(doc, ops, opts).doc;
    const changes = fieldChanges(doc, next);
    doc = next;
    return { group, changes };
  });
}
