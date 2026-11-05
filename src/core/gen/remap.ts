// Keeping ids and pages when a map is made again (in-app generation, design §4.6, D12). 重新生成 is
// anchored: a concept that is still there keeps its old id, because the formula sheet and the
// student's own marks point at it, and a new concept never takes an id an old one had. A re-uploaded
// deck moves the refs into it to the pages their quotes are on now. Code only: what it cannot place
// is handed back, for a repair call or the user.

import type { Formula, FormulaSheet } from "../formulas";
import { sameDeck, STRUCTURE_SCHEMA, type CourseStructure, type PageRef, type StructureLecture, type StructureNode } from "../structure";
import { findQuote, quoteOnPage, squash } from "./squash";

/** How a pair of concepts was matched: the same term, the same title, the id the new map kept, or the same home page. */
export type MatchRule = "term" | "title" | "id" | "home";

export interface IdMatch {
  /** One-to-one, in the new map's order: an old concept, the new map's concept it is, and why. */
  matched: { old: string; new: string; by: MatchRule }[];
  /** New concepts that are no old one (the new map's ids). */
  added: string[];
  /** Old concepts that are no new one. */
  removed: string[];
  /** The new map's ids to change (`renameIds`): a matched concept takes its old id; another node whose id an old concept had, or a matched one now takes, gets a suffix. */
  rename: Map<string, string>;
  /** Old concept id → its id in the renamed map (its own, as it is kept): what `relinkFormulas` follows. Removed concepts are not in it. */
  ids: Map<string, string>;
}

/** Names this alike or more count as the same concept under a kept id or on a shared home page (character-pair overlap). */
export const MIN_SIMILARITY = 0.5;

const concepts = (tree: CourseStructure) => tree.nodes.filter((n) => n.kind === "concept");
const homeOf = (n: StructureNode) => n.refs.find((r) => r.role === "home") ?? null;
const homeKey = (n: StructureNode) => {
  const h = homeOf(n);
  return h ? `${h.lecture}:${h.page}` : "";
};

function groupBy<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    if (k) out.set(k, [...(out.get(k) ?? []), x]);
  }
  return out;
}

/** Overlap of two names' character pairs after squashing (Dice): 1 for the same name, 0 for nothing in common. */
export function similarity(a: string, b: string): number {
  const x = [...squash(a)];
  const y = [...squash(b)];
  if (!x.length || !y.length) return 0;
  if (x.join("") === y.join("")) return 1;
  const pairs = (cs: string[]) => (cs.length < 2 ? cs : cs.slice(1).map((c, i) => cs[i] + c));
  const [px, py] = [pairs(x), pairs(y)];
  const pool = new Map<string, number>();
  for (const p of py) pool.set(p, (pool.get(p) ?? 0) + 1);
  let common = 0;
  for (const p of px) {
    const left = pool.get(p) ?? 0;
    if (left) {
      common++;
      pool.set(p, left - 1);
    }
  }
  return (2 * common) / (px.length + py.length);
}

const alike = (a: StructureNode, b: StructureNode) => Math.max(similarity(a.term, b.term), similarity(a.title, b.title));

/** `id`, or `id-2`, `id-3` …: the first that is not taken. */
export function uniqueId(id: string, taken: ReadonlySet<string>): string {
  if (!taken.has(id)) return id;
  let i = 2;
  while (taken.has(`${id}-${i}`)) i++;
  return `${id}-${i}`;
}

/**
 * Matches a regenerated map's concepts to the old map's, one to one, in rounds over what is still
 * unmatched: the same squashed term held by one concept on each side, then the same title; then an
 * id the new map kept, when the names are still alike; then the same home page — on a page that is
 * home to one concept in each map, whatever their names (a rename), and on a page shared by several,
 * only alike names, the most alike first, so a page home to three concepts still matches one to one.
 * The rest count as added or removed: a pair matched wrongly would carry the formulas and the
 * student's marks to another concept. Ids are never made from a term. Threads and strands are not
 * matched: their ids are the variant's labels.
 */
export function matchIds(oldTree: CourseStructure, newTree: CourseStructure): IdMatch {
  const olds = concepts(oldTree);
  const news = concepts(newTree);
  const freeOld = new Set(olds.map((n) => n.id));
  const freeNew = new Set(news.map((n) => n.id));
  const pairs: { old: StructureNode; new: StructureNode; by: MatchRule }[] = [];
  const pair = (o: StructureNode, n: StructureNode, by: MatchRule) => {
    pairs.push({ old: o, new: n, by });
    freeOld.delete(o.id);
    freeNew.delete(n.id);
  };
  const unmatched = () => [olds.filter((n) => freeOld.has(n.id)), news.filter((n) => freeNew.has(n.id))] as const;

  for (const [by, key] of [
    ["term", (n: StructureNode) => squash(n.term)],
    ["title", (n: StructureNode) => squash(n.title)],
  ] as const) {
    const [os, ns] = unmatched();
    const newByKey = groupBy(ns, key);
    for (const [k, same] of groupBy(os, key)) {
      const there = newByKey.get(k) ?? [];
      if (same.length === 1 && there.length === 1) pair(same[0], there[0], by);
    }
  }

  const oldById = new Map(olds.map((n) => [n.id, n]));
  for (const n of news) {
    const o = oldById.get(n.id);
    if (o && freeOld.has(o.id) && freeNew.has(n.id) && alike(o, n) >= MIN_SIMILARITY) pair(o, n, "id");
  }

  const [oldHomes, newHomes] = [groupBy(olds, homeKey), groupBy(news, homeKey)];
  const [os, ns] = unmatched();
  const newByHome = groupBy(ns, homeKey);
  for (const [page, here] of groupBy(os, homeKey)) {
    const there = newByHome.get(page) ?? [];
    const alone = oldHomes.get(page)!.length === 1 && newHomes.get(page)?.length === 1;
    const scored = here.flatMap((o, i) => there.map((n, j) => ({ o, n, s: alike(o, n), i, j }))).sort((a, b) => b.s - a.s || a.i - b.i || a.j - b.j);
    for (const { o, n, s } of scored) if ((alone || s >= MIN_SIMILARITY) && freeOld.has(o.id) && freeNew.has(n.id)) pair(o, n, "home");
  }

  // Matched concepts take their old ids; any other node gives way to an old concept's id.
  const order = new Map(newTree.nodes.map((n, i) => [n.id, i]));
  pairs.sort((a, b) => order.get(a.new.id)! - order.get(b.new.id)!);
  const rename = new Map<string, string>();
  const keptOld = new Map(pairs.map((p) => [p.new.id, p.old.id]));
  const blocked = new Set(olds.map((n) => n.id));
  const taken = new Set([...newTree.nodes.map((n) => n.id), ...blocked]);
  for (const n of newTree.nodes) {
    const to = keptOld.get(n.id) ?? (blocked.has(n.id) ? uniqueId(n.id, taken) : n.id);
    taken.add(to);
    if (to !== n.id) rename.set(n.id, to);
  }
  return {
    matched: pairs.map((p) => ({ old: p.old.id, new: p.new.id, by: p.by })),
    added: news.filter((n) => freeNew.has(n.id)).map((n) => n.id),
    removed: olds.filter((n) => freeOld.has(n.id)).map((n) => n.id),
    rename,
    ids: new Map(pairs.map((p) => [p.old.id, p.old.id])),
  };
}

/** The map with ids changed (`IdMatch.rename`) wherever one is used: nodes, parents, links, contrasts, tour steps. */
export function renameIds(tree: CourseStructure, rename: ReadonlyMap<string, string>): CourseStructure {
  const to = (id: string) => rename.get(id) ?? id;
  return {
    ...tree,
    nodes: tree.nodes.map((n) => ({ ...n, id: to(n.id), parent: n.parent === null ? null : to(n.parent) })),
    links: tree.links.map((l) => ({ ...l, from: to(l.from), to: to(l.to) })),
    contrasts: tree.contrasts.map((c) => ({ ...c, nodes: c.nodes.map(to) })),
    tour: tree.tour.map((s) => ({ ...s, node: s.node === null ? null : to(s.node) })),
  };
}

/**
 * The sheet following the map's ids (D12): each formula's concept through `ids` (old id → id in the
 * new map). Formulas whose concept is not in `ids` — gone from the map — are taken out and listed.
 */
export function relinkFormulas(sheet: FormulaSheet, ids: ReadonlyMap<string, string>): { sheet: FormulaSheet; orphans: Formula[] } {
  const formulas: Formula[] = [];
  const orphans: Formula[] = [];
  for (const f of sheet.formulas) {
    const concept = ids.get(f.concept);
    if (concept) formulas.push({ ...f, concept });
    else orphans.push(f);
  }
  return { sheet: { ...sheet, formulas }, orphans };
}

/**
 * Old page → new page for the pages of a re-uploaded deck that survived unchanged: the same squashed
 * text, held by one page on each side. Pages without text, or whose text repeats, are left out.
 */
export function pageMap(oldTexts: readonly string[], newTexts: readonly string[]): Map<number, number> {
  const pagesOf = (texts: readonly string[]) => groupBy(texts.map((t, i) => ({ key: squash(t), page: i + 1 })), (p) => p.key);
  const after = pagesOf(newTexts);
  const out = new Map<number, number>();
  for (const [key, before] of pagesOf(oldTexts)) {
    const now = after.get(key) ?? [];
    if (before.length === 1 && now.length === 1) out.set(before[0].page, now[0].page);
  }
  return out;
}

/** A deck uploaded again under the same lecture number: its pages' text (`texts[i]` is page i + 1) and `pageMap` from the old deck. */
export interface Reupload {
  lecture: number;
  texts: readonly string[];
  pages: ReadonlyMap<number, number>;
}

/**
 * Refs into a re-uploaded deck, moved to where they are now: a ref on a page that survived goes with
 * it; otherwise to the one page that holds its quote. A ref with several such pages, none, or only an
 * image-checked quote on a page that changed, is `unplaced` (and left out of `refs`) for a repair call.
 * Refs into other lectures pass unchanged.
 */
export function remapRefs(refs: readonly PageRef[], deck: Reupload): { refs: PageRef[]; unplaced: PageRef[] } {
  const out: PageRef[] = [];
  const unplaced: PageRef[] = [];
  for (const r of refs) {
    if (r.lecture !== deck.lecture) {
      out.push(r);
      continue;
    }
    const same = deck.pages.get(r.page);
    if (same && (r.checked === "image" || quoteOnPage(deck.texts[same - 1] ?? "", r.quote))) {
      out.push({ ...r, page: same });
      continue;
    }
    const hits = r.checked === "image" ? [] : findQuote(deck.texts, r.quote);
    if (hits.length === 1) out.push({ ...r, page: hits[0] });
    else unplaced.push(r);
  }
  return { refs: out, unplaced };
}

/**
 * An adopted map or sheet after a deck was uploaded again (design §4.6, the update's `remap` stage):
 * `remapRefs` on every list of refs — nodes, links, formulas — so a ref into the deck moves to where
 * its quote is now. A ref it cannot place leaves the file, under the `where` it had, for the repair
 * call: a node or formula is cited anew with addRef, which an update allows on what it keeps (ops.ts)
 * — a concept whose home went has none until then, and dropUnverifiable reports it if none comes —
 * while a link keeps its other refs, or goes with none left.
 */
export function remapDoc<D extends CourseStructure | FormulaSheet>(doc: D, deck: Reupload): { doc: D; changes: string[]; unplaced: { where: string; ref: PageRef }[] } {
  const out = JSON.parse(JSON.stringify(doc)) as D;
  const holders: { where: string; holder: { refs: PageRef[] } }[] =
    out.schema === STRUCTURE_SCHEMA
      ? [...(out as CourseStructure).nodes.map((n) => ({ where: `node ${n.id}`, holder: n })), ...(out as CourseStructure).links.map((l) => ({ where: `link ${l.from}→${l.to}`, holder: l }))]
      : (out as FormulaSheet).formulas.map((f) => ({ where: `formula ${f.id}`, holder: f }));
  const changes: string[] = [];
  const unplaced: { where: string; ref: PageRef }[] = [];
  for (const { where, holder } of holders) {
    const kept: PageRef[] = [];
    for (const r of holder.refs) {
      const { refs: [now], unplaced: [lost] } = remapRefs([r], deck);
      if (lost) {
        unplaced.push({ where, ref: lost });
        changes.push(`${where}: L${r.lecture} p${r.page} ${r.role} (${JSON.stringify(r.quote)}) is not in the new deck; left for the repair`);
        continue;
      }
      if (now.page !== r.page) changes.push(`${where}: L${r.lecture} p${r.page} → p${now.page}`);
      kept.push(now);
    }
    holder.refs = kept;
  }
  return { doc: out, changes, unplaced };
}

/** What an update folds in (design §4.6), lecture by lecture: the course's decks against those its map cites. */
export interface LectureChanges {
  /** Numbers the map does not cite: new lectures. */
  added: number[];
  /** Numbers the map cites whose deck is now another one (sameDeck says no): re-uploaded, its refs to be moved (remapDoc). */
  reuploaded: number[];
  /** Numbers the map cites whose deck is the same (or a copy of it). */
  kept: number[];
}

/** The course's lectures (`decks`, as the inventory pins them) against the map's `lectures`: new, re-uploaded, kept. */
export function lectureChanges(cited: readonly Pick<StructureLecture, "no" | "sha256" | "file" | "pages">[], decks: readonly Pick<StructureLecture, "no" | "sha256" | "file" | "pages">[]): LectureChanges {
  const byNo = new Map(cited.map((l) => [l.no, l]));
  const out: LectureChanges = { added: [], reuploaded: [], kept: [] };
  for (const d of [...decks].sort((a, b) => a.no - b.no)) {
    const was = byNo.get(d.no);
    if (!was) out.added.push(d.no);
    else if (sameDeck(was, d)) out.kept.push(d.no);
    else out.reuploaded.push(d.no);
  }
  return out;
}
