// Checks a knowledge map (lecnote-structure/1) against the course's slides, in code (in-app
// generation). A port of docs/formats/check_structure.py, the reference: every problem it reports
// is reported here under the same `where`, with a stable code (the wording may differ) — but a
// tour step is `tour step <n>`, 1-based, as ops and the English name it (the Python's `tour <i>`
// counts from 0). On top of it, the design's rules: `also` refs in slide order, links across
// branches, contrasts of concepts, teacher threads on roadmap pages, no LaTeX in gists, evidence for
// a core flag in an app-made map (D8) — on what an update adds: a hand-made map has no evidence,
// and an app-made one's was checked when it was made — and ids an update may not drop or move, the
// refs it keeps reported, not repaired (`heldRefs`); and a course in
// Chinese may quote its slides in Chinese (design §4.5), which the format's English quotes rule
// out. Works on the parsed JSON as it came, so a malformed file is reported, never thrown on. The
// English is checked apart (checkEnglish.ts): a draft has none yet.

import type { ExamInfo } from "../course";
import { isRecord, STRUCTURE_SCHEMA, type StructureLecture } from "../structure";
import { countRule, TEXT, type CheckMode, type Limits, type Range, type Severity } from "./limits";
import { cpLength, quoteOnPage, squash, wordCount } from "./squash";

export interface Issue {
  /** What it is about, as check_*.py names it: `top`, `lectures`, `sizes`, `node <id>`, `node <id> ref 2`, `link 3`, `formula <id>`, … */
  where: string;
  /** Stable: what kind of problem, for code to act on. */
  code: string;
  message: string;
  severity: Severity;
}

/** A deck a file may cite, pinned like the file's `lectures` entries, with its page texts: `texts[i]` is page i + 1. */
export interface Deck extends StructureLecture {
  texts: readonly string[];
  /** What the page reader saw on a page's image (its title, a figure's words), for pages whose text layer has none: a ref marked `checked: "image"` is found there. */
  seen?: readonly string[];
}

/** A slide page. */
export interface PageAt {
  lecture: number;
  page: number;
}

export interface CheckContext {
  /** The course's decks: refs and `lectures` entries are checked against them. */
  decks: readonly Deck[];
  /** Renders LaTeX as the app does: null when it renders, else the error. Without it formulas are not rendered. */
  katex?: (tex: string, display: boolean) => string | null;
  mode: CheckMode;
  limits: Limits;
  /**
   * The course's language (考试信息.json `language`; absent: "en"). Quotes are English, as the
   * format has them — no Chinese, counted in words — unless it is "zh": then a Chinese quote passes
   * and each Chinese character counts as a word.
   */
  lang?: ExamInfo["language"];
  /**
   * An update: what it keeps — a map's frozen nodes and the links between two of them, a sheet's
   * frozen formulas — is checked with these instead of `limits` (HAND_MADE, context.ts). A map made
   * by hand never had the app's tighter limits (D9: hand-made files are not re-validated), no op may
   * change what it keeps, and one the app made passed them when it was made.
   */
  frozenLimits?: Limits;
  /**
   * An update: the refs the adopted file had (`heldRef` keys), the only refs of what it keeps that
   * it keeps whatever they check to — checked with `frozenLimits`, what does not check on them a
   * warning for the report (no op may mend them) unless their page or deck is gone, left where they
   * are by autofix, never removed by an op. Any other ref, one an update gives a kept node or formula
   * too, is checked as the app checks its own. Absent: every ref of what an update keeps is held.
   */
  heldRefs?: readonly string[];
}

/**
 * A ref's key among an update's held refs: its holder (`refHolder`, `linkHolder`), its lecture and
 * its quote; not its page, which a re-uploaded deck moves. A map's and a sheet's never collide.
 */
export const heldRef = (holder: string, r: unknown): string => JSON.stringify([holder, isRecord(r) ? (r.lecture ?? null) : null, isRecord(r) ? (r.quote ?? null) : null]);
/** A map's node or a sheet's formula as `heldRef` names it. */
export const refHolder = (kind: "node" | "formula", id: unknown): string => `${kind} ${py(id)}`;
/** A map's link as `heldRef` names it. */
export const linkHolder = (from: unknown, to: unknown): string => `link ${py(from)}→${py(to)}`;

/** Whether a ref of a holder that is (`frozen`) or is not kept by an update is one the adopted file had: `ctx.heldRefs`, or with none every ref of a kept holder. */
export function heldBy(ctx: Pick<CheckContext, "heldRefs">): (holder: string, frozen: boolean, r: unknown) => boolean {
  const held = ctx.heldRefs ? new Set(ctx.heldRefs) : null;
  return (holder, frozen, r) => frozen && (!held || held.has(heldRef(holder, r)));
}

/** A held ref's problem as validation reports it: a page or deck that is gone stays an error (the last resort drops it); the rest a warning, as no op may mend it. */
export const heldIssue = (i: Issue): Issue => (i.code === "ref-page" || i.code === "ref-lecture" ? i : { ...i, severity: "warning" });

export interface StructureContext extends CheckContext {
  /** An update: the current map's nodes, which must stay, with their kind and parent. */
  frozen?: readonly { id: string; kind: string; parent: string | null }[];
  /** Pages where the slides state the course's structure (outlines, recaps): a teacher thread needs a roadmap ref to one. */
  roadmapPages?: readonly PageAt[];
  /**
   * Pages with the teacher's own signal (a question asked in class, a recap; anchors.ts `signals`):
   * a core flag's evidence must be one, of the kind its `coreWhy` names when the page's is given
   * (D8). Needed for an app-made map: without them no core flag stands.
   */
  signalPages?: readonly (PageAt & { kind?: CoreEvidence })[];
}

/** What a core flag may rest on (D8): the teacher's own signals on the slides, never sample questions. The one list: schemas, ops and anchors take it from here. */
export const CORE_EVIDENCE = ["teacherQuestion", "recap"] as const;
export type CoreEvidence = (typeof CORE_EVIDENCE)[number];

/** Chinese and full-width characters, as the checkers define them. */
export const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
/** LaTeX where plain text belongs: a command, $…$, or a braced sub- or superscript. */
export const LATEX = /\\[A-Za-z]+|\$[^$]*\$|[_^]\{/;

const KINDS: unknown[] = ["thread", "strand", "concept"];
const ORIGINS: unknown[] = ["teacher", "canvas", "ai"];
const LINK_TYPES: unknown[] = ["same-form", "builds-on", "contrast", "applies", "continues"];
const TOP = ["schema", "id", "course", "label", "lang", "createdAt", "generator", "lectures", "summary", "tour", "nodes", "links", "contrasts"];
const NODE_FIELDS = ["id", "parent", "kind", "title", "term", "question", "gist", "core", "origin", "refs"];
const LINK_FIELDS = ["from", "to", "type", "note", "origin", "refs"];
const CONTRAST_FIELDS = ["id", "title", "nodes", "note"];
const PARENT_KIND: Record<string, string | null> = { thread: null, strand: "thread", concept: "strand" };

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const within = (n: number, [lo, hi]: Range) => lo <= n && n <= hi;
const span = ([lo, hi]: Range) => `${lo}–${hi}`;
/** A value in a message. */
const show = (v: unknown): string => (v === undefined ? "nothing" : JSON.stringify(v));
/** A value as Python's str() prints it, so that a `where` reads as check_*.py's does (`node None`). */
export const py = (v: unknown): string => (v === null || v === undefined ? "None" : v === true ? "True" : v === false ? "False" : typeof v === "string" ? v : JSON.stringify(v));
/** Python's truthiness: empty strings, lists and objects are false. */
export const truthy = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : isRecord(v) ? Object.keys(v).length > 0 : !!v);
export const issue = (where: string, code: string, message: string, severity: Severity = "error"): Issue => ({ where, code, message, severity });
/** The `where` of the tour step at index `i`: its 1-based position, as ops (`setTourField`) and the English (`englishSchema`) name it. */
export const tourStep = (i: number) => `tour step ${i + 1}`;

/** The objects of a list field, with their index; a field that is not a list, and entries that are not objects, are reported. */
export function objects(doc: Record<string, unknown>, key: string, label: string, out: Issue[]): [Record<string, unknown>, number][] {
  const v = doc[key];
  if (v !== undefined && !Array.isArray(v)) out.push(issue("top", "not-a-list", `${key} must be a list`));
  return list(v).flatMap((x, i): [Record<string, unknown>, number][] => {
    if (isRecord(x)) return [[x, i]];
    out.push(issue(`${label} #${i}`, "bad-entry", `not an object: ${show(x)}`));
    return [];
  });
}

/** The `lectures` entries against the decks: each names a deck by its number, and its file, hash and pages are that deck's. */
export function checkLectures(raw: unknown, decks: ReadonlyMap<unknown, Deck>): Issue[] {
  return list(raw).flatMap((lec) => {
    const no = isRecord(lec) ? lec.no : undefined;
    const d = decks.get(no);
    if (!isRecord(lec) || !d) return [issue("lectures", "unknown-lecture", `L${py(no)} is not one of the course's decks`)];
    if (lec.file !== d.file || lec.sha256 !== d.sha256 || lec.pages !== d.pages) return [issue("lectures", "lecture-mismatch", `L${py(no)}: file, sha256 or pages differ from the deck's`)];
    return [];
  });
}

const HAN = /[\u4e00-\u9fff]/g;
/** A quote's words: Python's `split()` count, each Chinese character a word (as word processors count them). */
const quoteWords = (quote: string) => (quote.match(HAN) ?? []).length + wordCount(quote.replace(HAN, " "));

/**
 * A page ref's problems under `where`: it is an object of an allowed role (`roles` null: any),
 * cites a lecture of the file's `lectures` that has a deck, a page in range, and a quote of at
 * least 4 characters and the limits' words that is on that page — English, unless `rules.lang` is "zh".
 */
export function checkRef(where: string, r: unknown, roles: readonly string[] | null, cited: ReadonlySet<unknown>, decks: ReadonlyMap<unknown, Deck>, rules: Pick<CheckContext, "limits" | "lang">): Issue[] {
  if (!isRecord(r)) return [issue(where, "bad-ref", `the ref is not an object: ${show(r)}`)];
  const { limits } = rules;
  const out: Issue[] = [];
  const lecture = r.lecture ?? null;
  const page = r.page;
  if (roles && !roles.includes(r.role as string)) out.push(issue(where, "bad-role", `role ${show(r.role)} is not allowed here (${roles.join(", ")})`));
  const deck = decks.get(lecture);
  if (!cited.has(lecture) || !deck) return [...out, issue(where, "ref-lecture", `L${py(lecture)} is not in lectures`)];
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > deck.pages) return [...out, issue(where, "ref-page", `L${py(lecture)} p${py(page)} is out of range (1–${deck.pages})`)];
  const quote = str(r.quote);
  const at = `L${py(lecture)} p${page}`;
  const words = quoteWords(quote);
  if (rules.lang !== "zh" && CJK.test(quote)) out.push(issue(where, "quote-cjk", `${at}: the quote is Chinese: ${show(quote)}`));
  else if (cpLength(squash(quote)) < TEXT.quoteChars || words < limits.quoteWords[0] || words > limits.quoteWords[1]) out.push(issue(where, "quote-length", `${at}: the quote is too short or too long (${words} words; ${span(limits.quoteWords)}): ${show(quote)}`));
  else if (!quoteOnPage(pageText(deck, page, r.checked), quote)) out.push(issue(where, "quote-not-on-page", `${at}: the quote is not on that page${r.checked === "image" ? "'s image" : ""}: ${show(quote)}`));
  return out;
}

/** The text a ref's quote is looked for in: the page's text, or what the reader saw on its image for a ref checked on the image. */
export const pageText = (deck: Deck, page: number, checked?: unknown): string => (checked === "image" ? deck.seen : deck.texts)?.[page - 1] ?? "";

const pageName = (r: unknown) => (isRecord(r) ? `L${py(r.lecture)} p${py(r.page)}` : "");
const onPages = (r: unknown, pages: readonly PageAt[]) => pages.some((p) => pageName(p) === pageName(r));

/**
 * Why a core flag of an app-made map does not stand (D8), under `where`; empty when it does: its
 * `coreWhy` names the teacher's own signal by a ref that checks, on one of `ctx.signalPages` — with
 * none given, no flag stands. The signal pages come from the page readings, so on a picture the
 * quote may be what the reader saw there. validateStructure reports these; dropUnverifiable clears such a flag.
 */
export function coreEvidence(where: string, why: unknown, cited: ReadonlySet<unknown>, decks: ReadonlyMap<unknown, Deck>, ctx: StructureContext): Issue[] {
  if (!isRecord(why) || !(CORE_EVIDENCE as readonly unknown[]).includes(why.kind)) {
    return [issue(where, "core-evidence", `a core concept needs coreWhy: a question the teacher asks in class or a recap slide (${CORE_EVIDENCE.join(", ")})`)];
  }
  const problems = checkRef(`${where} coreWhy`, why.ref, null, cited, decks, ctx);
  const seen = problems.length === 1 && problems[0].code === "quote-not-on-page" && isRecord(why.ref) && !checkRef(where, { ...why.ref, checked: "image" }, null, cited, decks, ctx).length;
  if (problems.length && !seen) return problems;
  const signals = (ctx.signalPages ?? []).filter((p) => pageName(p) === pageName(why.ref));
  if (signals.some((p) => !p.kind || p.kind === why.kind)) return [];
  if (signals.length) return [issue(`${where} coreWhy`, "core-evidence", `${pageName(why.ref)} is a ${signals.map((p) => p.kind).join(" and ")} page, not a ${py(why.kind)} one`)];
  return [issue(`${where} coreWhy`, "core-evidence", `${pageName(why.ref)} is not a page where the teacher asks a question or recaps`)];
}

/** Refs in lecture and page order (refs without numbers are not compared). */
function inSlideOrder(refs: readonly unknown[]): boolean {
  const at = refs.flatMap((r) => (isRecord(r) && typeof r.lecture === "number" && typeof r.page === "number" ? [[r.lecture, r.page] as const] : []));
  return at.every((x, i) => i === 0 || at[i - 1][0] < x[0] || (at[i - 1][0] === x[0] && at[i - 1][1] <= x[1]));
}

/**
 * Checks a parsed knowledge map: everything check_structure.py checks but the English, and the
 * design's rules (see the header). Counts follow `countRule(ctx.mode)`; the rest are errors.
 */
export function validateStructure(tree: unknown, ctx: StructureContext): Issue[] {
  const out: Issue[] = [];
  const err = (where: string, code: string, message: string) => out.push(issue(where, code, message));
  const count = (code: string, message: string) => out.push(issue("sizes", code, message, countRule(ctx.mode)));
  if (!isRecord(tree)) return [issue("top", "bad-schema", `not a ${STRUCTURE_SCHEMA} object`)];
  const { limits } = ctx;
  const t = limits.targets;

  for (const key of TOP) if (!Object.hasOwn(tree, key)) err("top", "missing-field", `missing ${key}`);
  if (tree.schema !== STRUCTURE_SCHEMA) err("top", "bad-schema", `schema must be ${STRUCTURE_SCHEMA}`);
  const decks = new Map<unknown, Deck>(ctx.decks.map((d) => [d.no, d]));
  out.push(...checkLectures(tree.lectures, decks));
  const cited = new Set(objects(tree, "lectures", "lecture", out).map(([l]) => l.no ?? null));
  // A ref the adopted map had is held to the hand-made limits, and what does not check on it is reported, not repaired.
  const ref = (where: string, r: unknown, roles: readonly string[] | null, held = false) => {
    const found = checkRef(where, r, roles, cited, decks, rulesOf(held));
    out.push(...(held ? found.map(heldIssue) : found));
  };
  const frozen = new Set((ctx.frozen ?? []).map((f) => f.id));
  const isHeld = heldBy(ctx);
  /** The rules for refs and texts of what an update keeps, else the map's own. */
  const rulesOf = (kept: boolean): Pick<CheckContext, "limits" | "lang"> => ({ limits: (kept && ctx.frozenLimits) || limits, lang: ctx.lang });

  // Nodes, one by one; `byId` keeps the last of a repeated id, as the checker's dict does.
  const nodes = objects(tree, "nodes", "node", out).map(([n]) => n);
  const byId = new Map<unknown, Record<string, unknown>>();
  for (const n of nodes) {
    const w = `node ${py(n.id)}`;
    if (byId.has(n.id ?? null)) err(w, "duplicate-id", "duplicate id");
    byId.set(n.id ?? null, n);
    for (const f of NODE_FIELDS) if (!Object.hasOwn(n, f)) err(w, "missing-field", `missing ${f}`);
    if (!KINDS.includes(n.kind)) err(w, "bad-kind", `kind ${show(n.kind)} is not thread, strand or concept`);
    if (!ORIGINS.includes(n.origin)) err(w, "bad-origin", `origin ${show(n.origin)} is not teacher, canvas or ai`);
    if (cpLength(str(n.title)) > TEXT.title) err(w, "title-length", `the title is longer than ${TEXT.title} characters: ${show(n.title)}`);
    const gist = rulesOf(frozen.has(n.id as string)).limits.gist;
    if (cpLength(str(n.gist)) > gist) err(w, "gist-length", `the gist is longer than ${gist} characters`);
    if (!truthy(n.gist)) err(w, "empty-gist", "empty gist");
    if (LATEX.test(str(n.gist))) err(w, "gist-latex", "the gist has LaTeX; gists are plain text");
  }

  // Each node in the tree, with its refs.
  for (const n of nodes) {
    const w = `node ${py(n.id)}`;
    const kind = n.kind;
    const parent = n.parent ?? null;
    const want = typeof kind === "string" && Object.hasOwn(PARENT_KIND, kind) ? PARENT_KIND[kind] : "?";
    if (want === null) {
      if (parent !== null) err(w, "bad-parent", "a thread's parent must be null");
    } else if (!byId.has(parent)) err(w, "unknown-parent", `parent ${show(parent)} is unknown`);
    else if (byId.get(parent)!.kind !== want) err(w, "bad-parent", `a ${py(kind)}'s parent must be a ${want}, not a ${py(byId.get(parent)!.kind)}`);

    if (n.refs !== undefined && !Array.isArray(n.refs)) err(w, "not-a-list", "refs must be a list");
    const refs = list(n.refs);
    const withRole = (role: string) => refs.filter((r) => isRecord(r) && r.role === role);
    refs.forEach((r, i) => ref(`${w} ref ${i}`, r, kind === "concept" ? ["home", "also"] : ["roadmap"], isHeld(refHolder("node", n.id), frozen.has(n.id as string), r)));
    if (kind === "concept") {
      const homes = withRole("home");
      if (homes.length !== 1) err(w, "home-count", `${homes.length} home refs, need exactly 1`);
      else if (refs[0] !== homes[0]) err(w, "home-first", "the home ref must come first");
      const also = withRole("also");
      if (also.length > TEXT.alsoRefs) err(w, "also-count", `more than ${TEXT.alsoRefs} also refs`);
      if (!inSlideOrder(also)) err(w, "also-order", "the also refs must be in lecture and page order");
      if (truthy(n.question)) err(w, "concept-question", 'a concept has question ""');
      if (limits.appMade && truthy(n.core) && !frozen.has(n.id as string)) out.push(...coreEvidence(w, n.coreWhy, cited, decks, ctx));
    } else {
      if (!str(n.question).endsWith("？")) err(w, "question", `a ${py(kind)} needs a Chinese question ending with ？`);
      if (kind === "thread" && n.origin === "teacher") {
        const roadmap = withRole("roadmap");
        if (!roadmap.length) err(w, "roadmap-missing", "a teacher thread needs a roadmap ref");
        else if (ctx.roadmapPages && !roadmap.some((r) => onPages(r, ctx.roadmapPages!))) err(w, "roadmap-page", "none of its roadmap refs is a page that states the course's structure");
      }
    }
  }

  // Sizes. A thread is any node without a parent, as the checker counts them.
  const kids = new Map<unknown, Record<string, unknown>[]>();
  for (const n of nodes) kids.set(n.parent ?? null, [...(kids.get(n.parent ?? null) ?? []), n]);
  const threads = kids.get(null) ?? [];
  const concepts = nodes.filter((n) => n.kind === "concept");
  if (!within(threads.length, t.threads)) count("count-threads", `${threads.length} threads, need ${span(t.threads)}`);
  for (const n of nodes) {
    const k = kids.get(n.id ?? null)?.length ?? 0;
    if (n.kind === "thread" && !within(k, t.strandsPerThread)) count("count-strands", `thread ${py(n.id)} has ${k} strands, need ${span(t.strandsPerThread)}`);
    if (n.kind === "strand" && !within(k, t.conceptsPerStrand)) count("count-strand-concepts", `strand ${py(n.id)} has ${k} concepts, need ${span(t.conceptsPerStrand)}`);
  }
  if (!within(concepts.length, t.concepts)) count("count-concepts", `${concepts.length} concepts, need ${span(t.concepts)}`);
  const core = concepts.filter((n) => truthy(n.core)).length;
  if (concepts.length && core > t.coreShare * concepts.length) count("count-core", `${core} core concepts > ${t.coreShare * 100}% of ${concepts.length}`);

  // Links: between concepts (or strands) of different strands, each with a page.
  const strandOf = (id: unknown) => {
    const n = byId.get(id ?? null);
    return n?.kind === "strand" ? n.id : n?.kind === "concept" ? n.parent : undefined;
  };
  for (const [l, i] of objects(tree, "links", "link", out)) {
    const w = `link ${i}`;
    for (const f of LINK_FIELDS) if (!Object.hasOwn(l, f)) err(w, "missing-field", `missing ${f}`);
    for (const end of ["from", "to"] as const) {
      const v = l[end] ?? null;
      if (!byId.has(v) || byId.get(v)!.kind === "thread") err(w, "link-end", `${end} ${show(v)} is not a concept or strand`);
    }
    if (!LINK_TYPES.includes(l.type)) err(w, "bad-type", `type ${show(l.type)} is not one of ${LINK_TYPES.join(", ")}`);
    if (!ORIGINS.includes(l.origin)) err(w, "bad-origin", `origin ${show(l.origin)} is not teacher, canvas or ai`);
    if (!truthy(l.refs)) err(w, "refs-missing", "needs ≥ 1 ref");
    const kept = frozen.has(l.from as string) && frozen.has(l.to as string);
    list(l.refs).forEach((r, j) => ref(`link ${i} (${py(l.from)}→${py(l.to)}) ref ${j}`, r, ["home", "also"], isHeld(linkHolder(l.from, l.to), kept, r)));
    const branch = strandOf(l.from);
    if (branch !== undefined && branch === strandOf(l.to)) err(w, "link-same-branch", `${py(l.from)} and ${py(l.to)} are in one strand; links join different branches`);
  }
  if (!within(list(tree.links).length, t.links)) count("count-links", `${list(tree.links).length} links, need ${span(t.links)}`);

  // Contrasts: groups of concepts.
  const contrastIds = new Set<unknown>();
  for (const [c] of objects(tree, "contrasts", "contrast", out)) {
    const w = `contrast ${py(c.id)}`;
    if (contrastIds.has(c.id ?? null)) err(w, "duplicate-id", "duplicate id");
    contrastIds.add(c.id ?? null);
    for (const f of CONTRAST_FIELDS) if (!Object.hasOwn(c, f)) err(w, "missing-field", `missing ${f}`);
    const members = list(c.nodes);
    if (!within(members.length, t.contrastMembers)) err(w, "contrast-size", `${members.length} nodes, need ${span(t.contrastMembers)}`);
    for (const m of members) {
      const n = byId.get(m ?? null);
      if (!n) err(w, "unknown-node", `node ${show(m)} is unknown`);
      else if (n.kind !== "concept") err(w, "contrast-member", `${py(m)} is a ${py(n.kind)}; a contrast compares concepts`);
    }
  }
  if (!within(list(tree.contrasts).length, t.contrasts)) count("count-contrasts", `${list(tree.contrasts).length} contrasts, need ${span(t.contrasts)}`);

  // The tour.
  if (!within(list(tree.tour).length, t.tour)) count("count-tour", `${list(tree.tour).length} tour steps, need ${span(t.tour)}`);
  for (const [s, i] of objects(tree, "tour", "tour", out)) {
    const node = s.node ?? null;
    if (node !== null && !byId.has(node)) err(tourStep(i), "unknown-node", `node ${show(node)} is unknown`);
    if (!truthy(s.title) || !truthy(s.text)) err(tourStep(i), "tour-text", "needs title and text");
  }

  // Formulas kept on a concept (the format allows them; the sheet is the usual place).
  for (const n of nodes) {
    const w = `node ${py(n.id)}`;
    if (n.formulas === undefined) continue;
    if (!Array.isArray(n.formulas)) {
      err(w, "bad-formulas", "formulas must be a list");
      continue;
    }
    if (n.formulas.length && n.kind !== "concept") err(w, "formulas-not-concept", "only concepts have formulas");
    n.formulas.forEach((f: unknown, i) => {
      const fw = `${w} formula ${i}`;
      if (!isRecord(f) || typeof f.tex !== "string" || !f.tex.trim()) return err(fw, "tex-missing", "needs tex");
      const error = ctx.katex?.(f.tex, false) ?? null;
      if (error !== null) err(fw, "katex", `KaTeX cannot render it: ${error.split("\n")[0]}`);
      if (typeof f.note !== "string" || cpLength(f.note) > TEXT.nodeFormulaNote) err(fw, "formula-note", `note missing or longer than ${TEXT.nodeFormulaNote} characters`);
    });
  }

  // An update keeps every id of the current map, of the same kind under the same parent.
  for (const f of ctx.frozen ?? []) {
    const n = byId.get(f.id);
    if (!n) err(`node ${f.id}`, "frozen-missing", "a node of the current map is gone; an update keeps every id");
    else if (n.kind !== f.kind || (n.parent ?? null) !== f.parent) err(`node ${f.id}`, "frozen-changed", `it was a ${f.kind} under ${py(f.parent)}; an update keeps kind and parent`);
  }
  return out;
}

/** JSON values equal as Python compares them (object keys in any order; a missing value is None). */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (isRecord(a) || isRecord(b)) {
    if (!isRecord(a) || !isRecord(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]));
  }
  return (a ?? null) === (b ?? null);
}

/**
 * check_structure.py --same-concepts: two variants of a course's map hold the same concepts,
 * identical in everything but their place in the tree.
 */
export function sameConcepts(tree: unknown, other: unknown): Issue[] {
  const conceptsOf = (t: unknown) => new Map(list(isRecord(t) ? t.nodes : []).flatMap((n) => (isRecord(n) && n.kind === "concept" ? [[n.id, n] as const] : [])));
  const mine = conceptsOf(tree);
  const theirs = conceptsOf(other);
  const out: Issue[] = [];
  for (const id of [...mine.keys(), ...theirs.keys()]) {
    if (mine.has(id) !== theirs.has(id)) out.push(issue("same-concepts", "same-concepts-missing", `${py(id)} is in only one file`));
  }
  const keys = ["title", "term", "gist", "refs", "core", "en", "formulas"];
  for (const [id, a] of mine) {
    const b = theirs.get(id);
    if (b && !keys.every((k) => same(a[k], b[k]))) out.push(issue("same-concepts", "same-concepts-differ", `${py(id)} differs (title, term, gist, refs, core, en and formulas must be identical)`));
  }
  return out;
}
