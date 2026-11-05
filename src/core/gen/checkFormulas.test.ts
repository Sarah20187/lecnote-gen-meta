import { describe, expect, it } from "vitest";
import { validateFormulas, type FormulaContext } from "./checkFormulas";
import type { Deck, Issue } from "./checkStructure";
import { appLimits, HAND_MADE } from "./limits";

// A made-up 3-lecture course (parity with check_formulas.py on the the reference course sheet is in checkStructure.test.ts).
const PAGES: Record<number, string[]> = {
  1: ["Estimation", "Bias of an estimator\nThe bias is the expected error of the estimate", "Variance of an estimator measures its spread"],
  2: ["Hypothesis testing", "A p-value is the probability of data at least as extreme"],
  3: ["Linear models", "Least squares minimises the sum of squared residuals", "Ridge regression adds a penalty on the weights"],
};
const DECKS: Deck[] = [1, 2, 3].map((no) => ({ no, file: `L${no}.pdf`, sha256: `sha${no}`, pages: PAGES[no].length, title: `Lecture ${no}`, texts: PAGES[no] }));
const rendered: [string, boolean][] = [];
const CTX: FormulaContext = {
  decks: DECKS,
  mode: "full",
  limits: appLimits(8, 3),
  concepts: ["bias", "variance", "p-value", "least-squares", "ridge"],
  katex: (tex, display) => (rendered.push([tex, display]), tex.includes("\\nope") ? "Undefined control sequence: \\nope" : null),
};

const ref = (lecture: number, page: number, role: string, quote: string) => ({ lecture, page, role, quote });
const formula = (id: string, concept: string, home: object, extra: object = {}) => ({ id, concept, name: `${id} 的公式`, tex: "x^2", note: "x 是变量", trap: "", refs: [home], en: { name: id, note: "x is the variable", trap: "" }, ...extra });

function miniSheet(): Record<string, any> {
  return {
    schema: "lecnote-formulas/1",
    course: "STAT1",
    createdAt: "2026-10-27",
    generator: { by: "ai" },
    basis: { exam: "MCQ", note: "" },
    lectures: DECKS.map(({ no, file, sha256, pages, title }) => ({ no, file, sha256, pages, title })),
    formulas: [
      formula("bias-def", "bias", ref(1, 2, "home", "expected error of the estimate"), { tex: "\\mathrm{Bias}(\\hat\\theta) = \\mathbb{E}[\\hat\\theta] - \\theta" }),
      formula("variance-def", "variance", ref(1, 3, "home", "measures its spread"), { refs: [ref(1, 3, "home", "measures its spread"), ref(1, 2, "also", "Bias of an estimator")] }),
      formula("p-value-def", "p-value", ref(2, 2, "home", "at least as extreme")),
      formula("ridge-objective", "ridge", ref(3, 3, "home", "adds a penalty on the weights"), { trap: "λ=0 时就是最小二乘", en: { name: "Ridge", note: "λ: the penalty", trap: "With λ = 0 it is least squares" } }),
    ],
  };
}

const codes = (issues: Issue[]) => issues.map((i) => `${i.where}: ${i.code}`);
const check = (sheet: unknown, ctx: Partial<FormulaContext> = {}) => validateFormulas(sheet, { ...CTX, ...ctx });
const formulaOf = (sheet: Record<string, any>, id: string) => sheet.formulas.find((f: { id: string }) => f.id === id);

describe("checking a formula sheet", () => {
  it("passes a well-made sheet, rendering every formula in display mode", () => {
    rendered.length = 0;
    expect(check(miniSheet())).toEqual([]);
    expect(rendered.map(([, display]) => display)).toEqual([true, true, true, true]);
  });

  it("checks ids, concepts, LaTeX and the lengths of name, note and trap (in code points)", () => {
    const sheet = miniSheet();
    const [bias, variance, pValue, ridge] = sheet.formulas;
    variance.id = "bias-def";
    delete pValue.id;
    ridge.id = "Ridge_Objective";
    ridge.concept = "lasso";
    bias.tex = "\\nope";
    variance.tex = " ";
    pValue.name = "";
    ridge.note = "𝜃".repeat(80);
    ridge.trap = "很".repeat(61);
    expect(codes(check(sheet))).toEqual([
      "formula bias-def: katex",
      "formula bias-def: duplicate-id",
      "formula bias-def: tex-missing",
      "formula #2: bad-id",
      "formula #2: missing-field",
      "formula Ridge_Objective: bad-id",
      "formula Ridge_Objective: unknown-concept",
      "formula Ridge_Objective: trap-length",
    ]);
  });

  it("wants the home ref first, few also refs, each quote on its page, and the sheet in page order", () => {
    const sheet = miniSheet();
    formulaOf(sheet, "variance-def").refs.reverse();
    formulaOf(sheet, "p-value-def").refs.push(...[1, 2, 3, 4].map(() => ref(2, 1, "also", "Hypothesis testing")));
    formulaOf(sheet, "ridge-objective").refs.push(ref(3, 1, "roadmap", "Linear"), ref(3, 9, "also", "x"), ref(5, 1, "also", "x"), "L3");
    sheet.formulas.reverse();
    expect(codes(check(sheet))).toEqual([
      "formula ridge-objective ref 1: bad-role",
      "formula ridge-objective ref 1: quote-length",
      "formula ridge-objective ref 2: ref-page",
      "formula ridge-objective ref 3: ref-lecture",
      "formula ridge-objective ref 4: bad-ref",
      "formula p-value-def: also-count",
      "formula p-value-def: order",
      "formula variance-def: home-first",
      "formula variance-def: order",
      "formula bias-def: order",
    ]);
  });

  it("allows a hand-made sheet's one-word quotes, not an app-made one's", () => {
    const sheet = miniSheet();
    sheet.formulas[2].refs[0].quote = "p-value";
    expect(codes(check(sheet))).toEqual(["formula p-value-def ref 0: quote-length"]);
    expect(check(sheet, { limits: HAND_MADE })).toEqual([]);
  });

  it("lets a course in Chinese quote its slides in Chinese", () => {
    const decks = DECKS.map((d) => (d.no === 2 ? { ...d, texts: [d.texts[0], `${d.texts[1]}\np 值的定义是概率`] } : d));
    const sheet = miniSheet();
    sheet.formulas[2].refs[0].quote = "p 值的定义是概率";
    expect(codes(check(sheet, { decks }))).toEqual(["formula p-value-def ref 0: quote-cjk"]);
    expect(check(sheet, { decks, lang: "zh" })).toEqual([]);
  });

  it("checks the top level and the lectures against the decks", () => {
    const sheet = miniSheet();
    delete sheet.generator;
    sheet.basis = { exam: "MCQ" };
    sheet.lectures[2].pages = 4;
    sheet.lectures.push({ no: 7, file: "L7.pdf", sha256: "s", pages: 1, title: "" });
    expect(codes(check(sheet))).toEqual(["top: missing-field", "top: basis", "lectures: lecture-mismatch", "lectures: unknown-lecture"]);
    delete sheet.lectures;
    expect(codes(check(sheet))).toEqual(expect.arrayContaining(["formula bias-def ref 0: ref-lecture"]));
  });

  it("reports a malformed sheet instead of throwing", () => {
    expect(codes(check(undefined))).toEqual(["top: bad-schema"]);
    expect(codes(check({ ...miniSheet(), formulas: "none" }))).toEqual(["top: not-a-list"]);
    const sheet = miniSheet();
    sheet.formulas.push(null, { id: "x" });
    sheet.formulas[0].refs = "L1 p2";
    expect(codes(check(sheet))).toEqual([
      "formula #4: bad-entry",
      "formula bias-def: home-first",
      "formula x: unknown-concept",
      "formula x: tex-missing",
      "formula x: missing-field",
      "formula x: missing-field",
      "formula x: missing-field",
      "formula x: home-first",
    ]);
  });
});
