// Stage R's answers checked in code (in-app generation, design §4.2 as D3 and the image pilot of
// 2026-10-27 amend it): a reading holds every page it was sent exactly once and no other, each of its
// formulas renders in KaTeX, and a title is on its page where the page has text enough to tell. Where
// code sent a page's picture because a formula or a figure is there (`needsImage`), the reading has
// one. A page with any of these issues is read once more, by the stronger model (pipeline.ts
// `reread`, reader prompt `retry`), with the issues as material; its new reading takes its place.

import { needsImage, type InventoryPage, type PageDigest } from "./bundle";
import { issue, type CheckContext, type Issue } from "./checkStructure";
import { cpLength, quoteOnPage, squash } from "./squash";

/** A page with at least this many characters (squashed) has text enough to find its title in. */
export const TITLE_CHARS = 30;

/** A problem of one page's reading, under `page <n>`. */
export interface ReadingIssue extends Issue {
  page: number;
}

/**
 * What is wrong with a reading of the pages `sent` (a deck's or a paper's, from the inventory), in
 * page order: a page missing or read twice, a page not sent, a formula KaTeX cannot render (display
 * mode, as the sheet renders it), a title not on a page of TITLE_CHARS characters or more, no formula
 * on a page whose text garbles maths or names a formula without any, no figure on a page with one.
 */
export function readingIssues(sent: readonly InventoryPage[], answer: readonly PageDigest[], katex?: CheckContext["katex"]): ReadingIssue[] {
  const out: ReadingIssue[] = [];
  const at = (page: number, code: string, message: string) => out.push({ ...issue(`page ${page}`, code, message), page });
  const asked = new Set(sent.map((p) => p.page));
  for (const p of [...sent].sort((a, b) => a.page - b.page)) {
    const read = answer.filter((d) => d.page === p.page);
    if (!read.length) {
      at(p.page, "reading-missing", "the reading has no entry for this page");
      continue;
    }
    if (read.length > 1) at(p.page, "reading-twice", `the reading has ${read.length} entries for this page`);
    const d = read[0];
    for (const f of d.formulas) {
      const error = katex?.(f.tex, true) ?? null;
      if (error !== null) at(p.page, "reading-katex", `KaTeX cannot render ${JSON.stringify(f.tex)}: ${error.split("\n")[0]}`);
    }
    if (d.title.trim() && cpLength(squash(p.text)) >= TITLE_CHARS && !quoteOnPage(p.text, d.title)) at(p.page, "reading-title", `the title ${JSON.stringify(d.title)} is not on the page`);
    const reason = needsImage(p.text, p.figure);
    if ((reason === "garbled" || reason === "formula") && !d.formulas.length) at(p.page, "reading-no-formula", "the page states a formula its text cannot carry, and the reading has none");
    if (p.figure && d.figureKind === "none") at(p.page, "reading-no-figure", "the page has a figure, and the reading has none");
  }
  for (const page of [...new Set(answer.map((d) => d.page))].filter((n) => !asked.has(n)).sort((a, b) => a - b)) at(page, "reading-extra", "this page was not sent");
  return out;
}

/** The pages to read again: those with an issue that a reading can mend (not one that was never sent), in page order. */
export function rereadPages(issues: readonly ReadingIssue[]): number[] {
  return [...new Set(issues.filter((i) => i.code !== "reading-extra").map((i) => i.page))].sort((a, b) => a - b);
}

/** A deck's reading with the pages read again in place of the first answer's, each page once, in page order; pages that were not sent are left out. */
export function mergeReadings(sent: readonly InventoryPage[], first: readonly PageDigest[], again: readonly PageDigest[]): PageDigest[] {
  const pages = new Set(sent.map((p) => p.page));
  const byPage = new Map<number, PageDigest>();
  for (const d of [...again, ...first]) if (pages.has(d.page) && !byPage.has(d.page)) byPage.set(d.page, d);
  return [...byPage.values()].sort((a, b) => a.page - b.page);
}
