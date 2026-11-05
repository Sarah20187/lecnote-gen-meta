import { describe, expect, it } from "vitest";
import { compareEdges, type FigureEdge } from "./figures";

const e = (from: string, to: string, label = ""): FigureEdge => ({ from, to, label });

describe("two independent readings of a figure", () => {
  it("agrees when the edges are the same once squashed, whatever their order", () => {
    const a = [e("P(X)", "Y", "causes"), e("Z", "P(X)")];
    const b = [e("z", "p(x)"), e("p( X )", "y", "Causes"), e("Z", "P(X)")];
    expect(compareEdges(a, b)).toEqual({ agree: true, common: a, onlyA: [], onlyB: [], labels: [] });
    expect(compareEdges([], [])).toMatchObject({ agree: true, common: [] });
  });

  it("names edges only one reading has; direction counts", () => {
    const r = compareEdges([e("A", "B"), e("B", "C")], [e("B", "A"), e("B", "C")]);
    expect(r).toEqual({ agree: false, common: [e("B", "C")], onlyA: [e("A", "B")], onlyB: [e("B", "A")], labels: [] });
  });

  it("disagrees on labels only when both readings gave one", () => {
    const r = compareEdges([e("A", "B", "+"), e("B", "C"), e("C", "D", "0.8")], [e("A", "B", "−"), e("B", "C", "weight"), e("C", "D", "0.8")]);
    expect(r.agree).toBe(false);
    expect(r.labels).toEqual([{ a: e("A", "B", "+"), b: e("A", "B", "−") }]);
    expect(r.common).toEqual([e("B", "C", "weight"), e("C", "D", "0.8")]);
  });

  it("leaves out edges missing an end", () => {
    expect(compareEdges([e("A", " "), e("A", "B")], [e("A", "B")]).agree).toBe(true);
  });
});
