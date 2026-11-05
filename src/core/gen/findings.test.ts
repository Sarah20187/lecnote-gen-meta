import { describe, expect, it } from "vitest";
import { FORMULAS_SCHEMA, type FormulaSheet } from "../formulas";
import { STRUCTURE_SCHEMA, type CourseStructure } from "../structure";
import type { Deck } from "./checkStructure";
import { checkEvidence, dropImageRefs, imageRefFindings, keyFindings, realFindings, verifyBatches } from "./findings";
import { findingsSchema, misfits, type Finding } from "./schemas";

const DECKS: Deck[] = [
  { no: 1, file: "L1.pdf", sha256: "s1", pages: 2, title: "L1", texts: ["Estimation", "Bias of an estimator\nThe bias is the expected error"], seen: ["", ""] },
  { no: 2, file: "L2.pdf", sha256: "s2", pages: 2, title: "L2", texts: ["Testing", ""], seen: ["", "power rises with the sample size"] },
];
const finding = (id: string, evidence: Finding["evidence"]): Finding => ({ id, severity: "must", where: ["bias"], field: "gist", problem: "p", evidence, fix: "f" });
const ev = (lecture: number, page: number, quote: string) => ({ lecture, page, quote });

describe("findings between review, verify and apply", () => {
  const findings = [
    finding("f1", [ev(1, 2, "the expected error")]),
    finding("f2", [ev(2, 2, "power rises")]),
    finding("f3", [ev(2, 1, "")]),
    finding("f4", [ev(1, 2, "the expected error"), ev(1, 2, "unbiased by definition")]),
    finding("f5", [ev(3, 1, "Testing")]),
    finding("f6", []),
  ];

  it("fit the findings schema", () => {
    expect(misfits(findingsSchema, { findings })).toEqual([]);
  });

  it("drop a finding whose evidence is not where it says, keeping quotes seen on an image", () => {
    const { kept, dropped } = checkEvidence(findings, DECKS);
    expect(kept.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(dropped.map((d) => `${d.finding.id}: ${d.why}`)).toEqual([
      // No later stage sees a picture (D3): evidence without words of its page checks nothing.
      "f3: L2 p1 is cited without words of the page",
      "f4: the quote is not on L1 p2",
      "f5: L3 p1 is no page of the course",
      "f6: it cites no page",
    ]);
    expect(checkEvidence([finding("short", [ev(1, 1, "Est")])], DECKS).dropped.map((d) => d.why)).toEqual(["L1 p1 is cited without words of the page"]);
  });

  it("name each review call's findings themselves, as every call numbers its own from 1", () => {
    // Two lenses both answer F1; the verifier then answers each by the id code gave it.
    const faithful = keyFindings("lenses", 1, [finding("F1", [ev(1, 2, "the expected error")])]);
    const structure = keyFindings("lenses", 2, [finding("F1", [ev(1, 2, "Bias of an estimator")]), finding("F2", [ev(1, 1, "Estimation")])]);
    const all = [...faithful, ...structure];
    expect(all.map((f) => f.id)).toEqual(["lenses-1-1", "lenses-2-1", "lenses-2-2"]);
    expect(misfits(findingsSchema, { findings: all })).toEqual([]);
    const { real, unanswered } = realFindings(all, [
      { id: "lenses-1-1", real: true },
      { id: "lenses-2-1", real: false },
      { id: "lenses-2-2", real: false },
    ]);
    expect([real.map((f) => f.evidence[0].quote), unanswered]).toEqual([["the expected error"], []]);
  });

  it("verify at most three to a call, in the order of their pages", () => {
    const more = [finding("a", [ev(2, 1, "Testing")]), finding("b", [ev(1, 1, "Estimation")]), finding("c", []), finding("d", [ev(1, 2, "Bias")]), finding("e", [ev(1, 1, "Estimation")])];
    expect(verifyBatches(more).map((b) => b.map((f) => f.id))).toEqual([["b", "e", "d"], ["a", "c"]]);
    expect(verifyBatches([])).toEqual([]);
  });

  it("pass on only what the verifier judged real, and name what it left unanswered", () => {
    const { real, unanswered } = realFindings(findings.slice(0, 3), [
      { id: "f1", real: true },
      { id: "f2", real: false },
      { id: "made-up", real: true },
    ]);
    expect(real.map((f) => f.id)).toEqual(["f1"]);
    expect(unanswered).toEqual(["f3"]);
  });

  it("send the refs found only on a page's picture to the verifier, and drop those it finds wrong", () => {
    const ref = (lecture: number, page: number, quote: string, checked?: "image") => ({ lecture, page, role: "also" as const, quote, ...(checked ? { checked } : {}) });
    const node = (id: string, refs: CourseStructure["nodes"][number]["refs"]) => ({ id, parent: "S", kind: "concept" as const, title: id, term: id, question: "", gist: "g", core: false, origin: "ai" as const, refs });
    const map: CourseStructure = {
      schema: STRUCTURE_SCHEMA, id: "A", course: "c", label: "l", lang: "zh", createdAt: "", generator: { by: "ai" }, lectures: [], summary: "", tour: [], contrasts: [],
      nodes: [node("bias", [{ ...ref(1, 2, "Bias of an estimator"), role: "home" }]), node("power", [{ ...ref(2, 2, "power rises", "image"), role: "home" }])],
      links: [{ from: "bias", to: "power", type: "builds-on", note: "n", origin: "ai", refs: [ref(1, 2, "the expected error"), ref(2, 2, "with the sample size", "image")] }],
    };
    const found = imageRefFindings(map);
    expect(found.map((f) => [f.id, f.where, f.evidence])).toEqual([
      ["image-1", ["power"], [ev(2, 2, "power rises")]],
      ["image-2", ["bias", "power"], [ev(2, 2, "with the sample size")]],
    ]);
    expect(misfits(findingsSchema, { findings: found })).toEqual([]);
    // The verifier reads the page's reading: what it saw there is evidence that checks.
    expect(checkEvidence(found, DECKS).kept).toHaveLength(2);
    // It finds the link's ref wrong: that ref goes, and a lens finding judged real is left to apply.
    const dropped = dropImageRefs(map, [found[1], finding("lenses-1-1", [ev(1, 2, "the expected error")])]);
    expect(dropped.changes).toEqual(["the link bias→power: the ref to L2 p2 dropped, the page does not show it"]);
    expect(dropped.doc.links[0].refs).toEqual([ref(1, 2, "the expected error")]);
    expect(dropped.doc.nodes).toEqual(map.nodes);
    expect(map.links[0].refs).toHaveLength(2);

    const sheet: FormulaSheet = {
      schema: FORMULAS_SCHEMA, course: "c", createdAt: "", generator: { by: "ai" }, basis: { exam: "", note: "" }, lectures: [],
      formulas: [{ id: "power", concept: "power", name: "功效", tex: "1-\\beta", note: "n", trap: "", refs: [{ ...ref(2, 2, "power rises", "image"), role: "home" }] }],
    };
    const [f] = imageRefFindings(sheet);
    expect([f.where, f.problem]).toEqual([["power"], "formula power (功效) cites L2 p2 by words the page reader saw on its picture, not in its text: the page may not show it"]);
    expect(dropImageRefs(sheet, [f]).doc.formulas[0].refs).toEqual([]);
  });
});
