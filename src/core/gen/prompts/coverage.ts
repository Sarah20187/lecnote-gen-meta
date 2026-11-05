// Prompt of the sample-question coverage test (decision D5: 样题 are a test of coverage only). One
// call maps each sample question to the map concepts it needs; code checks the ids and the pages;
// a question the map does not cover becomes a finding whose content comes from the slide pages that
// teach it, never from the question. The questions never set core or traps — only this stage gets
// them as material. Course-agnostic; a change to the text needs a new PROMPT_VERSION (pipeline.ts).

import { GROUNDED, MATERIAL, REFS, WRITING, type Prompt } from "./structure";

export const PROMPT_VERSION = 2;

const SYSTEM = [
  "You test whether the knowledge map of a university course covers the course's sample exam questions. The questions are a test only: they show where the map may lack something the slides teach. They never decide what is core, never become a trap, and their wording never enters the map.",
  MATERIAL,
  WRITING,
  GROUNDED,
  REFS,
].join("\n\n");

/** Map every sample question to the concepts it needs; for a gap, what the slides teach and where. */
export function mapQuestions(): Prompt {
  return {
    system: SYSTEM,
    instruction: [
      "Step: the exam documents hold the sample exam questions: each document's name in a part=file tag, then its pages, tagged exam=<n> page=<p>. The map material is the map. For each question, give where it starts (its exam and page), its label as the document writes it and its first words copied from that page, then:",
      "1. Find the slide pages that teach what it needs.",
      "2. Name the map concepts that cover it, by id.",
      "3. Judge strictly whether a student revising only from those concepts — title, term, gist and cited pages — could answer it. For a formula or calculation question that needs the formula or rule in a gist or on a cited page; a gist that only names the concept is not enough.",
      "4. For each thing the question needs that those concepts do not give, a missing entry: what is needed, what the slides teach about it, and the pages that teach it, each with a verbatim quote. The content of a fix comes from those pages, never from the question or its answer. When the slides do not teach it at all, say so with no pages: do not fill the gap from your own knowledge.",
      "Do not judge which concepts are core, and do not write traps.",
    ].join("\n"),
  };
}
