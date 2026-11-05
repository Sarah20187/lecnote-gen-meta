import { describe, expect, it } from "vitest";
import { FORMULAS_SCHEMA, type FormulaSheet } from "../formulas";
import { STRUCTURE_SCHEMA, type CourseStructure, type PageRef } from "../structure";
import { dropUnverifiable, fixRefs } from "./autofix";
import { checkEnglish } from "./checkEnglish";
import { validateFormulas } from "./checkFormulas";
import type { Digests, Inventory, PageDigest } from "./bundle";
import { validateStructure } from "./checkStructure";
import { contextFromReadings, courseLang, decksFrom, frozenFrom } from "./context";
import { appLimits, HAND_MADE } from "./limits";

const reading = (page: number, kind: PageDigest["kind"], title: string, extra: Partial<PageDigest> = {}): PageDigest => ({ page, kind, title, formulas: [], figureKind: "none", figureText: "", edges: [], teacherQuestion: "", roadmapItems: [], terms: [], ...extra });

// A made-up course: two lectures (given out of order) and a sample paper whose reading has a question page.
const INVENTORY: Inventory = {
  lectures: [
    {
      no: 2,
      file: "slides/L2.pdf",
      title: "Testing",
      sha256: "s2",
      pages: [
        { page: 2, text: "Recap: tests and intervals answer the same question", image: null, figure: false },
        { page: 1, text: "Hypothesis testing\nOutline: p-values", image: null, figure: false },
        { page: 3, text: "", image: "img/s2/p003.jpg", figure: true },
      ],
    },
    {
      no: 1,
      file: "slides/L1.pdf",
      title: "Estimation",
      sha256: "s1",
      pages: [
        { page: 1, text: "Estimation\nLecture 1 outline: bias and variance", image: null, figure: false },
        { page: 2, text: "Bias of an estimator\nThe bias is the expected error", image: null, figure: false },
        { page: 3, text: "Question: why does variance matter?", image: null, figure: false },
      ],
    },
  ],
  exams: [
    { exam: "期中", date: "", form: "", language: "unknown", files: [] },
    { exam: "期末", date: "", form: "闭卷", language: "en", files: ["P9.pdf#p1"] },
  ],
  examFiles: [{ file: "P9.pdf", sha256: "e1", pages: [{ page: 1, text: "Q1. Why does variance matter?", image: null, figure: false }] }],
  note: "",
};
const DIGESTS: Digests = {
  s1: [reading(1, "outline", "Estimation", { roadmapItems: ["bias", "variance"] }), reading(2, "content", "Bias of an estimator"), reading(3, "question", "Question", { teacherQuestion: "Why does variance matter?" })],
  s2: [
    reading(1, "outline", "Hypothesis testing", { roadmapItems: ["p-values"] }),
    reading(2, "recap", "Recap"),
    reading(3, "figure", "Power curve", { figureKind: "chart", figureText: "power rises with the sample size", edges: [{ from: "sample size", to: "power", label: "raises" }], terms: ["statistical power"] }),
  ],
  // The sample paper's reading: a question there is no teacher's signal (D5).
  e1: [reading(1, "question", "Q1", { teacherQuestion: "Why does variance matter?" })],
};

const ref = (lecture: number, page: number, role: PageRef["role"], quote: string, checked?: PageRef["checked"]): PageRef => ({ lecture, page, role, quote, ...(checked ? { checked } : {}) });

function map(nodes: CourseStructure["nodes"]): CourseStructure {
  return {
    schema: STRUCTURE_SCHEMA,
    id: "A",
    course: "STAT1",
    label: "l",
    lang: "zh",
    createdAt: "",
    generator: { by: "ai" },
    lectures: decksFrom(INVENTORY, DIGESTS).map(({ no, file, sha256, pages, title }) => ({ no, file, sha256, pages, title })),
    summary: "",
    tour: [],
    nodes,
    links: [],
    contrasts: [{ id: "k", title: "两种", nodes: ["bias", "power"], note: "n" }],
  };
}
const NODES: CourseStructure["nodes"] = [
  { id: "T", parent: null, kind: "thread", title: "统计", term: "", question: "怎么推断？", gist: "g", core: false, origin: "teacher", refs: [ref(1, 1, "roadmap", "Lecture 1 outline")] },
  { id: "S", parent: "T", kind: "strand", title: "估计", term: "", question: "估计好不好？", gist: "g", core: false, origin: "ai", refs: [] },
  { id: "bias", parent: "S", kind: "concept", title: "偏差", term: "bias", question: "", gist: "g", core: false, origin: "teacher", refs: [ref(1, 2, "home", "Bias of an estimator")] },
  { id: "power", parent: "S", kind: "concept", title: "功效", term: "power", question: "", gist: "g", core: false, origin: "teacher", refs: [ref(2, 3, "home", "power rises with the sample size")] },
];

describe("the checks' context, from the inventory and the readings", () => {
  it("pins each deck as a map cites it, with its page texts and what the reader saw on the pages whose image it read", () => {
    const decks = decksFrom(INVENTORY, DIGESTS);
    expect(decks.map(({ no, file, sha256, pages, title }) => ({ no, file, sha256, pages, title }))).toEqual([
      { no: 1, file: "slides/L1.pdf", sha256: "s1", pages: 3, title: "Estimation" },
      { no: 2, file: "slides/L2.pdf", sha256: "s2", pages: 3, title: "Testing" },
    ]);
    expect(decks[1].texts).toEqual(["Hypothesis testing\nOutline: p-values", "Recap: tests and intervals answer the same question", ""]);
    // Only L2 p3's image was read: its title, figure, edges and terms are what was seen there.
    expect(decks[1].seen).toEqual(["", "", "Power curve\npower rises with the sample size\nsample size\npower\nraises\nstatistical power"]);
    expect(decks[0].seen).toEqual(["", "", ""]);
  });

  it("takes the roadmap and signal pages from the lectures' readings, never from a sample paper's (D5, D8), and the language from the exams", () => {
    const ctx = contextFromReadings(INVENTORY, DIGESTS, { limits: appLimits(6, 2) });
    expect(ctx.mode).toBe("full");
    expect(ctx.lang).toBe("en");
    expect(ctx.frozen).toBeUndefined();
    expect(ctx.roadmapPages).toEqual([
      { lecture: 1, page: 1 },
      { lecture: 2, page: 1 },
      { lecture: 2, page: 2 },
    ]);
    expect(ctx.signalPages).toEqual([
      { lecture: 1, page: 3, kind: "teacherQuestion" },
      { lecture: 2, page: 2, kind: "recap" },
    ]);
    // A deck's page listed as exam material (考试信息.json "L1.pdf#p3") is a sample question, not the teacher's.
    const listed = { ...INVENTORY, examFiles: [...INVENTORY.examFiles, { file: "slides/L1.pdf", sha256: "s1", pages: [{ page: 3, text: "Question: why does variance matter?", image: null, figure: false }] }] };
    expect(contextFromReadings(listed, DIGESTS, { limits: appLimits(6, 2) }).signalPages).toEqual([{ lecture: 2, page: 2, kind: "recap" }]);
    expect(courseLang([])).toBe("unknown");
    expect(courseLang([{ exam: "", date: "", form: "", language: "zh", files: [] }])).toBe("zh");
  });

  it("lets the checks find an image quote where the reader saw it, and a core flag only on a signal of its own kind", () => {
    const ctx = contextFromReadings(INVENTORY, DIGESTS, { limits: appLimits(6, 2) });
    const codes = (tree: CourseStructure) => validateStructure(tree, ctx).filter((i) => ["quote-not-on-page", "core-evidence", "roadmap-page"].includes(i.code)).map((i) => `${i.where}: ${i.code}`);
    // The figure's words are not in L2 p3's text: fixRefs marks the ref as seen on the image, and then it checks.
    expect(codes(map(NODES))).toEqual(["node power ref 0: quote-not-on-page"]);
    const fixed = fixRefs(map(NODES), ctx.decks);
    expect(fixed.changes).toEqual(['node power ref 0: on the image of L2 p3, not in its text: marked checked "image", for the verify stage']);
    expect(codes(fixed.doc)).toEqual([]);

    const core = (kind: string, page: number, quote: string) => map(NODES.map((n) => (n.id === "bias" ? { ...n, core: true, coreWhy: { kind, ref: ref(page < 3 ? 2 : 1, page < 3 ? page : 3, "also", quote) } } : n)));
    expect(codes(core("teacherQuestion", 3, "why does variance matter"))).toEqual(["node power ref 0: quote-not-on-page"]);
    expect(codes(core("teacherQuestion", 2, "tests and intervals"))).toEqual(["node bias coreWhy: core-evidence", "node power ref 0: quote-not-on-page"]);
    expect(validateStructure(core("teacherQuestion", 2, "tests and intervals"), ctx).find((i) => i.code === "core-evidence")!.message).toBe("L2 p2 is a recap page, not a teacherQuestion one");
  });

  it("keeps, in an update, every node of the current map with its kind and parent, and its nodes and contrasts from ops", () => {
    const current = map(NODES);
    const ctx = contextFromReadings(INVENTORY, DIGESTS, { limits: appLimits(6, 2), update: current });
    expect(ctx.mode).toBe("patch");
    expect(ctx.frozen).toEqual([
      { id: "T", kind: "thread", parent: null },
      { id: "S", kind: "strand", parent: "T" },
      { id: "bias", kind: "concept", parent: "S" },
      { id: "power", kind: "concept", parent: "S" },
    ]);
    expect(frozenFrom(current).ids).toEqual(["T", "S", "bias", "power", "k"]);
    const sheet: FormulaSheet = { schema: FORMULAS_SCHEMA, course: "", createdAt: "", generator: { by: "ai" }, basis: { exam: "", note: "" }, lectures: [], formulas: [{ id: "f1", concept: "bias", name: "n", tex: "t", note: "", trap: "", refs: [] }] };
    expect(frozenFrom(sheet)).toEqual({ nodes: [], ids: ["f1"], refs: [] });
    const moved = map(NODES.map((n) => (n.id === "power" ? { ...n, parent: "T", kind: "strand" as const } : n)));
    expect(validateStructure(moved, ctx).filter((i) => i.code.startsWith("frozen")).map((i) => i.where)).toEqual(["node power"]);
  });

  it("holds what an update keeps of a hand-made map to the hand-made limits, and what it adds to the app's", () => {
    // A map made in a Claude session: an 80-character gist, a one-word quote, an English gist of 170.
    const long = "长".repeat(80);
    const enLong = "a".repeat(170);
    const hand = map(
      NODES.map((n) =>
        n.id === "bias" ? { ...n, gist: long, refs: [ref(1, 2, "home", "Bias"), ref(1, 3, "also", "Question: why does variance matter?")], en: { title: "Bias", question: "", gist: enLong } } : n,
      ),
    );
    const ctx = contextFromReadings(INVENTORY, DIGESTS, { limits: appLimits(6, 2), update: hand });
    expect(ctx.frozenLimits).toBe(HAND_MADE);
    const length = (tree: CourseStructure) => validateStructure(tree, ctx).filter((i) => ["gist-length", "quote-length"].includes(i.code)).map((i) => `${i.where}: ${i.code}`);
    expect(length(hand)).toEqual([]);
    // Without the hand-made limits, every one of them would be an error no op could fix (the node is frozen).
    expect(validateStructure(hand, { ...ctx, frozenLimits: undefined }).filter((i) => ["gist-length", "quote-length"].includes(i.code)).map((i) => i.where)).toEqual(["node bias", "node bias ref 0"]);
    // A concept the update adds, with the same texts, is held to the app's limits (D9).
    const added = { ...hand, nodes: [...hand.nodes, { ...hand.nodes[2], id: "variance", term: "variance" }] };
    expect(length(added)).toEqual(["node variance: gist-length", "node variance ref 0: quote-length"]);
    // The English likewise; and the last resort keeps the hand-made refs, which now check.
    const en = (tree: CourseStructure) => checkEnglish(tree, ctx.limits, ctx).filter((i) => i.code === "en-length").map((i) => i.where);
    const english = (tree: CourseStructure): CourseStructure => ({ ...tree, en: { label: "L", summary: "S" }, nodes: tree.nodes.map((n) => ({ ...n, en: n.en ?? { title: "T", question: n.kind === "concept" ? "" : "Q?", gist: "g" } })), contrasts: tree.contrasts.map((c) => ({ ...c, en: { title: "t", note: "n" } })) });
    expect(en(english(hand))).toEqual([]);
    expect(en(english({ ...hand, nodes: [...hand.nodes, { ...hand.nodes[2], id: "variance" }] }))).toEqual(["node variance"]);
    expect(dropUnverifiable(hand, ctx).changes.filter((c) => c.includes("bias"))).toEqual([]);
  });

  it("leaves the refs a hand-made map had where they are in an update, and reports what does not check on them without asking for a repair", () => {
    // Made by hand, on other slide texts: bias's home quote is on L1 p2, cited as L1 p3; power's is only on L2 p3's picture, unmarked.
    const hand = map(NODES.map((n) => (n.id === "bias" ? { ...n, refs: [ref(1, 3, "home", "The bias is the expected error")] } : n)));
    const ctx = contextFromReadings(INVENTORY, DIGESTS, { limits: appLimits(6, 2), update: hand });
    // Without the adopted refs named, autofix would move bias's home and mark power's as seen on the picture (for verify, which may drop it).
    expect(fixRefs(hand, ctx.decks).changes).toHaveLength(2);
    expect(fixRefs(hand, ctx.decks, ctx.heldRefs)).toEqual({ doc: hand, changes: [] });
    const problems = validateStructure(hand, ctx).filter((i) => i.code === "quote-not-on-page").map((i) => `${i.where}: ${i.severity}`);
    expect(problems).toEqual(["node bias ref 0: warning", "node power ref 0: warning"]);
    const last = dropUnverifiable(hand, ctx);
    expect(last.doc).toEqual(hand);
    expect(last.changes.map((c) => c.split(":")[0])).toEqual(["node bias ref 0", "node power ref 0"]);
  });

  it("checks a ref an update gives a kept concept, link or formula as the app's own: the last resort drops it when it does not check", () => {
    // An app-made map: power's home was checked on L2 p3's picture.
    const adopted = map(NODES.map((n) => (n.id === "power" ? { ...n, refs: [ref(2, 3, "home", "power rises with the sample size", "image")] } : n)));
    const lectures = adopted.lectures;
    const sheet: FormulaSheet = { schema: FORMULAS_SCHEMA, course: "", createdAt: "", generator: { by: "ai" }, basis: { exam: "", note: "" }, lectures, formulas: [{ id: "bias-def", concept: "bias", name: "偏差", tex: "E[x]", note: "n", trap: "", refs: [ref(1, 2, "home", "Bias of an estimator")] }] };
    const ctx = contextFromReadings(INVENTORY, DIGESTS, { limits: appLimits(6, 2), update: adopted, sheet });
    // The patch cites L2 p2 on bias with words that page does not have, and a one-word quote on power; it links the two, on no page's words.
    const patched: CourseStructure = {
      ...adopted,
      nodes: adopted.nodes.map((n) => (n.id === "bias" ? { ...n, refs: [...n.refs, ref(2, 2, "also", "bias always shrinks with more data")] } : n.id === "power" ? { ...n, refs: [...n.refs, ref(2, 2, "also", "Recap")] } : n)),
      links: [{ from: "bias", to: "power", type: "contrast", note: "n", origin: "ai", refs: [ref(2, 2, "also", "no such words here")] }],
    };
    const errors = validateStructure(patched, ctx).filter((i) => i.severity === "error" && i.code.startsWith("quote")).map((i) => `${i.where}: ${i.code}`);
    expect(errors).toEqual(["node bias ref 1: quote-not-on-page", "node power ref 1: quote-length", "link 0 (bias→power) ref 0: quote-not-on-page"]);
    const last = dropUnverifiable(patched, ctx);
    expect(last.doc.nodes).toEqual(adopted.nodes);
    expect(last.doc.links).toEqual([]);
    expect(last.changes.filter((c) => c.includes("kept"))).toEqual([]);
    // The same for a formula the adopted sheet had.
    const fctx = { ...ctx, concepts: ["bias", "power"], frozenFormulas: ["bias-def"] };
    const grown: FormulaSheet = { ...sheet, formulas: [{ ...sheet.formulas[0], refs: [...sheet.formulas[0].refs, ref(2, 2, "also", "bias always shrinks with more data")] }] };
    expect(validateFormulas(grown, fctx).map((i) => `${i.where}: ${i.code} ${i.severity}`)).toEqual(["formula bias-def ref 1: quote-not-on-page error"]);
    expect(dropUnverifiable(grown, fctx).doc).toEqual(sheet);
  });

  it("holds an adopted sheet's formulas to the hand-made limits in an update, and keeps them in the last resort", () => {
    const lectures = map(NODES).lectures;
    const formula = (id: string, refs: PageRef[]) => ({ id, concept: "bias", name: "偏差", tex: "E[x]", note: "n", trap: "", refs });
    const sheet: FormulaSheet = { schema: FORMULAS_SCHEMA, course: "", createdAt: "", generator: { by: "ai" }, basis: { exam: "", note: "" }, lectures, formulas: [formula("bias-def", [ref(1, 2, "home", "Bias")]), formula("bias-new", [ref(1, 2, "home", "Bias")])] };
    // The adopted sheet had bias-def; the update added bias-new.
    const ctx = contextFromReadings(INVENTORY, DIGESTS, { limits: appLimits(6, 2), update: map(NODES), sheet: { ...sheet, formulas: [sheet.formulas[0]] } });
    const fctx = { ...ctx, concepts: ["bias", "power"], frozenFormulas: ["bias-def"] };
    expect(validateFormulas(sheet, fctx).map((i) => `${i.where}: ${i.code}`)).toEqual(["formula bias-new ref 0: quote-length"]);
    const gone: FormulaSheet = { ...sheet, formulas: sheet.formulas.map((f) => ({ ...f, refs: [ref(1, 9, "home", "Bias of an estimator")] })) };
    expect(dropUnverifiable(gone, fctx).changes).toEqual([
      "formula bias-def ref 0: dropped (L1 p9 is out of range (1–3))",
      "formula bias-new ref 0: dropped (L1 p9 is out of range (1–3))",
      "formula bias-def: kept without a home page, as an update keeps every formula",
      "formula bias-new: dropped, no home page left",
    ]);
  });
});
