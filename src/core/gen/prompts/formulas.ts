// Prompts of the formula-sheet stages (in-app generation, design §4.4, as the user's decisions of
// 2026-10-27 amend it): drafts per lecture range against the map's concept ids, review per pair of
// lectures, verify, repair. Formulas come from the page readings, which were made from the pictures
// where the text layer garbles maths; a trap is the mistake the slide's own content invites, never
// one taken from sample exam questions. Course-agnostic; a change to a text needs a new
// PROMPT_VERSION (pipeline.ts reruns the stages built with the old one).

import { FINDINGS, GROUNDED, LENGTHS, MATERIAL, OPS, ranges, REFS, SAMPLE_QUESTIONS, verifier, WRITING, type Prompt } from "./structure";

export const PROMPT_VERSION = 3;

const SHEET_RULES = [
  "The formula sheet (lecnote-formulas/1) is review material beside the knowledge map: every entry belongs to one map concept and cites slide pages the way the map does.",
  LENGTHS,
  "- id: a short English kebab-case slug, unique. concept: the id of the map concept the formula belongs to, from the concepts material — choose by the concept's title, term and gist; several formulas may share one concept.",
  "- name: what the formula is, at most 24 characters.",
  "- tex: KaTeX-renderable LaTeX in the slides' notation and letters, exactly as the slide states it. The text layer garbles maths: take the formula from the page's reading, which was made from the page's picture, and use the text only to confirm it. No align environments, \\\\ only where unavoidable, one formula per entry. A formula derived on the slides in one shown step is fine; nothing beyond what the slides show.",
  "- note: every symbol and the condition under which the formula holds, at most 80 characters.",
  '- trap: the mistake an exam question could test that the slide\'s own content invites — a reversed inequality, the inverse instead of the matrix, the letter or index that changes, a sum for a product, the condition dropped — at most 60 characters; "" when there is none. It comes from the slides, never from sample exam questions.',
  "- refs: the home ref first (role home: the page that states the formula), then at most 3 also refs (pages that use it again).",
  "- en: name (at most 70 characters), note (at most 180) and trap (at most 140) in concise exam English with the slides' own terms, keeping every symbol and condition; trap and en.trap are both filled or both empty; no Chinese characters in en.",
  "- Cover every formula an exam could ask about: definitions, estimators, criteria, update rules, model equations, objectives and constraints, rules of thumb with a number. Leave out notation reminders that carry no content.",
].join("\n");

const WRITER = ["You write the formula sheet of a university course from its lecture slides, for exam revision.", MATERIAL, WRITING, GROUNDED, REFS, SAMPLE_QUESTIONS, SHEET_RULES].join("\n\n");
const REVIEWER = ["You review the formula sheet of a university course against its lecture slides. You change nothing: you report problems.", MATERIAL, WRITING, GROUNDED, REFS, SAMPLE_QUESTIONS, SHEET_RULES, FINDINGS].join("\n\n");
const VERIFIER = [verifier("a course's formula sheet", "the sheet"), MATERIAL, GROUNDED, SAMPLE_QUESTIONS, SHEET_RULES].join("\n\n");
const DIFF_CHECKER = ["You check edits that another step made to a course's formula sheet. You change nothing.", MATERIAL, WRITING, GROUNDED, SAMPLE_QUESTIONS, SHEET_RULES].join("\n\n");

/** F2: the entries of one lecture range, against the map's concepts. */
export function draft(p: { lectures: readonly number[] }): Prompt {
  return {
    system: WRITER,
    instruction: [
      `Step: draft the sheet's entries for lectures ${ranges(p.lectures, "L")} only. Go through every page of these lectures: wherever a page states a formula, equation, estimator, criterion, update rule, model equation, objective or numeric rule, write an entry. The concepts material is the map: use its ids.`,
      "Order the entries by their home page. When a later page states the same formula again, keep the first as home and cite the later page as an also ref.",
    ].join("\n"),
  };
}

/** F3: fix what code found (KaTeX, quotes, lengths, concept ids, duplicates), as patch operations. */
export function repair(): Prompt {
  return {
    system: [WRITER, OPS].join("\n\n"),
    instruction: [
      "Step: the issues material lists problems that code found in the sheet material, each with an id. Fix each with the smallest change that settles it: a tex that does not render — rewrite it in the slide's notation so KaTeX renders it; a quote that is not on its page — copy one from that page's text; a text that is too long — shorten it and keep its symbols and condition; a concept the map does not have — the map concept the formula belongs to; a near-duplicate — when it is the same formula stated again, keep the first entry and cite the later page as an also ref, while different formulas of one concept stay apart; English that is missing, has Chinese characters or is too long — write it (setFormulaField en.name, en.note, en.trap).",
      "Change nothing the issues do not name. When an issue cannot be fixed from the slides, leave it: code then drops the entry.",
    ].join("\n"),
  };
}

/** F4: review the entries homed in a pair of lectures, and list the formulas the sheet misses there. */
export function review(p: { lectures: readonly number[] }): Prompt {
  return {
    system: REVIEWER,
    instruction: [
      `Step: review the entries of the sheet material whose home page is in lectures ${ranges(p.lectures, "L")}.`,
      "For every such entry: compare its tex symbol by symbol with the page's reading and text — signs, indices, inverse or not, sums or products, conditioning bars, 1/n factors, the letters; check that the note names every symbol and the right condition, that the trap is real and true per the slide, that the concept is the right map concept, and that the English keeps every condition and uses the slides' terms.",
      "Then go through every page of these lectures once more and list the formulas the sheet misses, each with the full new entry as its fix.",
    ].join("\n"),
  };
}

/** F5: verify at most three findings. */
export function verify(): Prompt {
  return {
    system: VERIFIER,
    instruction: "Step: the findings material holds at most three findings about the sheet material, each with an id. For each, read its cited pages and the sheet's current entry, and decide whether it is real.",
  };
}

/** F5: carry out verified findings as patch operations; reject those the slides do not support. */
export function apply(): Prompt {
  return {
    system: [WRITER, OPS].join("\n\n"),
    instruction: [
      "Step: carry out the verified findings in the findings material as patch operations on the sheet material.",
      "Findings can still be wrong: re-read each finding's cited page before acting. Apply it when the slide supports it; otherwise reject it with the reason. Its fix is a proposal: word the change correctly and concisely where it is off. A missing formula's fix is a full new entry: check it against its page before adding it, and give it its English in the same group — addFormula, then setFormulaField en.name, en.note and en.trap (en.trap empty when trap is).",
      "Change only what the findings name, and never delete a symbol, condition or ref a finding did not question. Keep ids stable.",
    ].join("\n"),
  };
}

/** F5: judge the edits of each finding as a group; a rejected group is reverted. */
export function diffCheck(): Prompt {
  return {
    system: DIFF_CHECKER,
    instruction:
      "Step: the changes material lists the edits another step just made to the sheet material, grouped by the finding each carries out, with the old and the new entry. For each group read the cited slide pages and decide whether the new entry is correct per the slides — tex symbol by symbol, note, trap, English — and left the rest intact. Answer for every group: ok or not, and why.",
  };
}
