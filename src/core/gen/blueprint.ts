// The blueprint (in-app generation, design §4.3 M2a) checked in code before the draft is written
// from it: ids unique (concepts kebab-case), each branch under a parent of the right kind, a teacher
// thread on a page that states the course's structure (anchors.ts), home pages and anchor pages in
// the decks, the counts within the course's targets (limits.ts), the tour on known nodes. Ops cannot
// mend a plan, so a blueprint with errors is asked for again once, with the issues (structure
// prompts' `blueprint({ retry })`). Also what 重新生成 gives it (the earlier map's concepts, whose
// ids it reuses), and where a draft departs from it, for the run's report.

import type { CourseStructure } from "../structure";
import { issue, tourStep, type Deck, type Issue, type PageAt } from "./checkStructure";
import { pageProblem } from "./findings";
import type { StructureTargets } from "./limits";
import type { AnchorRef, BlueprintAnswer, DraftAnswer } from "./schemas";

export interface BlueprintContext {
  decks: readonly Deck[];
  /** Pages where the slides state the course's structure (anchors.ts `roadmap`): a teacher thread rests on one. */
  roadmapPages: readonly PageAt[];
  targets: StructureTargets;
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const span = ([lo, hi]: readonly [number, number]) => `${lo}–${hi}`;
const within = (n: number, [lo, hi]: readonly [number, number]) => lo <= n && n <= hi;
const none = (r: AnchorRef) => r.lecture === 0 && r.page === 0;

/** What keeps a blueprint from being written into a map: every problem is an error, under `thread <id>`, `strand <id>`, `concept <id>`, `tour step <n>` or `sizes`. */
export function checkBlueprint(answer: BlueprintAnswer, ctx: BlueprintContext): Issue[] {
  const out: Issue[] = [];
  const err = (where: string, code: string, message: string) => out.push(issue(where, code, message));
  const decks = new Map(ctx.decks.map((d) => [d.no, d]));
  const t = ctx.targets;
  const kindOf = new Map<string, string>();
  const named = (kind: string, id: string) => {
    const w = `${kind} ${id}`;
    if (!id.trim()) err(w, "empty-id", "no id");
    else if (kindOf.has(id)) err(w, "duplicate-id", `the id is taken by a ${kindOf.get(id)}`);
    else kindOf.set(id, kind);
    if (kind === "concept" && id.trim() && !ID.test(id)) err(w, "bad-id", "a concept's id is an English kebab-case slug");
  };
  const anchored = (w: string, r: AnchorRef) => {
    const problem = none(r) ? null : pageProblem(r.lecture, r.page, decks);
    if (problem) err(w, "anchor-page", problem);
  };

  for (const th of answer.threads) named("thread", th.id);
  for (const s of answer.strands) named("strand", s.id);
  for (const c of answer.concepts) named("concept", c.id);

  for (const th of answer.threads) {
    const w = `thread ${th.id}`;
    anchored(w, th.anchorRef);
    if (th.origin !== "teacher") continue;
    if (none(th.anchorRef)) err(w, "roadmap-missing", "a teacher thread rests on the page that states its structure");
    else if (!ctx.roadmapPages.some((p) => p.lecture === th.anchorRef.lecture && p.page === th.anchorRef.page)) err(w, "roadmap-page", `L${th.anchorRef.lecture} p${th.anchorRef.page} is no page that states the course's structure`);
  }
  for (const s of answer.strands) {
    anchored(`strand ${s.id}`, s.anchorRef);
    if (kindOf.get(s.parent) !== "thread") err(`strand ${s.id}`, "bad-parent", `its parent ${JSON.stringify(s.parent)} is no thread`);
  }
  for (const c of answer.concepts) {
    const w = `concept ${c.id}`;
    if (kindOf.get(c.parent) !== "strand") err(w, "bad-parent", `its parent ${JSON.stringify(c.parent)} is no strand`);
    const problem = pageProblem(c.homeLecture, c.homePage, decks);
    if (problem) err(w, "home-page", problem);
  }
  answer.tour.forEach((s, i) => {
    if (s.node && !kindOf.has(s.node)) err(tourStep(i), "unknown-node", `node ${JSON.stringify(s.node)} is not in the blueprint`);
  });

  const count = (code: string, message: string) => err("sizes", code, message);
  const under = (parent: string, of: readonly { parent: string }[]) => of.filter((x) => x.parent === parent).length;
  if (!within(answer.threads.length, t.threads)) count("count-threads", `${answer.threads.length} threads, need ${span(t.threads)}`);
  for (const th of answer.threads) if (!within(under(th.id, answer.strands), t.strandsPerThread)) count("count-strands", `thread ${th.id} has ${under(th.id, answer.strands)} strands, need ${span(t.strandsPerThread)}`);
  for (const s of answer.strands) if (!within(under(s.id, answer.concepts), t.conceptsPerStrand)) count("count-strand-concepts", `strand ${s.id} has ${under(s.id, answer.concepts)} concepts, need ${span(t.conceptsPerStrand)}`);
  if (!within(answer.concepts.length, t.concepts)) count("count-concepts", `${answer.concepts.length} concepts, need ${span(t.concepts)}`);
  if (!within(answer.tour.length, t.tour)) count("count-tour", `${answer.tour.length} tour steps, need ${span(t.tour)}`);
  return out;
}

/** 重新生成's `previous` material (M2a): the earlier map's concepts — id, term, title and home page — whose ids the blueprint reuses for the same concepts. */
export function previousConcepts(map: CourseStructure): { id: string; term: string; title: string; home: PageAt | null }[] {
  return map.nodes
    .filter((n) => n.kind === "concept")
    .map((n) => {
      const h = n.refs.find((r) => r.role === "home");
      return { id: n.id, term: n.term, title: n.title, home: h ? { lecture: h.lecture, page: h.page } : null };
    });
}

/** Where a draft departs from its blueprint (design M2b: few, and only where the slides show it), in words for the run's report: concepts added or left out, under another parent, homed elsewhere. */
export function blueprintDepartures(plan: BlueprintAnswer, draft: DraftAnswer): string[] {
  const drafted = new Map(draft.nodes.filter((n) => n.kind === "concept").map((n) => [n.id, n]));
  const planned = new Set(plan.concepts.map((c) => c.id));
  const out: string[] = [];
  for (const c of plan.concepts) {
    const n = drafted.get(c.id);
    if (!n) {
      out.push(`concept ${c.id}: planned, not drafted`);
      continue;
    }
    if (n.parent !== c.parent) out.push(`concept ${c.id}: planned under ${c.parent}, drafted under ${n.parent}`);
    const home = n.refs.find((r) => r.role === "home");
    if (!home || home.lecture !== c.homeLecture || home.page !== c.homePage) out.push(`concept ${c.id}: planned at L${c.homeLecture} p${c.homePage}, drafted at ${home ? `L${home.lecture} p${home.page}` : "no home"}`);
  }
  for (const id of drafted.keys()) if (!planned.has(id)) out.push(`concept ${id}: drafted, not planned`);
  return out;
}
