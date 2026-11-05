// The teacher's own structure and signals on the slides, found by code before the map is planned
// (in-app generation, stage M1 of design §4.3, as decisions D5 and D8 amend it). From the page
// readings: pages that state structure — outlines, recaps, enumerated approaches or steps — with
// their items; the questions the teacher puts to the class; slide titles repeated across lectures,
// which mark an idea taken up again. The blueprint reads them as material, and the map's checks
// take their pages: a teacher thread's roadmap ref must be on a structure page, and a core flag's
// evidence on a signal page — a teacher's question or a recap (D8), so few signals make few core
// concepts. Sample questions are no anchor: they only test coverage, in a stage of their own (D5) —
// neither a page the reader took for an exercise, nor a deck's page that 考试信息.json lists as exam material.
// Also the sheet's counterpart (F1): the lectures whose readings hold formulas, grouped for its drafts.

import type { Digests, InventoryExamFile, InventoryLecture } from "./bundle";
import type { CoreEvidence, PageAt } from "./checkStructure";
import type { PageKind } from "./schemas";
import { squash } from "./squash";

/** A page that states the structure of the course, a lecture or a topic. */
export interface RoadmapPage extends PageAt {
  kind: PageKind;
  title: string;
  /** Its items in order, as the reading wrote them; [] when it gave none. */
  items: string[];
}

/** A question the teacher puts to the class: the reading's words, else the page's title. */
export interface TeacherQuestion extends PageAt {
  question: string;
}

/** A slide title in two lectures or more, as it first appears, with every page that carries it. */
export interface RepeatedTitle {
  title: string;
  pages: PageAt[];
}

/** A page a core flag may rest on (D8), with the evidence it gives (`coreWhy.kind`). */
export interface SignalPage extends PageAt {
  kind: CoreEvidence;
}

export interface Anchors {
  /** Outlines, recaps and pages listing approaches or steps: checkStructure's `roadmapPages`. */
  roadmap: RoadmapPage[];
  questions: TeacherQuestion[];
  repeatedTitles: RepeatedTitle[];
  /** The teacher's questions and recaps: checkStructure's `signalPages`. */
  signals: SignalPage[];
}

/** The pages of an idea, whose titles count as repeated: not title, outline, recap, admin or reading pages, which repeat in every lecture, nor exercises (D5). */
const IDEA_KINDS: readonly PageKind[] = ["content", "formula", "figure", "question"];

/**
 * The anchors of a course from its page readings (by deck sha256; a lecture without any gives none),
 * each list in lecture and page order. `examFiles`: the sample and past papers (Inventory), whose
 * pages in a deck of the course (the same sha256) are no anchor of any kind.
 */
export function buildAnchors(lectures: readonly Pick<InventoryLecture, "no" | "sha256">[], digests: Digests, examFiles: readonly { sha256: InventoryExamFile["sha256"]; pages: readonly { page: number }[] }[] = []): Anchors {
  const out: Anchors = { roadmap: [], questions: [], repeatedTitles: [], signals: [] };
  const titles = new Map<string, RepeatedTitle & { lectures: Set<number> }>();
  const exam = new Set(examFiles.flatMap((f) => f.pages.map((p) => `${f.sha256}:${p.page}`)));
  for (const { no, sha256 } of [...lectures].sort((a, b) => a.no - b.no)) {
    for (const d of [...(digests[sha256] ?? [])].sort((a, b) => a.page - b.page)) {
      if (exam.has(`${sha256}:${d.page}`)) continue;
      const at = { lecture: no, page: d.page };
      if (d.kind === "outline" || d.kind === "recap" || d.roadmapItems.length) out.roadmap.push({ ...at, kind: d.kind, title: d.title, items: d.roadmapItems });
      if (d.kind !== "exercise" && (d.kind === "question" || d.teacherQuestion.trim())) {
        out.questions.push({ ...at, question: d.teacherQuestion.trim() || d.title });
        out.signals.push({ ...at, kind: "teacherQuestion" });
      }
      if (d.kind === "recap") out.signals.push({ ...at, kind: "recap" });
      const key = squash(d.title);
      if (!key || !IDEA_KINDS.includes(d.kind)) continue;
      const t = titles.get(key) ?? { title: d.title.trim(), pages: [], lectures: new Set<number>() };
      t.pages.push(at);
      t.lectures.add(no);
      titles.set(key, t);
    }
  }
  out.repeatedTitles = [...titles.values()].filter((t) => t.lectures.size > 1).map(({ title, pages }) => ({ title, pages }));
  return out;
}

/**
 * F1 (design §4.4): the lectures whose readings hold formulas, in groups for the sheet's drafts —
 * in lecture order, a group closing before it would pass `maxPages` formula pages (a lecture with
 * more stands alone). None when the course has fewer than `minPages` formula pages: the sheet is skipped.
 */
export function formulaRanges(lectures: readonly Pick<InventoryLecture, "no" | "sha256">[], digests: Digests, maxPages = 40, minPages = 5): number[][] {
  const counts = [...lectures]
    .sort((a, b) => a.no - b.no)
    .map((l) => ({ no: l.no, pages: (digests[l.sha256] ?? []).filter((d) => d.formulas.length).length }))
    .filter((l) => l.pages);
  if (counts.reduce((n, l) => n + l.pages, 0) < minPages) return [];
  const out: { nos: number[]; pages: number }[] = [];
  for (const l of counts) {
    const last = out.at(-1);
    if (last && last.pages + l.pages <= maxPages) {
      last.nos.push(l.no);
      last.pages += l.pages;
    } else out.push({ nos: [l.no], pages: l.pages });
  }
  return out.map((r) => r.nos);
}
