// Mechanical repairs of a generated map or formula sheet (in-app generation, the `autoFix` of M3
// and F3): what code can put right without asking the model again — a quote cited on the wrong
// page or read on the page's image, refs and formulas out of order, the `lectures` list — and, as
// the last resort after repair rounds, dropping what still cannot be verified. Each works on a
// copy of the parsed JSON and returns it with what it changed, in words, for the run's report.

import { isRecord } from "../structure";
import { CORE_EVIDENCE, checkRef, coreEvidence, heldBy, heldRef, linkHolder, py, refHolder, tourStep, truthy, type Deck, type StructureContext } from "./checkStructure";
import { formulaWhere } from "./checkFormulas";
import { findQuote, quoteOnPage } from "./squash";

export interface Fixed<T> {
  doc: T;
  changes: string[];
}

type Obj = Record<string, unknown>;
const records = (v: unknown): [Obj, number][] => (Array.isArray(v) ? v.flatMap((x, i): [Obj, number][] => (isRecord(x) ? [[x, i]] : [])) : []);
const copy = <T>(doc: T): T => JSON.parse(JSON.stringify(doc)) as T;
const pageName = (r: Obj) => `L${py(r.lecture)} p${py(r.page)}`;
const isHome = (r: unknown) => isRecord(r) && r.role === "home";
/** A `coreWhy` that names evidence (not kind "none", whose ref is the 0, 0, "" placeholder). */
const isEvidence = (why: unknown): why is Obj => isRecord(why) && (CORE_EVIDENCE as readonly unknown[]).includes(why.kind);

/** Every list of page refs in a map (nodes, links) or a sheet (formulas), with its owner, what that is, its `where` and its name as `heldRef` keys it. */
function refLists(doc: Obj): { where: string; kind: "node" | "link" | "formula"; holder: string; owner: Obj & { refs: unknown[] } }[] {
  const owners = [
    ...records(doc.nodes).map(([n]) => ({ where: `node ${py(n.id)}`, kind: "node" as const, holder: refHolder("node", n.id), owner: n })),
    ...records(doc.links).map(([l, i]) => ({ where: `link ${i} (${py(l.from)}→${py(l.to)})`, kind: "link" as const, holder: linkHolder(l.from, l.to), owner: l })),
    ...records(doc.formulas).map(([f, i]) => ({ where: formulaWhere(f, i), kind: "formula" as const, holder: refHolder("formula", f.id), owner: f })),
  ];
  return owners.filter((x): x is (typeof owners)[number] & { owner: { refs: unknown[] } } => Array.isArray(x.owner.refs));
}

/**
 * Moves each ref whose quote is not on its page to the page that has it: the one other page of
 * the same deck, else the one page of another deck. A quote the page reader saw on the page's
 * image (`Deck.seen`) stays on its page, marked `checked: "image"` for the verify stage (design
 * §4.5). A quote on no page, or on several, is left as it is for the repair call; dropUnverifiable
 * drops what still does not check after the repair rounds. Refs checked on the image are left alone,
 * and so are an update's `held` refs (`heldRef` keys): what the adopted file had stays where it was,
 * and validation reports what does not check on it.
 */
export function fixRefs<T>(doc: T, decks: readonly Deck[], held: readonly string[] = []): Fixed<T> {
  if (!isRecord(doc)) return { doc, changes: [] };
  const out = copy(doc) as Obj;
  const changes: string[] = [];
  const keep = new Set(held);
  for (const { where, holder, owner } of refLists(out)) {
    owner.refs = owner.refs.map((r, i) => {
      if (!isRecord(r) || typeof r.quote !== "string" || r.checked === "image" || keep.has(heldRef(holder, r))) return r;
      const quote = r.quote;
      const deck = decks.find((d) => d.no === r.lecture);
      const own = typeof r.page === "number" ? r.page : 0;
      if (deck && quoteOnPage(deck.texts[own - 1] ?? "", quote)) return r;
      if (deck && quoteOnPage(deck.seen?.[own - 1] ?? "", quote)) {
        changes.push(`${where} ref ${i}: on the image of ${pageName(r)}, not in its text: marked checked "image", for the verify stage`);
        return { ...r, checked: "image" };
      }
      const inDeck = deck ? findQuote(deck.texts, quote).map((page) => ({ deck, page })) : [];
      const hits = inDeck.length ? inDeck : decks.filter((d) => d !== deck).flatMap((d) => findQuote(d.texts, quote).map((page) => ({ deck: d, page })));
      if (hits.length !== 1) return r;
      const [{ deck: to, page }] = hits;
      changes.push(`${where} ref ${i}: ${pageName(r)} → L${to.no} p${page}, where its quote is`);
      return { ...r, lecture: to.no, page };
    });
  }
  return { doc: out as T, changes };
}

/**
 * Puts each ref list in order — the home ref first, then the rest by lecture and page — and
 * cites each page once: a later ref to a page already cited goes (a home ref never does).
 */
export function sortRefs<T>(doc: T): Fixed<T> {
  if (!isRecord(doc)) return { doc, changes: [] };
  const out = copy(doc) as Obj;
  const changes: string[] = [];
  const at = (r: unknown): [number, number] => (isRecord(r) && typeof r.lecture === "number" && typeof r.page === "number" ? [r.lecture, r.page] : [Infinity, Infinity]);
  for (const { where, owner } of refLists(out)) {
    const rest = owner.refs.filter((r) => !isHome(r)).sort((a, b) => at(a)[0] - at(b)[0] || at(a)[1] - at(b)[1]);
    const sorted = [...owner.refs.filter(isHome), ...rest];
    const cited = new Set<string>();
    const kept = sorted.filter((r) => {
      if (!isRecord(r)) return true;
      const page = pageName(r);
      if (cited.has(page) && !isHome(r)) {
        changes.push(`${where}: dropped a second ref to ${page}`);
        return false;
      }
      cited.add(page);
      return true;
    });
    if (sorted.some((r, i) => r !== owner.refs[i])) changes.push(`${where}: refs put in order`);
    owner.refs = kept;
  }
  return { doc: out as T, changes };
}

/**
 * Puts a sheet's formulas in the order of their home pages, as check_formulas.py wants the sheet
 * (a moved home ref, or drafts merged from several ranges, leave it out of order): a stable sort,
 * so formulas homed on one page keep their order; one without a home ref goes last.
 */
export function sortFormulas<T>(sheet: T): Fixed<T> {
  if (!isRecord(sheet) || !Array.isArray(sheet.formulas)) return { doc: sheet, changes: [] };
  const out = copy(sheet) as Obj & { formulas: unknown[] };
  const home = (f: unknown): [number, number] => {
    const h = isRecord(f) && Array.isArray(f.refs) ? f.refs.find(isHome) : undefined;
    return isRecord(h) && Number.isInteger(h.lecture) && Number.isInteger(h.page) ? [h.lecture as number, h.page as number] : [Infinity, Infinity];
  };
  const sorted = [...out.formulas].sort((a, b) => home(a)[0] - home(b)[0] || home(a)[1] - home(b)[1]);
  const changes = sorted.some((f, i) => f !== out.formulas[i]) ? ["formulas put in home-page order"] : [];
  out.formulas = sorted;
  return { doc: out as T, changes };
}

/** Sets `lectures` to the decks the file cites (its refs and core evidence), in lecture order, as the decks pin them. */
export function fillLectures<T>(doc: T, decks: readonly Deck[]): Fixed<T> {
  if (!isRecord(doc)) return { doc, changes: [] };
  const out = copy(doc) as Obj;
  const cited = new Set<unknown>();
  for (const { owner } of refLists(out)) for (const r of owner.refs) if (isRecord(r)) cited.add(r.lecture);
  for (const [n] of records(out.nodes)) if (isEvidence(n.coreWhy) && isRecord(n.coreWhy.ref)) cited.add(n.coreWhy.ref.lecture);
  const lectures = decks
    .filter((d) => cited.has(d.no))
    .sort((a, b) => a.no - b.no)
    .map(({ no, file, sha256, pages, title }) => ({ no, file, sha256, pages, title }));
  const before = new Map(records(out.lectures).map(([l]) => [l.no, l]));
  const changes = [
    ...lectures.flatMap((l) => {
      const old = before.get(l.no);
      if (!old) return [`lectures: added L${l.no}`];
      return old.file !== l.file || old.sha256 !== l.sha256 || old.pages !== l.pages || old.title !== l.title ? [`lectures: L${l.no} set from its deck`] : [];
    }),
    ...[...before.keys()].filter((no) => !lectures.some((l) => l.no === no)).map((no) => `lectures: removed L${py(no)}, which nothing cites`),
  ];
  if (!changes.length && [...before.keys()].join() !== lectures.map((l) => l.no).join()) changes.push("lectures: put in lecture order");
  out.lectures = lectures;
  return { doc: out as T, changes };
}

/**
 * The mechanical step M3 and F3 take before each check (design §4.3, §4.4): refs moved to their
 * quotes' pages (an update's `held` refs left where they are), then put in order, a sheet's formulas
 * in page order, the `lectures` list filled.
 */
export function autoFix<T>(doc: T, decks: readonly Deck[], held: readonly string[] = []): Fixed<T> {
  const steps: ((d: T) => Fixed<T>)[] = [(d) => fixRefs(d, decks, held), sortRefs, sortFormulas, (d) => fillLectures(d, decks)];
  const changes: string[] = [];
  for (const step of steps) {
    const fixed = step(doc);
    doc = fixed.doc;
    changes.push(...fixed.changes);
  }
  return { doc, changes };
}

/**
 * The last resort, after the repair rounds: drops every ref that does not check (checkStructure's
 * `checkRef`, any role), then what lost its footing — concepts and formulas without a home ref,
 * links without refs or ends; contrasts and tour steps lose the nodes that went. In an app-made
 * map, a core flag whose evidence does not stand is cleared, by validateStructure's own rule
 * (`coreEvidence`). An update's frozen nodes (`ctx.frozen`) are kept as the map had them, as ops.ts
 * keeps them — never dropped, nor the refs the map had (`ctx.heldRefs`), core flags (checked when the
 * map was made) or the links between two of them — and what does not check on them is reported for
 * the student instead; but a ref to a page or deck the course no longer has goes, as no map had it
 * so. A ref the update gave them is checked like any other, and goes when it does not check. A
 * sheet's frozen formulas (`frozenFormulas`) are kept the same way. What an update keeps is checked
 * with its own limits (`ctx.frozenLimits`), as validateStructure checks it. `ctx` is the one the
 * file is validated with (a sheet's FormulaContext will do).
 */
export function dropUnverifiable<T>(doc: T, ctx: StructureContext & { frozenFormulas?: readonly string[] }): Fixed<T> {
  if (!isRecord(doc)) return { doc, changes: [] };
  const out = copy(doc) as Obj;
  const changes: string[] = [];
  const byNo = new Map<unknown, Deck>(ctx.decks.map((d) => [d.no, d]));
  const all = new Set<unknown>(byNo.keys());
  const frozen = new Set<unknown>((ctx.frozen ?? []).map((f) => f.id));
  const frozenFormulas = new Set<unknown>(ctx.frozenFormulas ?? []);
  const kept = "kept, as an update keeps what the map had, though";
  const isHeld = heldBy(ctx);

  for (const { where, kind, holder, owner } of refLists(out)) {
    const frozenHolder = kind === "node" ? frozen.has(owner.id) : kind === "link" ? frozen.has(owner.from) && frozen.has(owner.to) : frozenFormulas.has(owner.id);
    owner.refs = owner.refs.filter((r, i) => {
      const keep = isHeld(holder, frozenHolder, r);
      const [p] = checkRef(`${where} ref ${i}`, r, null, all, byNo, { limits: (keep && ctx.frozenLimits) || ctx.limits, lang: ctx.lang });
      // A deck uploaded again with fewer pages, or taken out of the course: the page itself is gone.
      const held = keep && !!p && p.code !== "ref-page" && p.code !== "ref-lecture";
      if (p) changes.push(held ? `${p.where}: ${kept} it does not check (${p.message})` : `${p.where}: dropped (${p.message})`);
      return !p || held;
    });
  }

  const gone = new Set<unknown>();
  if (Array.isArray(out.nodes)) {
    out.nodes = out.nodes.filter((n: unknown) => {
      if (!isRecord(n) || n.kind !== "concept" || (Array.isArray(n.refs) && n.refs.some(isHome))) return true;
      if (frozen.has(n.id)) {
        changes.push(`node ${py(n.id)}: kept without a home page, as an update keeps every id`);
        return true;
      }
      gone.add(n.id);
      changes.push(`node ${py(n.id)}: dropped, no home page left`);
      return false;
    });
    for (const [n] of records(out.nodes)) {
      if (!ctx.limits.appMade || !truthy(n.core) || frozen.has(n.id)) continue;
      const [p] = coreEvidence(`node ${py(n.id)}`, n.coreWhy, all, byNo, ctx);
      if (!p) continue;
      n.core = false;
      changes.push(`node ${py(n.id)}: core cleared; ${p.message}`);
    }
  }
  if (Array.isArray(out.links)) {
    out.links = out.links.filter((l: unknown, i) => {
      if (!isRecord(l) || (!gone.has(l.from) && !gone.has(l.to) && (!Array.isArray(l.refs) || l.refs.length))) return true;
      changes.push(`link ${i} (${py(l.from)}→${py(l.to)}): dropped, ${gone.has(l.from) || gone.has(l.to) ? "an end went" : "no page left"}`);
      return false;
    });
  }
  if (Array.isArray(out.contrasts) && gone.size) {
    out.contrasts = out.contrasts.flatMap((c: unknown) => {
      if (!isRecord(c) || !Array.isArray(c.nodes) || !c.nodes.some((m) => gone.has(m))) return [c];
      const nodes = c.nodes.filter((m) => !gone.has(m));
      changes.push(`contrast ${py(c.id)}: ${nodes.length < 2 ? "dropped" : "lost members"}, its nodes went`);
      return nodes.length < 2 ? [] : [{ ...c, nodes }];
    });
  }
  if (Array.isArray(out.tour) && gone.size) {
    out.tour = out.tour.filter((s: unknown, i) => {
      if (!isRecord(s) || !gone.has(s.node)) return true;
      changes.push(`${tourStep(i)}: dropped, its node went`);
      return false;
    });
  }
  if (Array.isArray(out.formulas)) {
    out.formulas = out.formulas.filter((f: unknown, i) => {
      if (!isRecord(f) || (Array.isArray(f.refs) && f.refs.some(isHome))) return true;
      if (frozenFormulas.has(f.id)) {
        changes.push(`${formulaWhere(f, i)}: kept without a home page, as an update keeps every formula`);
        return true;
      }
      changes.push(`${formulaWhere(f, i)}: dropped, no home page left`);
      return false;
    });
  }
  return { doc: out as T, changes };
}
