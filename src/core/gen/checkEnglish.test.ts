import { describe, expect, it } from "vitest";
import { checkEnglish } from "./checkEnglish";
import type { Issue } from "./checkStructure";
import { appLimits, HAND_MADE } from "./limits";

const APP = appLimits(12, 3);
const codes = (issues: Issue[]) => issues.map((i) => `${i.where}: ${i.code}`);

/** A small map with an English version of every text. */
function map(): Record<string, any> {
  const node = (id: string, parent: string | null, kind: string, en: object) => ({ id, parent, kind, title: id, question: kind === "concept" ? "" : "什么？", gist: "要点。", en });
  return {
    schema: "lecnote-structure/1",
    en: { label: "By question", summary: "Estimation and testing." },
    nodes: [
      node("T1", null, "thread", { title: "Estimation", question: "How do we estimate?", gist: "Bias and variance." }),
      node("T1a", "T1", "strand", { title: "Spread", question: "How far off is it?", gist: "Variance." }),
      node("variance", "T1a", "concept", { title: "Variance", question: "", gist: "The spread of an estimator." }),
    ],
    links: [{ from: "variance", to: "T1a", en: { note: "Uses it." } }],
    contrasts: [{ id: "spread", en: { title: "Spread", note: "Bias against variance." } }],
    tour: [{ node: null, en: { title: "Start", text: "Read the threads." } }],
  };
}

function sheet(): Record<string, any> {
  return {
    schema: "lecnote-formulas/1",
    formulas: [
      { id: "bias-def", trap: "", en: { name: "Bias", note: "θ̂: the estimator", trap: "" } },
      { id: "ridge", trap: "λ=0 时就是最小二乘", en: { name: "Ridge", note: "λ: the penalty", trap: "With λ = 0 it is least squares" } },
    ],
  };
}

describe("checking the English of a map", () => {
  it("passes a map with English everywhere, and one without any", () => {
    expect(checkEnglish(map(), APP)).toEqual([]);
    const zh = map();
    for (const x of [zh, ...zh.nodes, ...zh.links, ...zh.contrasts, ...zh.tour]) delete x.en;
    expect(checkEnglish(zh, APP)).toEqual([]);
  });

  it("wants every text in English once the map has some, where check_structure.py names it", () => {
    const tree = map();
    delete tree.en;
    delete tree.nodes[2].en;
    delete tree.links[0].en;
    tree.contrasts[0].en = { title: "Spread" };
    tree.tour[0].en.text = 3;
    expect(codes(checkEnglish(tree, APP))).toEqual([
      "top: en-missing",
      "node variance: en-missing",
      "node variance: en-empty",
      "link 0 (variance→T1a): en-missing",
      "contrast spread: en-field-missing",
      "tour step 1: en-field-missing",
    ]);
  });

  it("allows no Chinese, ends branch questions with ?, and keeps the lengths (code points; the app's gist ≤ 140)", () => {
    const tree = map();
    tree.nodes[0].en.question = "How do we estimate";
    tree.nodes[1].en.title = "";
    tree.nodes[1].en.gist = "方差";
    tree.nodes[2].en.gist = "x".repeat(141);
    tree.en.label = "𝜃".repeat(60);
    tree.tour[0].en.title = "x".repeat(61);
    expect(codes(checkEnglish(tree, APP))).toEqual(["node T1: en-question", "node T1a: en-cjk", "node T1a: en-empty", "node variance: en-length", "tour step 1: en-length"]);
    expect(codes(checkEnglish(tree, HAND_MADE))).not.toContain("node variance: en-length");
  });

  it("wants plain text in an English gist and checks the English of a concept's formulas", () => {
    const tree = map();
    tree.nodes[2].en.gist = "Minimises $\\|w\\|^2$.";
    tree.nodes[2].formulas = [{ tex: "x^2", note: "平方", en: { note: "square" } }, { tex: "y", note: "y" }, { tex: "" }];
    expect(codes(checkEnglish(tree, APP))).toEqual(["node variance: gist-latex", "node variance formula 1: en-missing"]);
  });
});

describe("checking the English of a formula sheet", () => {
  it("passes a sheet with English, and one without", () => {
    expect(checkEnglish(sheet(), HAND_MADE)).toEqual([]);
    const zh = sheet();
    for (const f of zh.formulas) delete f.en;
    expect(checkEnglish(zh, HAND_MADE)).toEqual([]);
  });

  it("wants name and note, no Chinese, the lengths, and a trap in both languages or neither", () => {
    const s = sheet();
    s.formulas.push({ trap: "", en: { name: "", note: "中文" + "x".repeat(200) } }, { id: "z", trap: "" });
    s.formulas[1].en.trap = "";
    s.formulas[0].en.note = "x".repeat(181);
    expect(codes(checkEnglish(s, HAND_MADE))).toEqual([
      "formula bias-def: en-length",
      "formula ridge: trap-pair",
      "formula #2: en-field-missing",
      "formula #2: en-cjk",
      "formula #2: en-field-missing",
      "formula z: en-missing",
    ]);
  });
});
