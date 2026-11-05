// Prompts of the map's English pass (in-app generation, design §4.3 M7): the map is written in
// Chinese, then every text gets an `en` block — revision English in the slides' own terms (the words
// an exam question will use), keeping every number, condition and trap — then code checks it and one
// review corrects what reads wrong. Every call answers in the English's own form (schemas.ts
// `englishSchema`): items by id, links by their ends, tour steps by their 1-based position, as the
// checker names them too; a repair or the review holds only what it changes, which code puts in
// place (mergeEnglish.ts). The formula sheet writes its English in its own draft.
// Course-agnostic; a change to a text needs a new PROMPT_VERSION (pipeline.ts).

import { GROUNDED, MATERIAL, type Prompt } from "./structure";

export const PROMPT_VERSION = 3;

const ENGLISH_RULES = [
  "The map's prose is Chinese; the student sits the exam in English, so every text also gets an English version beside it, in an en block.",
  "- Write concise exam English with the exact terms the slides use — the words an exam question will use — not a word-for-word translation. Keep every number, formula, condition and trap of the Chinese text; formulas stay in its plain-text notation. No Chinese characters.",
  '- Concept titles are the English names the slides use. Thread and strand questions end with "?"; a concept\'s question is "".',
  "- Limits, in characters: label 60, title 70, question 160, gist 140, contrast title 70, tour step title 60, tour step text 700.",
  "- The tour reads as natural revision English for one sitting of about ten minutes, and keeps its references to lectures and pages.",
].join("\n");

const WRITER = ["You write the English version of the knowledge map of a university course, for a Chinese-speaking student revising for an exam in English.", MATERIAL, GROUNDED, ENGLISH_RULES].join("\n\n");

/**
 * M7: the en blocks of the whole map; `changed`: only the items in the changes material (an
 * update), plus the tour and the summary.
 */
export function translate(p: { changed?: boolean } = {}): Prompt {
  return {
    system: WRITER,
    instruction: [
      "Step: write the en block of every text in the map material: the top level (label, summary), every node (title, question, gist), every link (note), every contrast (title, note) and every tour step (title, text), numbered by its 1-based position in the tour: step 1 is the first. Read each concept's home page for the slides' term before writing its title.",
      ...(p.changed ? ["Only the items listed in the changes material are new or changed: write their en blocks, the tour's and the summary's, and leave every other en block as it is."] : []),
    ].join("\n"),
  };
}

/** How a repair or the review answers: the English of the items it changes, whole, for code to put in place. */
const CHANGED_ONLY =
  'Answer in the same form as the English of the whole map, but hold only the items you change, each with all its English fields: nodes by id, links by their from and to, contrasts by id, tour steps by their 1-based position (step 1 is the first); label and summary "" unless you change them. Code puts each item you give in place of its old English and keeps everything you leave out.';

/** M7: fix what code found in the English (Chinese characters, a text over its limit, a question without "?", a missing block). */
export function repair(): Prompt {
  return {
    system: WRITER,
    instruction: [
      "Step: the issues material lists problems that code found in the English of the map material, each with an id. Fix each with the smallest change to that en field; a text over its limit is shortened without losing a number, condition or trap. Change nothing the issues do not name.",
      CHANGED_ONLY,
    ].join("\n"),
  };
}

/** M7: one review of every en block against its Chinese and the slides. */
export function review(): Prompt {
  return {
    system: WRITER,
    instruction: [
      "Step: review every en block of the map material against the Chinese of the same field and the cited pages.",
      "Look for English that changes the meaning, drops a condition, number or trap, uses a word of its own where the slides have a term, contradicts the slides, or is unclear for an exam. For each real problem, give the item with its English corrected. Leave everything else out; when nothing is wrong, give no items.",
      CHANGED_ONLY,
    ].join("\n"),
  };
}
