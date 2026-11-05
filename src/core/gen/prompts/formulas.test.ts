import { describe, expect, it } from "vitest";
import { TEXT } from "../limits";
import { apply, diffCheck, draft, PROMPT_VERSION, repair, review, verify } from "./formulas";
import { FINDINGS, LENGTHS, OPS, SAMPLE_QUESTIONS, type Prompt } from "./structure";

const fnv = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.codePointAt(0)!, 16777619) >>> 0, 2166136261).toString(16);
const SAMPLES: Record<string, Prompt> = {
  draft: draft({ lectures: [5, 6, 7, 8] }),
  repair: repair(),
  review: review({ lectures: [5, 6] }),
  verify: verify(),
  apply: apply(),
  diffCheck: diffCheck(),
};
const frozen = { systems: [...new Set(Object.values(SAMPLES).map((p) => p.system))], instructions: Object.fromEntries(Object.entries(SAMPLES).map(([k, p]) => [k, p.instruction])) };

describe("formula-sheet prompts", () => {
  it("are frozen: a changed text shows in the snapshot and needs a new PROMPT_VERSION", () => {
    expect(frozen).toMatchSnapshot();
    expect([PROMPT_VERSION, fnv(JSON.stringify(frozen))]).toEqual([3, "807fcb89"]);
  });

  it("draft one lecture range against the map's concept ids, and review a pair of lectures", () => {
    expect(SAMPLES.draft.instruction).toContain("for lectures L5–L8 only");
    expect(SAMPLES.draft.instruction).toContain("The concepts material is the map: use its ids.");
    expect(SAMPLES.review.instruction).toContain("home page is in lectures L5–L6");
  });

  it("take traps from the slides, never from sample questions (D5)", () => {
    for (const p of Object.values(SAMPLES)) {
      expect(p.system).toContain("It comes from the slides, never from sample exam questions.");
      expect(p.system).toContain(SAMPLE_QUESTIONS);
    }
  });

  it("read formulas from the page readings, not from the garbled text layer", () => {
    expect(SAMPLES.draft.system).toContain("take the formula from the page's reading");
  });

  it("state the lengths code checks, counted the way code counts them", () => {
    const F = TEXT.formula;
    for (const s of new Set(Object.values(SAMPLES).map((p) => p.system))) {
      expect(s).toContain(LENGTHS);
      expect(s).not.toMatch(/\d+ Chinese characters/);
      expect(s).toContain(`- name: what the formula is, at most ${F.name} characters.`);
      expect(s).toContain(`and the condition under which the formula holds, at most ${F.note} characters.`);
      expect(s).toContain(`the condition dropped — at most ${F.trap} characters;`);
      expect(s).toContain(`name (at most ${F.en.name} characters), note (at most ${F.en.note}) and trap (at most ${F.en.trap})`);
    }
  });

  it("verify a missing formula by whether the slides state it, not by the current entry", () => {
    expect(SAMPLES.verify.system).toContain(
      "A finding that something is missing is real when the cited pages teach it, the sheet has it nowhere under any name, and the proposed item is itself correct per those pages and keeps the rules.",
    );
  });

  it("give a formula added by apply its English in the same group, and let the repair write English the checks miss", () => {
    expect(SAMPLES.apply.instruction).toContain("give it its English in the same group — addFormula, then setFormulaField en.name, en.note and en.trap");
    expect(SAMPLES.repair.instruction).toContain("English that is missing, has Chinese characters or is too long — write it (setFormulaField en.name, en.note, en.trap)");
  });

  it("have writers answer in grouped patch operations and reviewers with checkable evidence", () => {
    for (const p of [SAMPLES.repair, SAMPLES.apply]) expect(p.system).toContain(OPS);
    expect(SAMPLES.review.system).toContain(FINDINGS);
  });
});
