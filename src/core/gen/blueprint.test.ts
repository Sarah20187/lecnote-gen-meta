import { describe, expect, it } from "vitest";
import { STRUCTURE_SCHEMA, type CourseStructure } from "../structure";
import { blueprintDepartures, checkBlueprint, previousConcepts, type BlueprintContext } from "./blueprint";
import type { Deck } from "./checkStructure";
import { appLimits } from "./limits";
import { blueprintSchema, misfits, type BlueprintAnswer, type DraftAnswer } from "./schemas";

const DECKS: Deck[] = [1, 2, 3].map((no) => ({ no, file: `L${no}.pdf`, sha256: `s${no}`, pages: 5, title: `L${no}`, texts: ["", "", "", "", ""] }));
const CTX: BlueprintContext = { decks: DECKS, roadmapPages: [{ lecture: 1, page: 1 }, { lecture: 3, page: 1 }], targets: appLimits(15, 3).targets };
const NONE = { lecture: 0, page: 0 };

/** Three threads of two strands of two concepts, a concept per page from L1 p2 on, and an eight-step tour. */
function plan(): BlueprintAnswer {
  const threads = (["A", "B", "C"] as const).map((id, i) => ({ id, title: id, question: `${id}？`, origin: i === 1 ? ("ai" as const) : ("teacher" as const), anchorRef: i === 1 ? NONE : { lecture: i + 1, page: 1 } }));
  const strands = threads.flatMap((t) => [1, 2].map((k) => ({ id: `${t.id}${k}`, parent: t.id, title: `${t.id}${k}`, question: "？", origin: "ai" as const, anchorRef: NONE })));
  const concepts = strands.flatMap((s, i) => [0, 1].map((k) => ({ id: `idea-${2 * i + k + 1}`, parent: s.id, term: "t", homeLecture: Math.floor((2 * i + k) / 4) + 1, homePage: ((2 * i + k) % 4) + 2 })));
  return { threads, strands, concepts, tour: ["", "A", "A1", "B", "B2", "C", "idea-3", ""].map((node) => ({ node, title: "步" })) };
}

describe("the blueprint, checked before the draft is written from it (design M2a)", () => {
  it("passes a plan within the course's targets, every branch on its parent and every home on a page", () => {
    expect(misfits(blueprintSchema, plan())).toEqual([]);
    expect(checkBlueprint(plan(), CTX)).toEqual([]);
  });

  it("names a home past the deck's end, a taken id, a teacher thread without its structure page, and counts off target", () => {
    const p = plan();
    p.concepts[0].homePage = 40; // L1 has 5 pages
    p.concepts[1].id = "idea-1";
    p.concepts[2].id = "MLE Estimator";
    p.threads[0].anchorRef = NONE;
    p.threads[2].anchorRef = { lecture: 3, page: 4 }; // not a page that states structure
    p.strands[1].anchorRef = { lecture: 9, page: 1 };
    p.strands[5].parent = "idea-4";
    p.tour[6].node = "idea-99";
    p.tour = p.tour.slice(0, 7);
    expect(checkBlueprint(p, CTX).map((i) => `${i.where}: ${i.code}`)).toEqual([
      "concept idea-1: duplicate-id",
      "concept MLE Estimator: bad-id",
      "thread A: roadmap-missing",
      "thread C: roadmap-page",
      "strand A2: anchor-page",
      "strand C2: bad-parent",
      "concept idea-1: home-page",
      "tour step 7: unknown-node",
      "sizes: count-strands",
      "sizes: count-tour",
    ]);
  });

  it("gives 重新生成 the earlier map's concepts with their homes, and reports where a draft departs from its plan", () => {
    const map = {
      schema: STRUCTURE_SCHEMA,
      nodes: [
        { id: "S", parent: null, kind: "strand", title: "S", term: "", question: "", gist: "", core: false, origin: "ai", refs: [] },
        { id: "bias", parent: "S", kind: "concept", title: "偏差", term: "bias", question: "", gist: "", core: false, origin: "teacher", refs: [{ lecture: 1, page: 2, role: "home", quote: "Bias" }] },
      ],
    } as unknown as CourseStructure;
    expect(previousConcepts(map)).toEqual([{ id: "bias", term: "bias", title: "偏差", home: { lecture: 1, page: 2 } }]);

    const p = plan();
    const concept = (id: string, parent: string, lecture: number, page: number): DraftAnswer["nodes"][number] => ({ id, parent, kind: "concept", origin: "ai", title: id, term: "t", question: "", gist: "g", core: false, coreWhy: { kind: "none", ref: { lecture: 0, page: 0, quote: "" } }, refs: [{ lecture, page, role: "home", quote: "q" }] });
    const draft = { nodes: p.concepts.map((c) => concept(c.id, c.parent, c.homeLecture, c.homePage)) } as DraftAnswer;
    expect(blueprintDepartures(p, draft)).toEqual([]);
    draft.nodes = draft.nodes.filter((n) => n.id !== "idea-2");
    draft.nodes[0] = concept("idea-1", "A2", 1, 3);
    draft.nodes.push(concept("idea-13", "C2", 3, 5));
    expect(blueprintDepartures(p, draft)).toEqual(["concept idea-1: planned under A1, drafted under A2", "concept idea-1: planned at L1 p2, drafted at L1 p3", "concept idea-2: planned, not drafted", "concept idea-13: drafted, not planned"]);
  });
});
