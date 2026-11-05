// Between a review and its verify stage, and between verify and apply (in-app generation, design
// §4.3 M4–M6, §4.4 F4–F5): code names each review call's findings itself, since every call numbers
// its own from 1; drops a finding whose evidence is not where it says (a quote not on its page, a
// page that does not exist, no evidence at all); sends the rest to the sceptical verifier at most
// three to a call, those on one page together, and passes on only what it judged real. Every piece
// of evidence quotes its page — its text, or for a picture what the reader transcribed from it,
// which is all a later stage reads of it (D3). The refs autofix found only on a picture go to the
// verifier too, as findings code makes.

import type { FormulaSheet } from "../formulas";
import { STRUCTURE_SCHEMA, type CourseStructure, type PageRef } from "../structure";
import { pageText, type Deck } from "./checkStructure";
import { TEXT } from "./limits";
import type { Evidence, Finding } from "./schemas";
import { cpLength, quoteOnPage, squash } from "./squash";

/**
 * A review call's findings under ids code chose, `<stage>-<call>-<n>` (`call` and `n` 1-based), as
 * the coverage test names its own (`coverage-<q>-<g>`): verdicts and the apply step's groups go by
 * these ids, and the ids a model writes repeat from call to call.
 */
export function keyFindings(stage: string, call: number, findings: readonly Finding[]): Finding[] {
  return findings.map((f, i) => ({ ...f, id: `${stage}-${call}-${i + 1}` }));
}

/** Why `L<lecture> p<page>` is no page of the course's decks, or null when it is one. */
export function pageProblem(lecture: number, page: number, decks: ReadonlyMap<number, Deck>): string | null {
  const d = decks.get(lecture);
  return !d || !Number.isInteger(page) || page < 1 || page > d.pages ? `L${lecture} p${page} is no page of the course` : null;
}

/** Why a piece of evidence does not check — no such page, no quote, or its quote neither in the page's text nor in what was seen on its picture — or null when it does. */
export function evidenceProblem(e: Evidence, decks: ReadonlyMap<number, Deck>): string | null {
  const page = pageProblem(e.lecture, e.page, decks);
  if (page) return page;
  if (cpLength(squash(e.quote)) < TEXT.quoteChars) return `L${e.lecture} p${e.page} is cited without words of the page`;
  const d = decks.get(e.lecture)!;
  if (!quoteOnPage(pageText(d, e.page), e.quote) && !quoteOnPage(pageText(d, e.page, "image"), e.quote)) return `the quote is not on L${e.lecture} p${e.page}`;
  return null;
}

/** Findings whose evidence checks (`kept`) and the others, with why (`dropped`), for the run's report. */
export function checkEvidence(findings: readonly Finding[], decks: readonly Deck[]): { kept: Finding[]; dropped: { finding: Finding; why: string }[] } {
  const byNo = new Map(decks.map((d) => [d.no, d]));
  const kept: Finding[] = [];
  const dropped: { finding: Finding; why: string }[] = [];
  for (const f of findings) {
    const why = f.evidence.length ? f.evidence.map((e) => evidenceProblem(e, byNo)).find((p) => p !== null) : "it cites no page";
    if (why) dropped.push({ finding: f, why });
    else kept.push(f);
  }
  return { kept, dropped };
}

/** The verify calls (design §4.3 M5): at most `size` findings each, in the order of the page their first evidence cites, so the pages a call reads are few. */
export function verifyBatches(findings: readonly Finding[], size = 3): Finding[][] {
  const at = (f: Finding) => (f.evidence[0] ? f.evidence[0].lecture * 100_000 + f.evidence[0].page : Infinity);
  const sorted = [...findings].sort((a, b) => at(a) - at(b));
  return Array.from({ length: Math.ceil(sorted.length / size) }, (_, i) => sorted.slice(i * size, (i + 1) * size));
}

/** The findings the verifier judged real, which apply carries out; `unanswered`: ids it gave no verdict for (its call is asked again). */
export function realFindings(findings: readonly Finding[], verdicts: readonly { id: string; real: boolean }[]): { real: Finding[]; unanswered: string[] } {
  const said = new Map(verdicts.map((v) => [v.id, v.real]));
  return { real: findings.filter((f) => said.get(f.id) === true), unanswered: findings.filter((f) => !said.has(f.id)).map((f) => f.id) };
}

/** The ids of the findings `imageRefFindings` makes: `image-<n>`. */
export const IMAGE_FINDING = "image-";

type RefHolder = { what: string; where: string[]; refs: PageRef[] };

/** What holds refs in a map (nodes by id, links by their two ends) or a sheet (formulas by id), as a finding names it. */
function refHolders(doc: CourseStructure | FormulaSheet): RefHolder[] {
  if (doc.schema !== STRUCTURE_SCHEMA) return doc.formulas.map((f) => ({ what: `formula ${f.id} (${f.name})`, where: [f.id], refs: f.refs }));
  return [
    ...doc.nodes.map((n) => ({ what: `node ${n.id} (${n.title})`, where: [n.id], refs: n.refs })),
    ...doc.links.map((l) => ({ what: `the link ${l.from}→${l.to}`, where: [l.from, l.to], refs: l.refs })),
  ];
}

/**
 * The refs autofix marked `checked: "image"` — a quote the reader saw on the page's picture, not in
 * its text — as findings for the verify stage (design §4.5, M5), `image-<n>`: about what cites the
 * page, with that page and quote as evidence. No stage after reading sees the picture (D3), so the
 * verifier judges from the page's reading whether it shows what cites it; a ref it finds wrong goes
 * (`dropImageRefs`), and the apply step never sees these findings.
 */
export function imageRefFindings(doc: CourseStructure | FormulaSheet): Finding[] {
  const refs = refHolders(doc).flatMap((h) => h.refs.filter((r) => r.checked === "image").map((r) => ({ h, r })));
  return refs.map(({ h, r }, i) => ({
    id: `${IMAGE_FINDING}${i + 1}`,
    severity: "should",
    where: h.where,
    field: "refs",
    problem: `${h.what} cites L${r.lecture} p${r.page} by words the page reader saw on its picture, not in its text: the page may not show it`,
    evidence: [{ lecture: r.lecture, page: r.page, quote: r.quote }],
    fix: `remove the ref to L${r.lecture} p${r.page}`,
  }));
}

/** The document without the image-checked refs of the `imageRefFindings` the verifier judged real (other findings are left to apply), with what went, in words. */
export function dropImageRefs<D extends CourseStructure | FormulaSheet>(doc: D, real: readonly Finding[]): { doc: D; changes: string[] } {
  const out = JSON.parse(JSON.stringify(doc)) as D;
  const holders = refHolders(out);
  const changes: string[] = [];
  for (const f of real) {
    const e = f.evidence[0];
    if (!f.id.startsWith(IMAGE_FINDING) || !e) continue;
    const h = holders.find((x) => x.where.join() === f.where.join());
    const i = h ? h.refs.findIndex((r) => r.checked === "image" && r.lecture === e.lecture && r.page === e.page) : -1;
    if (!h || i < 0) continue;
    h.refs.splice(i, 1);
    changes.push(`${h.what}: the ref to L${e.lecture} p${e.page} dropped, the page does not show it`);
  }
  return { doc: out, changes };
}
