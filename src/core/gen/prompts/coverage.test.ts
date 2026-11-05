import { describe, expect, it } from "vitest";
import { buildBundle } from "../bundle";
import { mapQuestions, PROMPT_VERSION } from "./coverage";

const fnv = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.codePointAt(0)!, 16777619) >>> 0, 2166136261).toString(16);
const frozen = mapQuestions();

describe("sample-question coverage prompt (D5)", () => {
  it("is frozen: a changed text shows in the snapshot and needs a new PROMPT_VERSION", () => {
    expect(frozen).toMatchSnapshot();
    expect([PROMPT_VERSION, fnv(JSON.stringify(frozen))]).toEqual([2, "ac87d47f"]);
  });

  it("uses the questions as a test only: never core, never a trap, never their wording", () => {
    expect(frozen.system).toContain("They never decide what is core, never become a trap, and their wording never enters the map.");
    expect(frozen.instruction).toContain("Do not judge which concepts are core, and do not write traps.");
  });

  it("takes the content of a fix from the slide pages, not from the question or general knowledge", () => {
    expect(frozen.instruction).toContain("The content of a fix comes from those pages, never from the question or its answer.");
    expect(frozen.instruction).toContain("do not fill the gap from your own knowledge");
  });

  it("judges a formula question covered only when the formula is in a gist or on a cited page", () => {
    expect(frozen.instruction).toContain("that needs the formula or rule in a gist or on a cited page; a gist that only names the concept is not enough");
  });

  it("points at the exam documents as bundle.ts sends them", () => {
    const inventory = { lectures: [], exams: [], examFiles: [{ file: "sample.pdf", sha256: "e1", pages: [{ page: 4, text: "Question 1", image: null, figure: false }] }], note: "" };
    const sent = buildBundle(inventory, {}, { marker: "m-0123456789abcdef", images: false, examFiles: true })
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("");
    expect(sent).toContain("exam=1 part=file>");
    expect(sent).toContain("exam=1 page=4 part=text>");
    expect(frozen.instruction).toContain("each document's name in a part=file tag, then its pages, tagged exam=<n> page=<p>");
    expect(frozen.instruction).not.toContain("questions material");
  });
});
