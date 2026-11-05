// Course knowledge structure (lecnote-structure/1; the research and the user's answers of
// 2026-10-26): a course's knowledge as a mind map. The root is the course; threads ask the
// course's big questions, strands split them, and concepts point at the slide pages that
// define and use them. One file per variant, <course>/LecNote/structure/structure-<id>.json.
// Nodes are a flat list with a parent field (no recursion: the shape Structured Outputs can
// produce). Reading is tolerant: what does not fit the tree is dropped and named. Every text may
// carry an English version in an `en` block (the exam is in English); the map switches between them.

import { displayTitle } from "./library";

export const STRUCTURE_SCHEMA = "lecnote-structure/1";

export type StructureKind = "thread" | "strand" | "concept";
export type StructureOrigin = "teacher" | "canvas" | "ai";
export type StructureLinkType = "same-form" | "builds-on" | "contrast" | "applies" | "continues";

/** A slide page: `home` defines the concept, `also` uses it again, `roadmap` states a thread's structure. */
export interface PageRef {
  lecture: number;
  /** 1-based page of the lecture's PDF. */
  page: number;
  role: "home" | "also" | "roadmap";
  /** Words copied from the slide, checked when the file was made. */
  quote: string;
  /** In-app generation: the quote was found in the page's text, or (a figure, a formula) seen on its image. */
  checked?: "text" | "image";
}

export interface StructureNode {
  id: string;
  /** null for threads. */
  parent: string | null;
  kind: StructureKind;
  /** A cue: the name of the idea, not its explanation. */
  title: string;
  /** The English term, as the slides say it. */
  term: string;
  /** Threads and strands: the question the branch answers. */
  question: string;
  /** One line; hidden while recalling. */
  gist: string;
  core: boolean;
  origin: StructureOrigin;
  /** Concepts: the home page first, then `also`. */
  refs: PageRef[];
  en?: { title: string; question: string; gist: string };
}

export interface StructureLink {
  from: string;
  to: string;
  type: StructureLinkType;
  note: string;
  origin: StructureOrigin;
  refs: PageRef[];
  en?: { note: string };
}

/** Easily confused concepts, shown side by side. */
export interface StructureContrast {
  id: string;
  title: string;
  nodes: string[];
  note: string;
  en?: { title: string; note: string };
}

/** One step of the first-open guided reading (导读). `node`: what to show, or null for the whole map. */
export interface TourStep {
  node: string | null;
  title: string;
  text: string;
  en?: { title: string; text: string };
}

/** A deck the tree cites, pinned by hash: page numbers belong to this version of the PDF. */
export interface StructureLecture {
  no: number;
  /** Relative to the course folder. */
  file: string;
  sha256: string;
  pages: number;
  title: string;
}

export interface CourseStructure {
  schema: typeof STRUCTURE_SCHEMA;
  /** The variant, also in the file name. */
  id: string;
  course: string;
  /** Short name for the variant switch. */
  label: string;
  lang: string;
  createdAt: string;
  generator: { by: string; model?: string; note?: string };
  lectures: StructureLecture[];
  summary: string;
  tour: TourStep[];
  nodes: StructureNode[];
  links: StructureLink[];
  contrasts: StructureContrast[];
  en?: { label: string; summary: string };
}

/** The language a map's texts are shown in: the file's own (Chinese) or the English of its `en` blocks. */
export type ContentLang = "zh" | "en";

/** A text in the chosen language: its English version when it has one, else the original. */
export function textIn<K extends string>(o: Record<K, string> & { en?: Partial<Record<K, string>> }, key: K, lang: ContentLang): string {
  return (lang === "en" && o.en?.[key]) || o[key];
}

/** The map has English to switch to. */
export function hasEnglish(tree: CourseStructure): boolean {
  return tree.nodes.some((n) => !!n.en?.title);
}

export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T => (values.includes(v as T) ? (v as T) : fallback);
/**
 * The decks a file cites (one per lecture number, pinned by its hash: a page ref names a lecture
 * number only) and a reader for page refs into them; what does not fit is named in `dropped`.
 * Shared by the knowledge map and the review materials, which cite slides the same way.
 */
export function deckReader(raw: unknown, dropped: string[]): { lectures: StructureLecture[]; refs: (raw: unknown, where: string) => PageRef[] } {
  const lectures: StructureLecture[] = [];
  for (const l of list(raw).filter(isRecord)) {
    const ok = Number.isInteger(l.no) && (l.no as number) >= 0 && Number.isInteger(l.pages) && (l.pages as number) > 0 && str(l.sha256) && !lectures.some((x) => x.no === l.no);
    if (ok) lectures.push({ no: l.no as number, file: str(l.file), sha256: str(l.sha256), pages: l.pages as number, title: str(l.title) });
    else dropped.push(`lecture ${String(l.no)}`);
  }
  const pagesOf = new Map(lectures.map((l) => [l.no, l.pages]));
  const refs = (refsRaw: unknown, where: string): PageRef[] =>
    list(refsRaw)
      .filter(isRecord)
      .flatMap((r) => {
        const ref: PageRef = { lecture: Number(r.lecture), page: Number(r.page), role: oneOf(r.role, ["home", "also", "roadmap"] as const, "also"), quote: str(r.quote), ...(r.checked === "text" || r.checked === "image" ? { checked: r.checked } : {}) };
        const pages = pagesOf.get(ref.lecture);
        if (pages && Number.isInteger(ref.page) && ref.page >= 1 && ref.page <= pages) return [ref];
        dropped.push(`${where}: L${String(r.lecture)} p${String(r.page)}`);
        return [];
      });
  return { lectures, refs };
}

/** `{ en }` to spread into an object, or nothing: absent fields stay absent. */
export const withEn = <T>(en: T | undefined) => (en ? { en } : {});
/** An `en` block with these text fields ("" for a missing one), or nothing when it has none of them. */
export function enBlock<K extends string>(v: Record<string, unknown>, keys: readonly K[]): Record<K, string> | undefined {
  const en = v.en;
  if (!isRecord(en)) return undefined;
  if (!keys.some((k) => str(en[k]))) return undefined;
  return Object.fromEntries(keys.map((k) => [k, str(en[k])])) as Record<K, string>;
}
const ORIGINS = ["teacher", "canvas", "ai"] as const;
const LINK_TYPES = ["same-form", "builds-on", "contrast", "applies", "continues"] as const;
const PARENT_KIND: Record<StructureKind, StructureKind | null> = { thread: null, strand: "thread", concept: "strand" };

/**
 * Parses a structure file. Throws when it is not one (not JSON, another schema, no id); otherwise
 * drops what does not fit — nodes whose parent is missing or of the wrong kind, refs outside the
 * cited decks, links and tour steps to dropped nodes — and says what was dropped.
 */
export function parseStructure(text: string): { tree: CourseStructure; dropped: string[] } {
  const v: unknown = JSON.parse(text);
  if (!isRecord(v) || v.schema !== STRUCTURE_SCHEMA) throw new Error(`not a ${STRUCTURE_SCHEMA} file`);
  if (!str(v.id)) throw new Error("the structure has no id");
  const dropped: string[] = [];
  const { lectures, refs } = deckReader(v.lectures, dropped);

  // Threads first, then strands, then concepts: a node is kept only under a kept parent of the right kind.
  const kept = new Map<string, StructureNode>();
  const raw = list(v.nodes).filter(isRecord);
  for (const kind of ["thread", "strand", "concept"] as const) {
    for (const n of raw.filter((x) => x.kind === kind)) {
      const id = str(n.id);
      const parent = typeof n.parent === "string" ? n.parent : null;
      const want = PARENT_KIND[kind];
      const ok = id && str(n.title) && !kept.has(id) && (want === null ? parent === null : kept.get(parent ?? "")?.kind === want);
      if (!ok) {
        dropped.push(`node ${id || "?"}`);
        continue;
      }
      kept.set(id, {
        id,
        parent,
        kind,
        title: str(n.title),
        term: str(n.term),
        question: str(n.question),
        gist: str(n.gist),
        core: n.core === true,
        origin: oneOf(n.origin, ORIGINS, "ai"),
        refs: refs(n.refs, `node ${id}`),
        ...withEn(enBlock(n, ["title", "question", "gist"] as const)),
      });
    }
  }
  // In file order; a duplicate id's later copies were dropped above.
  for (const n of raw.filter((x) => !(["thread", "strand", "concept"] as unknown[]).includes(x.kind))) dropped.push(`node ${str(n.id) || "?"} (kind ${String(n.kind)})`);
  const nodes = [...new Set(raw.map((n) => str(n.id)))].map((id) => kept.get(id)).filter((n): n is StructureNode => !!n);
  const known = (id: unknown) => typeof id === "string" && kept.has(id);

  const links: StructureLink[] = list(v.links)
    .filter(isRecord)
    .flatMap((l) => {
      if (known(l.from) && known(l.to) && l.from !== l.to) {
        return [{ from: l.from as string, to: l.to as string, type: oneOf(l.type, LINK_TYPES, "builds-on"), note: str(l.note), origin: oneOf(l.origin, ORIGINS, "ai"), refs: refs(l.refs, `link ${str(l.from)}→${str(l.to)}`), ...withEn(enBlock(l, ["note"] as const)) }];
      }
      dropped.push(`link ${str(l.from)}→${str(l.to)}`);
      return [];
    });
  const contrasts: StructureContrast[] = list(v.contrasts)
    .filter(isRecord)
    .flatMap((c) => {
      const members = list(c.nodes).filter(known) as string[];
      if (str(c.id) && members.length >= 2) return [{ id: str(c.id), title: str(c.title), nodes: members, note: str(c.note), ...withEn(enBlock(c, ["title", "note"] as const)) }];
      dropped.push(`contrast ${str(c.id) || "?"}`);
      return [];
    });
  const tour: TourStep[] = list(v.tour)
    .filter(isRecord)
    .flatMap((s) => {
      const node = typeof s.node === "string" ? s.node : null;
      if ((node === null || kept.has(node)) && str(s.text)) return [{ node, title: str(s.title), text: str(s.text), ...withEn(enBlock(s, ["title", "text"] as const)) }];
      dropped.push(`tour step ${str(s.title) || "?"}`);
      return [];
    });
  const generator = isRecord(v.generator) ? { by: str(v.generator.by), model: str(v.generator.model) || undefined, note: str(v.generator.note) || undefined } : { by: "" };

  return {
    tree: {
      schema: STRUCTURE_SCHEMA,
      id: str(v.id),
      course: str(v.course),
      label: str(v.label) || str(v.id),
      lang: str(v.lang),
      createdAt: str(v.createdAt),
      generator,
      lectures,
      summary: str(v.summary),
      tour,
      nodes,
      links,
      contrasts,
      ...withEn(enBlock(v, ["label", "summary"] as const)),
    },
    dropped,
  };
}

/** Lookups over a parsed tree; `children.get(null)` are the threads. */
export interface StructureIndex {
  byId: Map<string, StructureNode>;
  children: Map<string | null, StructureNode[]>;
}

export function indexStructure(tree: CourseStructure): StructureIndex {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const children = new Map<string | null, StructureNode[]>();
  for (const n of tree.nodes) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  return { byId, children };
}

/** The node's parent, grandparent …, nearest first. */
export function ancestors(index: StructureIndex, id: string): string[] {
  const out: string[] = [];
  for (let p = index.byId.get(id)?.parent ?? null; p !== null; p = index.byId.get(p)?.parent ?? null) out.push(p);
  return out;
}

/** Concepts under a node (itself, when it is one). */
export function conceptsUnder(index: StructureIndex, id: string): StructureNode[] {
  const n = index.byId.get(id);
  if (!n) return [];
  if (n.kind === "concept") return [n];
  return (index.children.get(id) ?? []).flatMap((c) => conceptsUnder(index, c.id));
}

/** Where a cited deck opens: `exact` = the package holding this very PDF. */
export interface DeckPackage {
  dir: string;
  exact: boolean;
  /** The imported PDF's file name. */
  sourceFile: string;
  /** iCloud offloaded the package: opening it downloads it first. */
  inCloud: boolean;
}

/** A lecture a cited deck may have been imported as (platform `LectureEntry`'s fields). */
export interface DeckCandidate {
  dir: string;
  sourceFile: string;
  /** 0 for an offloaded package known only by its folder name. */
  pages: number;
  inCloud?: boolean;
  supersededBy?: string | null;
}

const deckStem = (file: string) => displayTitle((file.split("/").pop() ?? file).replace(/\.pdf$/i, "")).toLowerCase();

/**
 * Whether a cited deck and a deck of the course are the same slides, by findDecks' rule: the same
 * PDF (sha256), or a copy of it — the same file name once copy suffixes are dropped, and the same
 * page count. Anything else under the deck's lecture number is another version (a re-upload).
 */
export function sameDeck(cited: Pick<StructureLecture, "sha256" | "file" | "pages">, deck: Pick<StructureLecture, "sha256" | "file" | "pages">): boolean {
  return cited.sha256 === deck.sha256 || (deckStem(cited.file) === deckStem(deck.file) && cited.pages === deck.pages);
}

/**
 * The package each cited deck opens in: the one holding that PDF (`exact`, found by hash), else
 * one imported from a copy of it — the same file name once copy suffixes are dropped, and the same
 * page count (a student's annotated "L10 … - Copy (2).pdf" of the teacher's deck), or an offloaded
 * package of that name whose page count is unknown. `candidates` in order of preference: the
 * course's own lectures, then the semester's loose ones — never another course's deck of the same
 * name. Lectures replaced by a newer version are skipped.
 */
export function findDecks(lectures: readonly StructureLecture[], exact: Readonly<Record<string, string>>, candidates: readonly DeckCandidate[]): Map<string, DeckPackage> {
  const out = new Map<string, DeckPackage>();
  const live = candidates.filter((e) => !e.supersededBy);
  for (const l of lectures) {
    const dir = exact[l.sha256];
    if (dir) {
      const known = candidates.find((e) => e.dir === dir);
      out.set(l.sha256, { dir, exact: true, sourceFile: known?.sourceFile ?? (l.file.split("/").pop() ?? l.file), inCloud: !!known?.inCloud });
      continue;
    }
    const stem = deckStem(l.file);
    const copy = live.find((e) => deckStem(e.sourceFile) === stem && (e.pages === l.pages || (!!e.inCloud && e.pages === 0)));
    if (copy) out.set(l.sha256, { dir: copy.dir, exact: false, sourceFile: copy.sourceFile, inCloud: !!copy.inCloud });
  }
  return out;
}

export type MapDirection = "down" | "right";

export interface MapBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapLayout {
  boxes: Map<string, MapBox>;
  /** SVG path data from parent to child. */
  edges: { from: string; to: string; d: string }[];
  width: number;
  height: number;
}

/** Gaps in px: between levels, between stacked siblings, between spread subtrees, and the outline indent. */
export const MAP_GAPS = { level: 44, sibling: 8, spread: 28, indent: 18, stack: 6 };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const max = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), 0);
const r = (n: number) => Math.round(n * 2) / 2;

/**
 * Places a mind map. `right`: the classic tree, root on the left, each parent centred on its
 * children's band. `down`: the root on top with its children in one row, and below each of them
 * an indented outline — a top-down tree of 70 concepts would be ten thousand pixels wide.
 * `kids` returns the shown children (none for a folded node); `size` is a node's measured [w, h].
 */
export function layoutMindMap(root: string, kids: (id: string) => readonly string[], size: (id: string) => readonly [number, number], dir: MapDirection): MapLayout {
  const G = MAP_GAPS;
  const outline = (depth: number) => dir === "down" && depth >= 1;
  const ext = new Map<string, [number, number]>();
  const measure = (id: string, depth: number): [number, number] => {
    const [w, h] = size(id);
    const ms = kids(id).map((k) => measure(k, depth + 1));
    let e: [number, number];
    if (!ms.length) e = [w, h];
    else if (dir === "right") e = [w + G.level + max(ms.map((m) => m[0])), Math.max(h, sum(ms.map((m) => m[1])) + G.sibling * (ms.length - 1))];
    else if (outline(depth)) e = [Math.max(w, G.indent + max(ms.map((m) => m[0]))), h + sum(ms.map((m) => G.stack + m[1]))];
    else e = [Math.max(w, sum(ms.map((m) => m[0])) + G.spread * (ms.length - 1)), h + G.level + max(ms.map((m) => m[1]))];
    ext.set(id, e);
    return e;
  };

  const boxes = new Map<string, MapBox>();
  const edges: MapLayout["edges"] = [];
  const place = (id: string, depth: number, left: number, top: number): MapBox => {
    const [w, h] = size(id);
    const [ew, eh] = ext.get(id)!;
    const ks = kids(id);
    let box: MapBox;
    const children: MapBox[] = [];
    if (dir === "right") {
      box = { x: left, y: top + (eh - h) / 2, w, h };
      let y = top + (eh - (sum(ks.map((k) => ext.get(k)![1])) + G.sibling * (ks.length - 1))) / 2;
      for (const k of ks) {
        children.push(place(k, depth + 1, left + w + G.level, y));
        y += ext.get(k)![1] + G.sibling;
      }
    } else if (outline(depth)) {
      box = { x: left, y: top, w, h };
      let y = top + h + G.stack;
      for (const k of ks) {
        children.push(place(k, depth + 1, left + G.indent, y));
        y += ext.get(k)![1] + G.stack;
      }
    } else {
      box = { x: left + (ew - w) / 2, y: top, w, h };
      let x = left + (ew - (sum(ks.map((k) => ext.get(k)![0])) + G.spread * (ks.length - 1))) / 2;
      for (const k of ks) {
        children.push(place(k, depth + 1, x, top + h + G.level));
        x += ext.get(k)![0] + G.spread;
      }
    }
    boxes.set(id, box);
    ks.forEach((k, i) => {
      const c = children[i];
      let d: string;
      if (dir === "right") {
        const [x1, y1, x2, y2] = [box.x + box.w, box.y + box.h / 2, c.x, c.y + c.h / 2];
        const mx = (x1 + x2) / 2;
        d = `M${r(x1)} ${r(y1)}C${r(mx)} ${r(y1)} ${r(mx)} ${r(y2)} ${r(x2)} ${r(y2)}`;
      } else if (outline(depth)) {
        const rail = box.x + G.indent / 2;
        d = `M${r(rail)} ${r(box.y + box.h)}V${r(c.y + c.h / 2)}H${r(c.x)}`;
      } else {
        const [x1, y1, x2, y2] = [box.x + box.w / 2, box.y + box.h, c.x + c.w / 2, c.y];
        const my = (y1 + y2) / 2;
        d = `M${r(x1)} ${r(y1)}C${r(x1)} ${r(my)} ${r(x2)} ${r(my)} ${r(x2)} ${r(y2)}`;
      }
      edges.push({ from: id, to: k, d });
    });
    return box;
  };

  const [width, height] = measure(root, 0);
  place(root, 0, 0, 0);
  return { boxes, edges, width, height };
}
