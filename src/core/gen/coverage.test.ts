import { describe, expect, it } from "vitest";
import { STRUCTURE_SCHEMA, type CourseStructure } from "../structure";
import type { Inventory } from "./bundle";
import type { Deck } from "./checkStructure";
import { checkCoverage, settleCoverage } from "./coverage";
import type { Op } from "./ops";
import { coverageSchema, misfits, type CoverageAnswer } from "./schemas";

const DECKS: Deck[] = [
  { no: 1, file: "L1.pdf", sha256: "s1", pages: 3, title: "L1", texts: ["Estimation", "Bias of an estimator\nThe bias is the expected error", "Variance of an estimator measures its spread"], seen: ["", "", ""] },
  { no: 2, file: "L2.pdf", sha256: "s2", pages: 2, title: "L2", texts: ["Testing", "A p-value is the probability of data at least as extreme"], seen: ["", "the power curve rises with n"] },
];
const PAPERS: Pick<Inventory, "examFiles"> = {
  examFiles: [
    {
      file: "Sample midterm.pdf",
      sha256: "e1",
      pages: [
        { page: 2, text: "Q1. Which estimator has the smaller bias? Explain with the definition of bias.", image: null, figure: false },
        { page: 3, text: "Q2. A test gives p = 0.03. What does the p-value mean? Q3. What is the power of a test?", image: null, figure: false },
        { page: 4, text: "Formula sheet allowed. Answer all questions in English; write clearly and show your working. Time: two hours.", image: null, figure: false },
      ],
    },
  ],
};
const concept = (id: string, home: { lecture: number; page: number } | null) => ({ id, parent: "S", kind: "concept" as const, title: id, term: id, question: "", gist: "g", core: false, origin: "teacher" as const, refs: home ? [{ ...home, role: "home" as const, quote: "q" }] : [] });
const MAP: CourseStructure = {
  schema: STRUCTURE_SCHEMA,
  id: "A",
  course: "c",
  label: "l",
  lang: "zh",
  createdAt: "",
  generator: { by: "ai" },
  lectures: [],
  summary: "",
  tour: [],
  nodes: [
    { id: "T", parent: null, kind: "thread", title: "T", term: "", question: "？", gist: "g", core: false, origin: "ai", refs: [] },
    { id: "S", parent: "T", kind: "strand", title: "S", term: "", question: "？", gist: "g", core: false, origin: "ai", refs: [] },
    concept("bias", { lecture: 1, page: 2 }),
    concept("p-value", { lecture: 2, page: 2 }),
    concept("homeless", null),
    concept("far-away", { lecture: 2, page: 9 }),
  ],
  links: [],
  contrasts: [],
};
const ev = (lecture: number, page: number, quote: string) => ({ lecture, page, quote });

describe("the sample-question coverage test, checked in code (D5)", () => {
  const answer: CoverageAnswer = {
    questions: [
      { exam: 1, page: 2, question: "Q1", quote: "Which estimator has the smaller bias", concepts: ["bias"], missing: [] },
      {
        exam: 1,
        page: 3,
        question: "Q2",
        quote: "A test gives p = 0.03",
        concepts: ["p-value", "homeless"],
        missing: [{ need: "what a p-value of 0.03 says", taught: "p 值是数据至少这么极端的概率。", refs: [ev(2, 2, "A p-value is the probability"), ev(2, 2, "not on the page"), ev(5, 1, "no such deck")] }],
      },
      { exam: 1, page: 3, question: "Q3", quote: "What is the size of a test", concepts: ["no-such-concept", "far-away"], missing: [{ need: "statistical power", taught: "", refs: [] }] },
      { exam: 1, page: 9, question: "Q9", quote: "made up", concepts: ["bias"], missing: [] },
      { exam: 2, page: 2, question: "Q1", quote: "", concepts: [], missing: [] },
      { exam: 1, page: 2, question: "Q1", quote: "Explain with the definition", concepts: ["bias"], missing: [{ need: "variance", taught: "方差衡量估计的离散程度。", refs: [ev(1, 3, "measures its spread"), ev(2, 2, "the power curve rises"), ev(1, 1, "")] }] },
    ],
  };

  it("fits the coverage schema with the map's concept ids", () => {
    expect(misfits(coverageSchema(["bias", "p-value", "homeless", "far-away", "no-such-concept"]), answer)).toEqual([]);
  });

  it("reports each question sent by its paper and page, with the concepts that exist and what no concept gives", () => {
    const { rows } = checkCoverage(answer, { inventory: PAPERS, map: MAP, decks: DECKS });
    expect(rows.map((r) => [r.question, r.file, r.page, r.concepts, r.gaps.map((g) => g.refs.length), r.covered])).toEqual([
      ["Q1", "Sample midterm.pdf", 2, ["bias"], [], true],
      ["Q2", "Sample midterm.pdf", 3, ["p-value"], [1], false],
      ["Q3", "Sample midterm.pdf", 3, [], [0], false],
      ["Q1", "Sample midterm.pdf", 2, ["bias"], [2], false],
    ]);
  });

  it("names a question that was not sent, words not on its page, a concept the map lacks or without a home, and evidence that does not check", () => {
    const { issues } = checkCoverage(answer, { inventory: PAPERS, map: MAP, decks: DECKS });
    expect(issues.map((i) => `${i.where}: ${i.code} (${i.severity})`)).toEqual([
      "question 2: coverage-home (error)",
      "question 2: coverage-evidence (warning)",
      "question 2: coverage-evidence (warning)",
      "question 3: coverage-quote (error)",
      "question 3: coverage-concept (error)",
      "question 3: coverage-home (error)",
      "question 4: coverage-page (error)",
      "question 5: coverage-page (error)",
      "question 6: coverage-duplicate (warning)",
      "question 6: coverage-evidence (warning)",
      "exam 1 p4: coverage-unasked (warning)",
    ]);
  });

  it("turns only a gap the slides teach into a finding, its fix from the slides and its evidence the pages that check", () => {
    const { findings } = checkCoverage(answer, { inventory: PAPERS, map: MAP, decks: DECKS });
    expect(findings).toEqual([
      {
        id: "coverage-2-1",
        severity: "must",
        where: [],
        field: "",
        problem: "A sample question (Q2, Sample midterm.pdf p3) needs what no concept gives: what a p-value of 0.03 says",
        evidence: [ev(2, 2, "A p-value is the probability")],
        fix: "p 值是数据至少这么极端的概率。",
      },
      {
        id: "coverage-6-1",
        severity: "must",
        where: [],
        field: "",
        problem: "A sample question (Q1, Sample midterm.pdf p2) needs what no concept gives: variance",
        // A quote seen on a page's image counts; a page cited without its words does not (no later stage sees the image).
        evidence: [ev(1, 3, "measures its spread"), ev(2, 2, "the power curve rises")],
        fix: "方差衡量估计的离散程度。",
      },
    ]);
  });

  it("asks for first words wherever the page has text", () => {
    const blank = { questions: [{ exam: 1, page: 4, question: "Notes", quote: "", concepts: [], missing: [] }] };
    expect(checkCoverage(blank, { inventory: PAPERS, map: MAP, decks: DECKS }).issues.filter((i) => i.code === "coverage-quote").map((i) => i.severity)).toEqual(["warning"]);
  });

  it("is settled on the final map: a gap fixed by ops that were kept, a concept merged away named as gone", () => {
    const report = checkCoverage(answer, { inventory: PAPERS, map: MAP, decks: DECKS });
    const fix = (group: string) => ({ op: "setField", group, id: "p-value", field: "gist", value: "g" }) as Op;
    // After apply and its diff check: Q2's gap was fixed and kept, Q1's second gap reverted; bias merged into another concept.
    const final: CourseStructure = { ...MAP, nodes: MAP.nodes.filter((n) => n.id !== "bias") };
    const settled = settleCoverage(report, final, [fix("coverage-2-1"), fix("lenses-1-1")]);
    expect(settled.rows.map((r) => [r.question, r.concepts, r.gone, r.gaps.map((g) => `${g.finding || "none"}: ${g.fixed}`), r.covered])).toEqual([
      ["Q1", [], ["bias"], [], false],
      ["Q2", ["p-value"], [], ["coverage-2-1: true"], true],
      ["Q3", [], [], ["none: false"], false],
      ["Q1", [], ["bias"], ["coverage-6-1: false"], false],
    ]);
    expect([settled.issues, settled.findings]).toEqual([report.issues, report.findings]);
    expect(report.rows[1].gaps[0].fixed).toBe(false);
  });

  it("counts a gap fixed only while what its ops made is still in the final map", () => {
    const report = checkCoverage(answer, { inventory: PAPERS, map: MAP, decks: DECKS });
    const add: Op[] = [
      { op: "addNode", group: "coverage-2-1", id: "p-value-meaning", parent: "S", kind: "concept", title: "p 值的含义", term: "p-value", question: "", gist: "g", origin: "ai" },
      { op: "addRef", group: "coverage-2-1", id: "p-value-meaning", refs: [{ lecture: 2, page: 2, role: "home", quote: "A p-value is the probability" }] },
    ];
    const withNode: CourseStructure = { ...MAP, nodes: [...MAP.nodes, { ...concept("p-value-meaning", { lecture: 2, page: 2 }), title: "p 值的含义" }] };
    expect(settleCoverage(report, withNode, add).rows[1].gaps[0].fixed).toBe(true);
    // The recheck's last resort dropped the new concept (its quote did not check): Q2 is not covered after all.
    const settled = settleCoverage(report, MAP, add);
    expect([settled.rows[1].gaps[0].fixed, settled.rows[1].covered]).toEqual([false, false]);
    // A text the recheck rewrote is no longer the fix either.
    const set: Op[] = [{ op: "setField", group: "coverage-2-1", id: "p-value", field: "gist", value: "数据至少这么极端的概率" }];
    expect(settleCoverage(report, MAP, set).rows[1].gaps[0].fixed).toBe(false);
  });
});
