// The code half of the sample-question coverage test (decision D5: 样题 test coverage and decide
// nothing else). One call (prompts/coverage.ts) maps each question it was sent to the concepts it
// needs; code then holds the answer to what was sent — each question on a page of a paper the
// bundle carried (`exam=<n>`), starting with words on that page — and to the map: every concept named
// exists and has a home page in its deck. What it reports becomes the preview's coverage report,
// each question by its paper and page. A need no concept gives, which the slides teach on pages
// whose quotes check, becomes a finding for the verify stage, whose fix is written from those pages
// (structure prompts' `apply`); one the slides do not teach is only reported. After apply, its diff
// check and the recheck, the report is settled on the final map: the preview shows what the
// candidate covers, not what the checked draft did — a fix counts only while what its ops made is
// still in the map (the recheck's repairs and its last resort may have dropped or rewritten it).
// Nothing here sets core or a trap, and a question's own wording goes nowhere but the report.

import type { CourseStructure, PageRef } from "../structure";
import { examPage, SPARSE_CHARS, type Inventory } from "./bundle";
import { issue, type Deck, type Issue } from "./checkStructure";
import { evidenceProblem, pageProblem } from "./findings";
import type { Op } from "./ops";
import type { CoverageAnswer, Evidence, Finding } from "./schemas";
import { cpLength, quoteOnPage, squash } from "./squash";

/** One question of the report. */
export interface CoverageRow {
  /** Where it was sent: the bundle's `exam=<n>`, its paper and the page it starts on. */
  exam: number;
  file: string;
  page: number;
  /** Its label in the paper (Sample 2 Q3). */
  question: string;
  /** The map's concepts it needs, those that exist with a home page. */
  concepts: string[];
  /** Concepts it needed that the final map no longer has (merged or dropped after the test; `settleCoverage`). */
  gone: string[];
  /**
   * What no concept gives, with the pages that teach it whose quotes check — none when the slides
   * do not teach it; `finding`: the finding that fixes it ("" when there is none), `fixed` once its
   * ops were applied and kept.
   */
  gaps: { need: string; taught: string; refs: Evidence[]; finding: string; fixed: boolean }[];
  /** Everything it needs is given: by concepts the map has, or by gaps fixed. */
  covered: boolean;
}

export interface CoverageReport {
  /** The questions that were sent, in the answer's order. */
  rows: CoverageRow[];
  /** What does not check, under `question <n>` (1-based in the answer) or `exam <n> p<page>`. */
  issues: Issue[];
  /** A gap the slides teach, as a finding for verify: `coverage-<question>-<gap>`. */
  findings: Finding[];
}

export interface CoverageContext {
  /** What was sent: the papers, by `exam=<n>`. */
  inventory: Pick<Inventory, "examFiles">;
  /** The map the questions were tested against. */
  map: CourseStructure;
  decks: readonly Deck[];
}

/** Checks a coverage answer against what was sent and the map, and makes the report and the findings. */
export function checkCoverage(answer: CoverageAnswer, ctx: CoverageContext): CoverageReport {
  const issues: Issue[] = [];
  const rows: CoverageRow[] = [];
  const findings: Finding[] = [];
  const concepts = new Map(ctx.map.nodes.filter((n) => n.kind === "concept").map((n) => [n.id, n]));
  const decks = new Map(ctx.decks.map((d) => [d.no, d]));
  const asked = new Set<string>();
  const seen = new Set<string>();

  answer.questions.forEach((q, i) => {
    const where = `question ${i + 1}`;
    const at = examPage(ctx.inventory, q.exam, q.page);
    if (!at) {
      issues.push(issue(where, "coverage-page", `${q.question}: exam=${q.exam} p${q.page} was not sent`));
      return;
    }
    asked.add(`${q.exam}:${q.page}`);
    const key = `${q.exam}:${q.page}:${squash(q.question)}`;
    if (seen.has(key)) issues.push(issue(where, "coverage-duplicate", `${q.question} on ${at.file} p${q.page} is listed twice`, "warning"));
    seen.add(key);
    if (q.quote ? !quoteOnPage(at.text, q.quote) : cpLength(at.text.replace(/\s+/g, "")) >= SPARSE_CHARS) {
      issues.push(issue(where, "coverage-quote", `${q.question}: ${q.quote ? `its first words are not on ${at.file} p${q.page}` : `no first words, though ${at.file} p${q.page} has text`}`, q.quote ? "error" : "warning"));
    }

    const kept = q.concepts.filter((id) => {
      const n = concepts.get(id);
      const home = n?.refs.find((r) => r.role === "home");
      if (n && home && !pageProblem(home.lecture, home.page, decks)) return true;
      issues.push(issue(where, n ? "coverage-home" : "coverage-concept", n ? `${id} has no home page in the course's decks` : `${id} is not a concept of the map`));
      return false;
    });
    const gaps = q.missing.map((m, j) => {
      const refs = m.refs.filter((r) => {
        const problem = evidenceProblem(r, decks);
        if (problem) issues.push(issue(where, "coverage-evidence", `${problem}; dropped`, "warning"));
        return !problem;
      });
      return { need: m.need, taught: m.taught, refs, finding: refs.length ? `coverage-${i + 1}-${j + 1}` : "", fixed: false };
    });
    rows.push({ exam: q.exam, file: at.file, page: q.page, question: q.question, concepts: kept, gone: [], gaps, covered: kept.length > 0 && gaps.length === 0 });
    gaps.forEach((g) => {
      if (!g.finding) return;
      findings.push({
        id: g.finding,
        severity: "must",
        where: [],
        field: "",
        problem: `A sample question (${q.question}, ${at.file} p${q.page}) needs what no concept gives: ${g.need}`,
        evidence: g.refs,
        fix: g.taught,
      });
    });
  });

  ctx.inventory.examFiles.forEach((f, i) => {
    for (const p of f.pages) if (!asked.has(`${i + 1}:${p.page}`)) issues.push(issue(`exam ${i + 1} p${p.page}`, "coverage-unasked", `${f.file} p${p.page} was sent, and no question starts on it`, "warning"));
  });
  return { rows, issues, findings };
}

/**
 * Whether what `op` did is still so in `map`: the node, ref, link or contrast member it added is
 * there, the text it set unchanged, what it moved where it went, what it removed still gone. The
 * tour and the map's own texts carry no fix of a coverage gap: they count as holding.
 */
function holds(map: CourseStructure, op: Op): boolean {
  const node = (id: string) => map.nodes.find((n) => n.id === id);
  const cites = (refs: readonly PageRef[], r: PageRef) => refs.some((x) => x.lecture === r.lecture && x.page === r.page);
  const link = (from: string, to: string) => map.links.find((l) => l.from === from && l.to === to);
  const contrast = (id: string) => map.contrasts.find((c) => c.id === id);
  switch (op.op) {
    case "addNode":
      return !!node(op.id);
    case "moveNode":
      return node(op.id)?.parent === op.parent;
    case "removeNode":
      return !node(op.id);
    case "setField": {
      if (op.id === "") return true;
      const n = node(op.id) as (Record<string, unknown> & { en?: Record<string, unknown> }) | undefined;
      if (!n) return false;
      const v = op.field.startsWith("en.") ? n.en?.[op.field.slice(3)] : n[op.field];
      // A text as it was set; core and coreWhy are code's (D8) and only need the node.
      return typeof v !== "string" || v === op.value;
    }
    case "addRef":
      return op.refs.every((r) => cites(node(op.id)?.refs ?? [], r));
    case "moveRef":
      return op.refs.every((r) => cites(node(op.to)?.refs ?? [], r));
    case "removeRef":
      return !op.refs.some((r) => cites(node(op.id)?.refs ?? [], r));
    case "addLink":
    case "setLinkField":
      return !!link(op.from, op.to);
    case "removeLink":
      return !link(op.from, op.to);
    case "addContrast":
    case "addToContrast":
      return op.nodes.every((id) => contrast(op.id)?.nodes.includes(id));
    case "setContrastField":
      return !!contrast(op.id);
    case "removeContrast":
      return !contrast(op.id);
    default:
      return true;
  }
}

/**
 * The report on the final map (after apply, its diff check and the recheck), as the preview shows
 * it: a concept the map no longer has moves from `concepts` to `gone`, and a gap is fixed when its
 * finding's ops are among `applied` — the ops kept after the diff check (`revertGroups`) — and what
 * each of them did still holds in `map`. A row is covered when every gap is fixed and a concept
 * still there, or a fixed gap, gives what it needs.
 */
export function settleCoverage(report: CoverageReport, map: CourseStructure, applied: readonly Op[]): CoverageReport {
  const have = new Set(map.nodes.filter((n) => n.kind === "concept").map((n) => n.id));
  const groups = new Map<string, Op[]>();
  for (const op of applied) groups.set(op.group, [...(groups.get(op.group) ?? []), op]);
  const fixed = (finding: string) => !!finding && (groups.get(finding)?.every((op) => holds(map, op)) ?? false);
  const rows = report.rows.map((r) => {
    const concepts = r.concepts.filter((id) => have.has(id));
    const gone = [...r.gone, ...r.concepts.filter((id) => !have.has(id))];
    const gaps = r.gaps.map((g) => ({ ...g, fixed: g.fixed || fixed(g.finding) }));
    return { ...r, concepts, gone, gaps, covered: gaps.every((g) => g.fixed) && (concepts.length > 0 || gaps.length > 0) };
  });
  return { ...report, rows };
}
