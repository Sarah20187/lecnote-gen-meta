// The English of a map put in place (in-app generation, stage M7). The translate, repair and review
// calls answer in `englishSchema`'s form — nodes and contrasts by id, links by their ends, tour steps
// by their 1-based position, as checkEnglish names them — and code writes each item's `en` block.
// A full answer (translate) is the map's whole English: an item it leaves out is left without any,
// for checkEnglish to report and a repair to write, never with a stale one. A partial answer (an
// update's translate, a repair, the review) holds only what it changes: each item it gives replaces
// that item's whole `en` block, the rest stay, and a top-level "" leaves that text as it was.
// The review may only make the English better (`keepBetterEnglish`): an item it leaves with an error
// it did not have gets its English from before the review back, so the repairs' budget being spent
// already never lets a review's new error into the candidate (D9: the English lengths are hard).

import type { CourseStructure } from "../structure";
import { checkEnglish, type KeptEnglish } from "./checkEnglish";
import { py, tourStep, type Issue } from "./checkStructure";
import type { Limits } from "./limits";
import type { EnglishAnswer } from "./schemas";

/** `full`: the answer is the whole English (translate); `patch`: only what it changes (an update's translate, repair, review). */
export type EnglishMode = "full" | "patch";

export interface MergedEnglish {
  doc: CourseStructure;
  /** Items of the answer that name nothing in the map (an id, a link or a step it does not have), as checkEnglish would name them. */
  unknown: string[];
  /** In full mode, what the answer left out, now without English: `top` for an empty label or summary. */
  missing: string[];
}

const linkKey = (l: { from: string; to: string }) => `${l.from}→${l.to}`;

/** The map with the answer's English in place; `doc` is not changed. */
export function mergeEnglish(doc: CourseStructure, answer: EnglishAnswer, mode: EnglishMode): MergedEnglish {
  const out = JSON.parse(JSON.stringify(doc)) as CourseStructure;
  const unknown: string[] = [];
  const missing: string[] = [];
  const full = mode === "full";

  if (full) {
    out.en = { label: answer.label, summary: answer.summary };
    if (!answer.label || !answer.summary) missing.push("top");
  } else if (answer.label || answer.summary) {
    out.en = { label: answer.label || (out.en?.label ?? ""), summary: answer.summary || (out.en?.summary ?? "") };
  }

  /** Gives each answered item of `items` its English (`en` of the answer's entry); in full mode the others lose theirs. */
  const merge = <T extends { en?: unknown }, A>(items: T[], entries: readonly A[], key: (x: T) => string, keyOf: (a: A) => string, en: (a: A) => T["en"], where: (k: string) => string) => {
    const byKey = new Map(items.map((x) => [key(x), x]));
    const given = new Set<T>();
    for (const a of entries) {
      const item = byKey.get(keyOf(a));
      if (!item) {
        unknown.push(where(keyOf(a)));
        continue;
      }
      item.en = en(a);
      given.add(item);
    }
    if (!full) return;
    for (const item of items) {
      if (given.has(item)) continue;
      delete item.en;
      missing.push(where(key(item)));
    }
  };
  merge(out.nodes, answer.nodes, (n) => n.id, (a) => a.id, (a) => ({ title: a.title, question: a.question, gist: a.gist }), (k) => `node ${k}`);
  merge(out.links, answer.links, linkKey, linkKey, (a) => ({ note: a.note }), (k) => `link ${k}`);
  merge(out.contrasts, answer.contrasts, (c) => c.id, (a) => a.id, (a) => ({ title: a.title, note: a.note }), (k) => `contrast ${k}`);
  const steps = new Map(out.tour.map((s, i) => [s, String(i + 1)]));
  merge(out.tour, answer.tour, (s) => steps.get(s)!, (a) => String(a.step), (a) => ({ title: a.title, text: a.text }), (k) => tourStep(Number(k) - 1));
  return { doc: out, unknown, missing };
}

/**
 * `after` (a map with a patch's English merged, the review's) with each item that now has an
 * error checkEnglish did not find in `before` given back its English from `before` (none, if it had
 * none). `restored`: those items, as checkEnglish names them. Neither map is changed. `kept`: an
 * update's frozen nodes and their limits, as checkEnglish takes them.
 */
export function keepBetterEnglish(before: CourseStructure, after: CourseStructure, limits: Limits, kept?: KeptEnglish): { doc: CourseStructure; restored: string[] } {
  const key = (i: Issue) => `${i.where}\u0000${i.code}\u0000${i.message}`;
  const had = new Set(checkEnglish(before, limits, kept).map(key));
  const worse = checkEnglish(after, limits, kept).filter((i) => !had.has(key(i))).map((i) => i.where);
  const out = JSON.parse(JSON.stringify(after)) as CourseStructure;
  const restored: string[] = [];
  /** `item` gets `prev`'s English back when an error new to it (or to a formula of it) is named `where`. */
  const back = (where: string, item: { en?: unknown }, prev: { en?: unknown } | undefined) => {
    if (!worse.some((w) => w === where || w.startsWith(`${where} `))) return;
    if (prev?.en === undefined) delete item.en;
    else item.en = JSON.parse(JSON.stringify(prev.en));
    restored.push(where);
  };
  back("top", out, before);
  const nodes = new Map(before.nodes.map((n) => [n.id, n]));
  for (const n of out.nodes) back(`node ${py(n.id)}`, n, nodes.get(n.id));
  out.links.forEach((l, i) => back(`link ${i} (${py(l.from)}→${py(l.to)})`, l, before.links.find((b) => linkKey(b) === linkKey(l))));
  const contrasts = new Map(before.contrasts.map((c) => [c.id, c]));
  for (const c of out.contrasts) back(`contrast ${py(c.id)}`, c, contrasts.get(c.id));
  out.tour.forEach((t, i) => back(tourStep(i), t, before.tour[i]));
  return { doc: out, restored };
}

/**
 * An update's English (design §4.6, M7 for new and changed items): `doc` with the English of what
 * the update keeps put back as `adopted` had it — its frozen nodes and contrasts (`ids`), and the
 * links between two of them that it had — so a translation that wrote more than it was asked to
 * never rewrites what the student already learned. An item the adopted map had no English for may
 * take the new. `held`: those put back, as checkEnglish names them. `doc` is not changed.
 */
export function holdEnglish(doc: CourseStructure, adopted: CourseStructure, ids: Iterable<string>): { doc: CourseStructure; held: string[] } {
  const frozen = new Set(ids);
  const out = JSON.parse(JSON.stringify(doc)) as CourseStructure;
  const held: string[] = [];
  const put = (where: string, item: { en?: unknown }, was: { en?: unknown } | undefined) => {
    if (was?.en === undefined || JSON.stringify(item.en) === JSON.stringify(was.en)) return;
    item.en = JSON.parse(JSON.stringify(was.en));
    held.push(where);
  };
  const nodes = new Map(adopted.nodes.map((n) => [n.id, n]));
  for (const n of out.nodes) if (frozen.has(n.id)) put(`node ${py(n.id)}`, n, nodes.get(n.id));
  out.links.forEach((l, i) => {
    if (frozen.has(l.from) && frozen.has(l.to)) put(`link ${i} (${py(l.from)}→${py(l.to)})`, l, adopted.links.find((a) => linkKey(a) === linkKey(l)));
  });
  const contrasts = new Map(adopted.contrasts.map((c) => [c.id, c]));
  for (const c of out.contrasts) if (frozen.has(c.id)) put(`contrast ${py(c.id)}`, c, contrasts.get(c.id));
  return { doc: out, held };
}
