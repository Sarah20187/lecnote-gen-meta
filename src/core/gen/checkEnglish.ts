// The English of a knowledge map or a formula sheet (in-app generation, stage M7; the exam is in
// English). The `en` half of docs/formats/check_structure.py and check_formulas.py, under the same
// `where`s (a tour step's 1-based, as in checkStructure.ts): when a file has English at all, every
// text has its `en` version, with no Chinese in it, within the format's lengths (code points). The
// app's own en gist limit (D9) comes from Limits; in an update, a frozen node's from the update's
// `frozenLimits` (checkStructure.ts): what it keeps is not held to limits it was never made for.
// A file without any `en` block passes: the format makes English optional, and a draft has none yet.

import { FORMULAS_SCHEMA } from "../formulas";
import { isRecord } from "../structure";
import { CJK, issue, LATEX, py, tourStep, truthy, type Issue, type StructureContext } from "./checkStructure";
import { formulaWhere } from "./checkFormulas";
import { TEXT, type Limits } from "./limits";
import { cpLength } from "./squash";

const records = (v: unknown): [Record<string, unknown>, number][] => (Array.isArray(v) ? v.flatMap((x, i): [Record<string, unknown>, number][] => (isRecord(x) ? [[x, i]] : [])) : []);

/** The file has English: some text of it carries an `en` block. */
function claimsEnglish(doc: Record<string, unknown>): boolean {
  const parts = [doc, ...["nodes", "links", "contrasts", "tour", "formulas"].flatMap((k) => records(doc[k]).map(([x]) => x))];
  return parts.some((x) => x.en !== undefined || records(x.formulas).some(([f]) => f.en !== undefined));
}

/** What an update keeps of a map (its frozen nodes), and the limits they are checked with (the checks' context will do). */
export type KeptEnglish = Pick<StructureContext, "frozen" | "frozenLimits">;

/** Checks the English of a parsed map or sheet (by its schema). Every issue is an error. `kept`: an update's frozen nodes, with their limits. */
export function checkEnglish(doc: unknown, limits: Limits, kept?: KeptEnglish): Issue[] {
  if (!isRecord(doc) || !claimsEnglish(doc)) return [];
  return doc.schema === FORMULAS_SCHEMA ? sheetEnglish(doc) : mapEnglish(doc, limits, kept);
}

function mapEnglish(tree: Record<string, unknown>, limits: Limits, kept?: KeptEnglish): Issue[] {
  const frozen = new Set<unknown>((kept?.frozen ?? []).map((f) => f.id));
  const out: Issue[] = [];
  const err = (where: string, code: string, message: string) => out.push(issue(where, code, message));
  /** check_structure.py's `en_of`: the block, each field a string without Chinese, within its length. */
  const enOf = (where: string, obj: Record<string, unknown>, fields: readonly string[], lengths: Readonly<Record<string, number>>) => {
    const en = obj.en;
    if (!isRecord(en)) return err(where, "en-missing", "missing en block");
    for (const f of fields) {
      const v = en[f];
      if (typeof v !== "string") {
        err(where, "en-field-missing", `en.${f} missing`);
        continue;
      }
      if (CJK.test(v)) err(where, "en-cjk", `en.${f} has Chinese: ${JSON.stringify(v.slice(0, 40))}`);
      if (Object.hasOwn(lengths, f) && cpLength(v) > lengths[f]) err(where, "en-length", `en.${f} is longer than ${lengths[f]} characters`);
    }
  };

  enOf("top", tree, ["label", "summary"], { label: TEXT.en.label });
  for (const [n] of records(tree.nodes)) {
    const w = `node ${py(n.id)}`;
    const enGist = ((frozen.has(n.id) && kept?.frozenLimits) || limits).enGist;
    enOf(w, n, ["title", "question", "gist"], { title: TEXT.en.title, question: TEXT.en.question, gist: enGist });
    const en = isRecord(n.en) ? n.en : {};
    if (n.kind !== "concept" && typeof en.question === "string" && !en.question.endsWith("?")) err(w, "en-question", "en.question must end with ?");
    if (n.kind !== "concept" && en.title === "") err(w, "en-empty", "empty en.title");
    if (typeof en.gist !== "string" || !en.gist) err(w, "en-empty", "empty en.gist");
    else if (LATEX.test(en.gist)) err(w, "gist-latex", "en.gist has LaTeX; gists are plain text");
    for (const [f, i] of records(n.formulas)) {
      if (typeof f.tex === "string" && f.tex.trim()) enOf(`${w} formula ${i}`, f, ["note"], { note: TEXT.en.nodeFormulaNote });
    }
  }
  for (const [l, i] of records(tree.links)) enOf(`link ${i} (${py(l.from)}→${py(l.to)})`, l, ["note"], {});
  for (const [c] of records(tree.contrasts)) enOf(`contrast ${py(c.id)}`, c, ["title", "note"], { title: TEXT.en.contrastTitle });
  for (const [s, i] of records(tree.tour)) enOf(tourStep(i), s, ["title", "text"], { title: TEXT.en.tourTitle, text: TEXT.en.tourText });
  return out;
}

function sheetEnglish(sheet: Record<string, unknown>): Issue[] {
  const out: Issue[] = [];
  const err = (where: string, code: string, message: string) => out.push(issue(where, code, message));
  for (const [f, i] of records(sheet.formulas)) {
    const w = formulaWhere(f, i);
    const en = f.en;
    if (!isRecord(en)) {
      err(w, "en-missing", "missing en block");
      continue;
    }
    for (const [key, limit] of Object.entries(TEXT.formula.en)) {
      const v = en[key];
      if (typeof v !== "string" || (key !== "trap" && !v)) err(w, "en-field-missing", `en.${key} missing`);
      else if (CJK.test(v)) err(w, "en-cjk", `en.${key} has Chinese: ${JSON.stringify(v.slice(0, 40))}`);
      else if (cpLength(v) > limit) err(w, "en-length", `en.${key} is longer than ${limit} characters`);
    }
    if (truthy(f.trap) !== truthy(en.trap)) err(w, "trap-pair", "trap and en.trap must both be given or both be empty");
  }
  return out;
}
