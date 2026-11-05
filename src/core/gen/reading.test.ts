import { describe, expect, it } from "vitest";
import type { InventoryPage, PageDigest } from "./bundle";
import { mergeReadings, readingIssues, rereadPages } from "./reading";
import { digestSchema, misfits } from "./schemas";

const page = (n: number, text: string, figure = false): InventoryPage => ({ page: n, text, image: null, figure });
const read = (n: number, title: string, extra: Partial<PageDigest> = {}): PageDigest => ({ page: n, kind: "content", title, formulas: [], figureKind: "none", figureText: "", edges: [], teacherQuestion: "", roadmapItems: [], terms: [], ...extra });
const katex = (tex: string) => (tex.includes("\\notacommand") ? "KaTeX parse error: Undefined control sequence" : null);

// A deck as Stage I left it: a plain page, a page whose text layer garbled the maths (Σ as U+0DCD),
// one that names a formula without any maths in its text, a figure, and a title slide.
const SENT = [
  page(1, "Bias of an estimator\nThe bias is the expected error of the estimate, its mean minus the truth"),
  page(2, "Empirical risk\n෍ loss over the training sample, divided by the sample size n"),
  page(3, "The update rule is given by the gradient of the loss times the learning rate"),
  page(4, "Trade-off", true),
  page(5, "Questions?"),
];
const GOOD = [
  read(1, "Bias of an estimator"),
  read(2, "Empirical risk", { kind: "formula", formulas: [{ tex: "\\frac1n\\sum_i \\ell(y_i, f(x_i))", what: "empirical risk" }] }),
  read(3, "Update rule", { kind: "formula", formulas: [{ tex: "w \\leftarrow w - \\eta \\nabla L", what: "gradient step" }] }),
  read(4, "Trade-off", { kind: "figure", figureKind: "chart", figureText: "bias falls, variance rises" }),
  read(5, "Thanks"),
];

describe("the page reader's answers, checked in code (design §4.2)", () => {
  it("pass a reading with every page once, formulas that render and titles on their pages", () => {
    expect(misfits(digestSchema, { pages: GOOD })).toEqual([]);
    // Page 5's title is not in its text, but a page under 30 characters is not held to it.
    expect(readingIssues(SENT, GOOD, katex)).toEqual([]);
  });

  it("name a page missing, read twice or not sent, a formula KaTeX cannot render, and a title not on its page", () => {
    const answer = [read(1, "Bias of an estimator", { formulas: [{ tex: "\\notacommand x", what: "" }] }), read(1, "Bias"), GOOD[1], { ...GOOD[2], title: "Momentum" }, GOOD[3], read(9, "Elsewhere")];
    expect(readingIssues(SENT, answer, katex).map((i) => `${i.where}: ${i.code}`)).toEqual(["page 1: reading-twice", "page 1: reading-katex", "page 3: reading-title", "page 5: reading-missing", "page 9: reading-extra"]);
  });

  it("expect a formula where the text garbles maths or names one without maths, and a figure where PDF.js found one (the image pilot's rule)", () => {
    const empty = [GOOD[0], read(2, "Empirical risk"), read(3, "The update rule"), read(4, "Trade-off"), GOOD[4]];
    const issues = readingIssues(SENT, empty, katex);
    expect(issues.map((i) => `${i.where}: ${i.code}`)).toEqual(["page 2: reading-no-formula", "page 3: reading-no-formula", "page 4: reading-no-figure"]);
    expect(rereadPages(issues)).toEqual([2, 3, 4]);
    expect(rereadPages(readingIssues(SENT, [...GOOD, read(9, "x")], katex))).toEqual([]);
  });

  it("put the pages read again in place of the first reading, each page once", () => {
    const first = [GOOD[0], read(2, "Empirical risk"), read(2, "Empirical risk again"), GOOD[2], GOOD[3], read(7, "not sent")];
    const merged = mergeReadings(SENT, first, [GOOD[1], GOOD[4]]);
    expect(merged).toEqual(GOOD);
    expect(readingIssues(SENT, merged, katex)).toEqual([]);
  });
});
