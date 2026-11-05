import { describe, expect, it } from "vitest";
import { appLimits, countRule, formulaTargets, HAND_MADE, structureTargets } from "./limits";

describe("how big a map may be", () => {
  it("gives the reference course's course check_structure.py's numbers", () => {
    expect(structureTargets(426, 12)).toEqual({
      threads: [3, 6],
      strandsPerThread: [2, 5],
      conceptsPerStrand: [2, 7],
      concepts: [55, 85],
      coreShare: 0.25,
      links: [10, 30],
      contrasts: [6, 12],
      contrastMembers: [2, 6],
      tour: [8, 14],
    });
    expect(HAND_MADE.targets).toEqual(structureTargets(426, 12));
    expect(formulaTargets(426, 12)).toEqual({ formulas: [40, 70] });
  });

  it("scales the counts with a course's pages and lectures, never below the smallest tree", () => {
    const half = structureTargets(213, 6);
    expect([half.concepts, half.links, half.contrasts]).toEqual([[28, 43], [5, 15], [3, 6]]);
    expect(structureTargets(852, 24).concepts).toEqual([110, 170]);
    const tiny = structureTargets(12, 3);
    expect([tiny.concepts, tiny.links, tiny.contrasts]).toEqual([[12, 24], [1, 4], [1, 2]]);
    expect([tiny.threads, tiny.tour]).toEqual([[3, 6], [8, 14]]);
    expect(formulaTargets(12, 3)).toEqual({ formulas: [6, 10] });
  });

  it("holds an app-made file to the user's limits and a hand-made one to the checkers'", () => {
    expect(appLimits(426, 12)).toEqual({ appMade: true, gist: 60, enGist: 140, quoteWords: [2, 12], targets: structureTargets(426, 12) });
    expect([HAND_MADE.appMade, HAND_MADE.gist, HAND_MADE.enGist, HAND_MADE.quoteWords]).toEqual([false, 90, 180, [1, 14]]);
  });

  it("makes counts errors in a new map and warnings in an update", () => {
    expect(countRule("full")).toBe("error");
    expect(countRule("patch")).toBe("warning");
  });
});
