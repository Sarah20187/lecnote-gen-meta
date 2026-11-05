// JSON Schemas for in-app generation's answers (design §4.0): each call's `output_config.format`
// (type json_schema, strict). They stay inside what strict schemas accept and spend nothing of the
// API's budgets (24 optional fields, 16 unions per request): flat (no $ref, so no recursion), every
// object closed and every field required, no unions or nullables — "", [] and 0 stand for "none" —
// and no constraints the API rejects (lengths, counts, patterns): code checks those. No field is
// named reasoning or thinking, which invites refusals. `lintSchema` holds every schema to this;
// `misfits` holds an answer to its schema, and the answers' types follow the schemas.

import type { PageRef, StructureKind, StructureLinkType, StructureOrigin } from "../structure";
import { CORE_EVIDENCE } from "./checkStructure";
import type { Op } from "./ops";

/** Bumped when any schema changes: a run pins it, and an answer to an older schema is not reused. */
export const SCHEMAS_VERSION = 3;

/** The JSON Schema subset the generation schemas use. */
export interface JsonSchema {
  type: "object" | "array" | "string" | "integer" | "number" | "boolean";
  description?: string;
  enum?: readonly (string | number | boolean)[];
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: false;
  items?: JsonSchema;
}

const described = (s: JsonSchema, description?: string): JsonSchema => (description ? { ...s, description } : s);
const text = (description?: string) => described({ type: "string" }, description);
const int = (description?: string) => described({ type: "integer" }, description);
const bool = (description?: string) => described({ type: "boolean" }, description);
const oneOf = (values: readonly string[], description?: string) => described({ type: "string", enum: [...values] }, description);
const list = (items: JsonSchema, description?: string) => described({ type: "array", items }, description);
/** A closed object: every field required, no others. */
const obj = (properties: Record<string, JsonSchema>, description?: string): JsonSchema =>
  described({ type: "object", properties, required: Object.keys(properties), additionalProperties: false }, description);
/** A map concept: an enum of the map's ids when given; without them (the API found the enum too complex) code checks the ids. */
const concept = (conceptIds: readonly string[]) => (conceptIds.length ? oneOf([...new Set(conceptIds)]) : text("a concept id of the map"));

export const PAGE_KINDS = ["title", "outline", "content", "formula", "figure", "question", "exercise", "recap", "reading", "admin"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];
/** `graph`: boxes and arrows (a causal graph, a flow chart), written out as edges. */
export const FIGURE_KINDS = ["none", "graph", "chart", "table", "diagram", "picture"] as const;
export type FigureKind = (typeof FIGURE_KINDS)[number];

const KINDS = ["thread", "strand", "concept"] as const satisfies readonly StructureKind[];
/** Generation never sees a canvas: what the slides name is the teacher's, the rest the model's. */
const ORIGINS = ["teacher", "ai"] as const satisfies readonly StructureOrigin[];
const LINK_TYPES = ["same-form", "builds-on", "contrast", "applies", "continues"] as const satisfies readonly StructureLinkType[];
const ROLES = ["home", "also", "roadmap"] as const satisfies readonly PageRef["role"][];
/** A node's `coreWhy` kind: the checker's evidence for 重点 (D8), or none when the node is not core. */
const CORE_WHY_KINDS = ["none", ...CORE_EVIDENCE] as const;
export type CoreWhyKind = (typeof CORE_WHY_KINDS)[number];
/** Who a generated item is by: what the slides name is the teacher's, the rest the model's. */
export type GenOrigin = (typeof ORIGINS)[number];

const pageRef = (roles: readonly PageRef["role"][]) =>
  obj({ lecture: int(), page: int("1-based page of the lecture's PDF"), role: oneOf(roles), quote: text("2–12 words copied from the page's text") });
const edge = obj({ from: text(), to: text(), label: text('"" when the arrow has none') });
/** A page that shows a finding or a gap, by words of it: no later stage sees a picture (D3), so code checks them against the page's text or its reading. */
const evidence = obj({ lecture: int(), page: int(), quote: text("2–12 words copied from the page's text, or for a picture from its reading") });

/** Stage R: what each page of a lecture holds, read from its text and, for the pages code chose, its image (D3). It transcribes, never structures. */
export const digestSchema = obj({
  pages: list(
    obj({
      page: int(),
      kind: oneOf(PAGE_KINDS),
      title: text('the slide\'s own title; "" when it has none'),
      formulas: list(obj({ tex: text("LaTeX for KaTeX, in the slide's notation"), what: text() })),
      figureKind: oneOf(FIGURE_KINDS),
      figureText: text('the figure in words; "" when there is none'),
      edges: list(edge),
      teacherQuestion: text('a question the teacher puts to the class on this page, as written; "" when none'),
      roadmapItems: list(text()),
      terms: list(text()),
    }),
  ),
});

/** Stage R2: figure pages read again, without R's reading, for code to compare the edges. One call reads pages of several lectures. */
export const figureSchema = obj({ pages: list(obj({ lecture: int(), page: int(), edges: list(edge), figureText: text() })) });

/** Stage Z: one page at zoom, given both readings: its edges, and which reading the page bears out. */
export const zoomSchema = obj({ page: int(), edges: list(edge), verdict: oneOf(["first", "second", "neither"]) });

const anchorRef = obj({ lecture: int(), page: int() }, "the outline or recap page that states this branch; 0 and 0 when none");

/** M2a: the plan of the map before it is written — branches, concepts with their home pages, the tour's steps (blueprint.ts checks it). */
export const blueprintSchema = obj({
  threads: list(obj({ id: text(), title: text(), question: text(), origin: oneOf(ORIGINS), anchorRef })),
  strands: list(obj({ id: text(), parent: text(), title: text(), question: text(), origin: oneOf(ORIGINS), anchorRef })),
  concepts: list(obj({ id: text(), parent: text(), term: text(), homeLecture: int(), homePage: int() })),
  tour: list(obj({ node: text('"" for the whole map'), title: text() })),
});

/**
 * M2b: the map itself, lecnote-structure/1 without what code fills in (schema, id, course, lang,
 * createdAt, generator, lectures) and without English, which M7 writes (`englishSchema`): a draft
 * has no `en` block, so checkEnglish passes it. `parent` "" for threads, a tour step's `node` ""
 * for the whole map, `coreWhy` kind "none" (ref 0, 0, "") unless core.
 */
export const draftSchema = obj({
  label: text(),
  summary: text(),
  nodes: list(
    obj({
      id: text(),
      parent: text('"" for a thread'),
      kind: oneOf(KINDS),
      origin: oneOf(ORIGINS),
      title: text(),
      term: text(),
      question: text(),
      gist: text(),
      core: bool(),
      coreWhy: obj({ kind: oneOf(CORE_WHY_KINDS), ref: obj({ lecture: int(), page: int(), quote: text() }) }, 'why it is 重点: the teacher\'s question or recap page; kind "none" and 0, 0, "" when not core'),
      refs: list(pageRef(ROLES)),
    }),
  ),
  links: list(obj({ from: text(), to: text(), type: oneOf(LINK_TYPES), note: text(), origin: oneOf(ORIGINS), refs: list(pageRef(ROLES)) })),
  contrasts: list(obj({ id: text(), title: text(), nodes: list(text()), note: text() })),
  tour: list(obj({ node: text('"" for the whole map'), title: text(), text: text() })),
});

export const OP_NAMES = [
  "addNode",
  "setField",
  "moveNode",
  "removeNode",
  "addRef",
  "removeRef",
  "moveRef",
  "addLink",
  "removeLink",
  "setLinkField",
  "addContrast",
  "addToContrast",
  "setContrastField",
  "removeContrast",
  "setTour",
  "setTourField",
  "addFormula",
  "setFormulaField",
  "removeFormula",
] as const;
export type OpName = (typeof OP_NAMES)[number];
/** What the field ops may set: `setField` (the map's and a node's), `setLinkField`, `setContrastField`, `setTourField`, `setFormulaField`. */
export const OP_FIELDS = [
  "title",
  "term",
  "question",
  "gist",
  "core",
  "coreWhy",
  "origin",
  "label",
  "summary",
  "en.title",
  "en.question",
  "en.gist",
  "en.label",
  "en.summary",
  "text",
  "en.text",
  "concept",
  "name",
  "tex",
  "note",
  "trap",
  "en.name",
  "en.note",
  "en.trap",
] as const;
export type OpField = (typeof OP_FIELDS)[number];

/** The flat op record: one column per field any op needs; an op fills its own columns and leaves the rest "" or []. */
const opRecord = {
  op: oneOf(OP_NAMES),
  group: text("the finding the op carries out; reverted together"),
  id: text('the node, contrast or formula; for setField "" is the map itself'),
  parent: text(),
  kind: oneOf(["", ...KINDS]),
  title: text(),
  term: text(),
  question: text(),
  gist: text(),
  origin: oneOf(["", ...ORIGINS]),
  field: oneOf(["", ...OP_FIELDS]),
  value: text('the new text; "true" or "false" for core; the evidence kind for coreWhy'),
  from: text(),
  to: text(),
  type: oneOf(["", ...LINK_TYPES]),
  note: text(),
  nodes: list(text()),
  concept: text(),
  name: text(),
  tex: text(),
  trap: text(),
  refs: list(pageRef(ROLES)),
  step: int("a tour step by its 1-based position in the tour: step 1 is the first; 0 when the op names none"),
  steps: list(obj({ node: text('"" for the whole map'), title: text(), text: text() })),
};
export type OpColumn = Exclude<keyof typeof opRecord, "op" | "group">;

/**
 * The columns each op reads (besides `op` and `group`), as data for the ops module and the
 * prompts. setField `coreWhy` takes the evidence kind in `value` and its page in `refs`; moveRef
 * moves the refs at `refs`' pages from node `id` to node `to`, with `refs`' roles; addToContrast
 * grows a contrast (a frozen one too) by `nodes`; a link is named by `from` and `to`, a tour step by `step`.
 */
export const OP_COLUMNS: Readonly<Record<OpName, readonly OpColumn[]>> = {
  addNode: ["id", "parent", "kind", "title", "term", "question", "gist", "origin"],
  setField: ["id", "field", "value", "refs"],
  moveNode: ["id", "parent"],
  removeNode: ["id"],
  addRef: ["id", "refs"],
  removeRef: ["id", "refs"],
  moveRef: ["id", "to", "refs"],
  addLink: ["from", "to", "type", "note", "origin", "refs"],
  removeLink: ["from", "to"],
  setLinkField: ["from", "to", "field", "value"],
  addContrast: ["id", "title", "nodes", "note"],
  addToContrast: ["id", "nodes"],
  setContrastField: ["id", "field", "value"],
  removeContrast: ["id"],
  setTour: ["steps"],
  setTourField: ["step", "field", "value"],
  addFormula: ["id", "concept", "name", "tex", "note", "trap", "refs"],
  setFormulaField: ["id", "field", "value"],
  removeFormula: ["id"],
};

/**
 * M3, M6, F3, F5, U1: patch ops (map and sheet), the findings the writer turned down with a reason,
 * and — an update's alone (U1, design §3.4, §4.6) — the larger changes it may not make, as text for
 * 「重新生成以应用」: a new strand or thread, a move, a merge, a gist edit.
 */
export const opsSchema = obj({
  ops: list(obj(opRecord)),
  rejected: list(obj({ group: text(), why: text() })),
  proposals: list(obj({ text: text("the change in one or two sentences"), refs: list(evidence) }), "only an update proposes; [] in every other step"),
});

/** M4, F4: review findings. `where`: the ids of what the finding is about (nodes, contrasts, formulas). */
export const findingsSchema = obj({
  findings: list(
    obj({
      id: text("any short label: code numbers the findings itself"),
      severity: oneOf(["must", "should", "nit"]),
      where: list(text()),
      field: text('the field at fault; "" for the whole item'),
      problem: text(),
      evidence: list(evidence),
      fix: text(),
    }),
  ),
});

/** M5, F5: the sceptical verifier's call on each finding (default: not an error). */
export const verdictSchema = obj({ verdicts: list(obj({ id: text(), real: bool(), why: text() })) });

/** M6, F5: the diff check of each group of applied ops; a group not ok is reverted whole. */
export const diffCheckSchema = obj({ groups: list(obj({ group: text(), ok: bool(), why: text() })) });

/** M7: the English of the final map, by id (links by their ends, tour steps by their 1-based position). */
export const englishSchema = obj({
  label: text(),
  summary: text(),
  nodes: list(obj({ id: text(), title: text(), question: text(), gist: text() })),
  links: list(obj({ from: text(), to: text(), note: text() })),
  contrasts: list(obj({ id: text(), title: text(), note: text() })),
  tour: list(obj({ step: int("the step's 1-based position in the tour: step 1 is the first"), title: text(), text: text() })),
});

/**
 * The sample-question coverage test (D5): for each question, where it was sent (the bundle's
 * `exam=` and `page=`, and its opening words, for code to find every question sent and only
 * those), the concepts it needs, and what no concept covers — with what the slides teach about it
 * and where ("" and [] when they do not). It only tests the map; it never sets 重点 or 易错.
 */
export function coverageSchema(conceptIds: readonly string[]): JsonSchema {
  return obj({
    questions: list(
      obj({
        exam: int("the exam= of the question's page"),
        page: int("the page= of the page the question starts on"),
        question: text("the question's label in the exam material, such as Sample 2 Q3"),
        quote: text('the question\'s first 2–12 words, copied from that page\'s text; "" when the page has no text'),
        concepts: list(concept(conceptIds)),
        missing: list(obj({ need: text(), taught: text(), refs: list(evidence) })),
      }),
    ),
  });
}

/** F2: a range's formulas (lecnote-formulas/1 entries), each under a map concept; `trap` and `en.trap` "" when there is none. */
export function formulaDraftSchema(conceptIds: readonly string[]): JsonSchema {
  return obj({
    formulas: list(
      obj({
        id: text(),
        concept: concept(conceptIds),
        name: text(),
        tex: text("LaTeX for KaTeX, in the slide's notation"),
        note: text(),
        trap: text(),
        refs: list(pageRef(["home", "also"])),
        en: obj({ name: text(), note: text(), trap: text() }),
      }),
    ),
  });
}

/** A page an answer points at — a finding's evidence, a gap the slides teach, a proposal's page — by words of its text or its reading. */
export interface Evidence {
  lecture: number;
  page: number;
  quote: string;
}

/** A page a blueprint branch rests on; 0 and 0 when none. */
export interface AnchorRef {
  lecture: number;
  page: number;
}

/** A `blueprintSchema` answer (blueprint.ts checks it): "" for a whole-map tour step. */
export interface BlueprintAnswer {
  threads: { id: string; title: string; question: string; origin: GenOrigin; anchorRef: AnchorRef }[];
  strands: { id: string; parent: string; title: string; question: string; origin: GenOrigin; anchorRef: AnchorRef }[];
  concepts: { id: string; parent: string; term: string; homeLecture: number; homePage: number }[];
  tour: { node: string; title: string }[];
}

/** A `draftSchema` answer: "" for a thread's parent and a whole-map tour step (draft.ts makes the map). */
export interface DraftAnswer {
  label: string;
  summary: string;
  nodes: {
    id: string;
    parent: string;
    kind: StructureKind;
    origin: GenOrigin;
    title: string;
    term: string;
    question: string;
    gist: string;
    core: boolean;
    coreWhy: { kind: CoreWhyKind; ref: Evidence };
    refs: PageRef[];
  }[];
  links: { from: string; to: string; type: StructureLinkType; note: string; origin: GenOrigin; refs: PageRef[] }[];
  contrasts: { id: string; title: string; nodes: string[]; note: string }[];
  tour: { node: string; title: string; text: string }[];
}

/** An `opsSchema` answer: each record is an `Op` with every column, the unused ones "", 0 or []. */
export interface OpsAnswer {
  ops: Op[];
  rejected: { group: string; why: string }[];
  proposals: { text: string; refs: Evidence[] }[];
}

/** One finding of a `findingsSchema` answer; code makes them too (the coverage test's gaps). */
export interface Finding {
  id: string;
  severity: "must" | "should" | "nit";
  where: string[];
  field: string;
  problem: string;
  evidence: Evidence[];
  fix: string;
}

/** An `englishSchema` answer (mergeEnglish.ts puts it in place). */
export interface EnglishAnswer {
  label: string;
  summary: string;
  nodes: { id: string; title: string; question: string; gist: string }[];
  links: { from: string; to: string; note: string }[];
  contrasts: { id: string; title: string; note: string }[];
  tour: { step: number; title: string; text: string }[];
}

/** A `coverageSchema` answer (coverage.ts checks it). */
export interface CoverageAnswer {
  questions: {
    exam: number;
    page: number;
    question: string;
    quote: string;
    concepts: string[];
    missing: { need: string; taught: string; refs: Evidence[] }[];
  }[];
}

const KEYWORDS = new Set(["type", "description", "enum", "properties", "required", "additionalProperties", "items"]);
const TYPES = new Set(["object", "array", "string", "integer", "number", "boolean"]);
const FORBIDDEN_NAMES = new Set(["reasoning", "thinking"]);
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const fits = (v: unknown, type: string) => (type === "integer" ? Number.isInteger(v) : (type === "string" || type === "number" || type === "boolean") && typeof v === type);

/**
 * What keeps a schema from being one of ours (§4.0): a keyword outside the subset (so no unions,
 * nullables, $ref or constraints), a type other than one plain type, an object not closed or with
 * an optional field, an array without items, a bad enum, a field named reasoning or thinking, a
 * root that is not an object. Each problem names its place as a path; [] when there are none.
 */
export function lintSchema(schema: unknown): string[] {
  const problems: string[] = [];
  const visit = (s: unknown, path: string): void => {
    const at = path || "/";
    if (!isRecord(s)) {
      problems.push(`${at}: not a schema`);
      return;
    }
    for (const key of Object.keys(s)) if (!KEYWORDS.has(key)) problems.push(`${at}: ${key} is not allowed`);
    const type = s.type;
    if (typeof type !== "string" || !TYPES.has(type)) {
      problems.push(`${at}: type must be one of ${[...TYPES].join(", ")}, not ${JSON.stringify(type)}`);
      return;
    }
    if ("enum" in s) {
      const values = s.enum;
      if (!Array.isArray(values) || !values.length) problems.push(`${at}: enum must list values`);
      else {
        if (new Set(values).size !== values.length) problems.push(`${at}: enum repeats a value`);
        if (!values.every((v) => fits(v, type))) problems.push(`${at}: enum values must be of type ${type}`);
      }
    }
    if (type === "object") {
      if (s.additionalProperties !== false) problems.push(`${at}: additionalProperties must be false`);
      const props = s.properties;
      const required: unknown[] = Array.isArray(s.required) ? s.required : [];
      if (!isRecord(props)) problems.push(`${at}: an object needs properties`);
      else {
        for (const [name, sub] of Object.entries(props)) {
          if (FORBIDDEN_NAMES.has(name.toLowerCase())) problems.push(`${at}: no field may be named ${name}`);
          if (!required.includes(name)) problems.push(`${at}: ${name} is optional; every field must be required`);
          visit(sub, `${path}/properties/${name}`);
        }
        for (const name of required) if (typeof name !== "string" || !Object.hasOwn(props, name)) problems.push(`${at}: required ${String(name)} is not a field`);
      }
    } else if ("properties" in s || "required" in s || "additionalProperties" in s) problems.push(`${at}: fields belong to objects`);
    if (type === "array") {
      if (!("items" in s)) problems.push(`${at}: an array needs items`);
      else visit(s.items, `${path}/items`);
    } else if ("items" in s) problems.push(`${at}: items belong to arrays`);
  };
  if (isRecord(schema) && schema.type !== "object") problems.push("/: the root must be an object");
  visit(schema, "");
  return problems;
}

/** A `formulaDraftSchema` answer: one lecture range's formulas (draft.ts makes the sheet). */
export interface FormulaDraftAnswer {
  formulas: { id: string; concept: string; name: string; tex: string; note: string; trap: string; refs: PageRef[]; en: { name: string; note: string; trap: string } }[];
}

/**
 * Where a parsed answer does not fit its schema: a missing or extra field, a value of another type
 * or outside its enum, each with its path; [] when it fits. Strict output always fits; the runner
 * checks a call kept from an earlier run, or a mock's, before it trusts the answer types.
 */
export function misfits(schema: JsonSchema, value: unknown, path = ""): string[] {
  const at = path || "/";
  if (schema.enum && !schema.enum.includes(value as string)) return [`${at}: ${JSON.stringify(value)} is not in the enum`];
  if (schema.type === "object") {
    if (!isRecord(value)) return [`${at}: not an object`];
    const props = schema.properties ?? {};
    const keys = Object.keys(value);
    return [
      ...keys.filter((k) => !Object.hasOwn(props, k)).map((k) => `${at}: extra ${k}`),
      ...Object.keys(props).flatMap((k) => (Object.hasOwn(value, k) ? misfits(props[k], value[k], `${path}/${k}`) : [`${at}: missing ${k}`])),
    ];
  }
  if (schema.type === "array") return Array.isArray(value) ? value.flatMap((x, i) => misfits(schema.items!, x, `${path}/${i}`)) : [`${at}: not an array`];
  return fits(value, schema.type) ? [] : [`${at}: not ${schema.type === "integer" ? "an" : "a"} ${schema.type}`];
}
