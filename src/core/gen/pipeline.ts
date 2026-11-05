// The stages of a generation job (in-app generation, design §4.1–4.7; the user's cost decisions of
// 2026-10-27) as data, and where a job goes on after a crash, a cancel or an app update. Each stage
// leaves a checkpoint when it is done. A checkpoint is reused only while it was made with today's
// prompts, schemas and text extractor, after every stage it read — so a new PROMPT_VERSION reruns
// that stage and everything built on it, while the decks and digests cached per sha keep the
// reruns cheap. What a stage does is the runner's; this module only orders and versions them.

import { PROMPT_VERSION as COVERAGE } from "./prompts/coverage";
import { PROMPT_VERSION as ENGLISH } from "./prompts/english";
import { PROMPT_VERSION as FORMULAS } from "./prompts/formulas";
import { PROMPT_VERSION as READER } from "./prompts/reader";
import { PROMPT_VERSION as STRUCTURE } from "./prompts/structure";

export type PromptSet = "reader" | "structure" | "formulas" | "english" | "coverage";

/** Today's PROMPT_VERSION of each prompt module. */
export const PROMPT_VERSIONS: Readonly<Record<PromptSet, number>> = { reader: READER, structure: STRUCTURE, formulas: FORMULAS, english: ENGLISH, coverage: COVERAGE };

/**
 * The model a stage's calls use (the image pilot of 2026-10-27): `small` (Haiku 5.5) reads pages,
 * `mid` (Sonnet 5.5) re-reads the pages it missed, writes English and repairs mechanically, `main`
 * (Opus 5.5) only plans, writes and reviews the map and the sheet.
 */
export type ModelTier = "small" | "mid" | "main";
/** API effort: high and xhigh only to plan, write and review; low and medium to read pages, write English and repair mechanically. */
export type Effort = "low" | "medium" | "high" | "xhigh";

export type StageId =
  | "inventory"
  | "read"
  | "reread"
  | "anchors"
  | "blueprint"
  | "draft"
  | "check"
  | "coverage"
  | "lenses"
  | "factcheck"
  | "tour"
  | "verify"
  | "apply"
  | "recheck"
  | "english"
  | "formulaPages"
  | "formulaDraft"
  | "formulaCheck"
  | "formulaReview"
  | "formulaVerify"
  | "formulaApply"
  | "formulaRecheck"
  | "remap"
  | "patch"
  | "relink";

export interface Stage {
  id: StageId;
  /** The stages it reads: it starts when they are all done. */
  after: readonly StageId[];
  /**
   * null: code alone. Otherwise the prompts its calls are built from (their PROMPT_VERSION is part
   * of the stage's version), the model and the effort of every call it makes; `batch`: it may go
   * through the Message Batches API — half the price, but up to a day, not streamed (no heartbeat)
   * and without the transport's fallbacks, which Batches reject, so a refusal fails the call. Only
   * for the sheet of a job whose map comes first: nobody waits on it while they read the map.
   */
  ai: { prompts: PromptSet; tier: ModelTier; effort: Effort; batch: boolean } | null;
  /** Its result depends on the page-text extractor. */
  extractsText?: true;
}

const main = (prompts: PromptSet, effort: Effort, batch = false): Stage["ai"] => ({ prompts, tier: "main", effort, batch });
const mid = (prompts: PromptSet, effort: Effort): Stage["ai"] => ({ prompts, tier: "mid", effort, batch: false });

const INVENTORY: Stage = { id: "inventory", after: [], ai: null, extractsText: true };
/**
 * Every page once, its picture only where the text cannot carry it; then once more, by a stronger
 * model, the pages whose reading fails code's checks (reading.ts): read twice or not at all, a formula
 * that does not render, a title not on its page, no formula or figure where code expected one.
 */
const READING: readonly Stage[] = [
  { id: "read", after: ["inventory"], ai: { prompts: "reader", tier: "small", effort: "low", batch: false } },
  { id: "reread", after: ["read"], ai: mid("reader", "medium") },
];

/**
 * From a checked map to the final one with English: the review, verify and apply loop of a build
 * and of an update. `apply` carries out the verified findings and runs the diff check on them;
 * `recheck` then checks and repairs the applied map the way `check` did the draft.
 */
const REVIEW: readonly Stage[] = [
  { id: "coverage", after: ["check"], ai: main("coverage", "high") },
  { id: "lenses", after: ["check"], ai: main("structure", "xhigh") },
  { id: "factcheck", after: ["check"], ai: main("structure", "high") },
  { id: "tour", after: ["check"], ai: main("structure", "high") },
  { id: "verify", after: ["coverage", "lenses", "factcheck", "tour"], ai: main("structure", "high") },
  { id: "apply", after: ["verify"], ai: main("structure", "high") },
  { id: "recheck", after: ["apply"], ai: mid("structure", "medium") },
  { id: "english", after: ["recheck"], ai: mid("english", "medium") },
];

/**
 * The knowledge map, I to M7: inventory (code), page reading and re-reading, anchors and targets (code),
 * blueprint, draft, checks and repair, then the coverage test, the lenses, the fact-check per
 * thread and the tour check side by side, verify, apply with its diff check, checks and repair
 * again, English.
 */
export const MAP_STAGES: readonly Stage[] = [
  INVENTORY,
  ...READING,
  { id: "anchors", after: ["reread"], ai: null },
  { id: "blueprint", after: ["anchors"], ai: main("structure", "xhigh") },
  { id: "draft", after: ["blueprint"], ai: main("structure", "xhigh") },
  { id: "check", after: ["draft"], ai: mid("structure", "medium") },
  ...REVIEW,
];

/**
 * The formula sheet, F1 to F5, on the map's final concepts (beside the English): formula pages
 * (code), drafts per lecture range, checks and repair, review per pair of lectures, verify, apply
 * with its diff check, checks and repair again. `batch`: the drafts, reviews and verifies may go
 * through Batches (`Stage.ai`).
 */
const sheetStages = (batch: boolean): readonly Stage[] => [
  { id: "formulaPages", after: ["reread", "recheck"], ai: null },
  { id: "formulaDraft", after: ["formulaPages"], ai: main("formulas", "xhigh", batch) },
  { id: "formulaCheck", after: ["formulaDraft"], ai: mid("formulas", "medium") },
  { id: "formulaReview", after: ["formulaCheck"], ai: main("formulas", "high", batch) },
  { id: "formulaVerify", after: ["formulaReview"], ai: main("formulas", "high", batch) },
  { id: "formulaApply", after: ["formulaVerify"], ai: main("formulas", "high") },
  { id: "formulaRecheck", after: ["formulaApply"], ai: mid("formulas", "medium") },
];

/** The sheet after the map in a build or an update: the student reads the map candidate meanwhile, so it may be batched. */
export const SHEET_STAGES: readonly Stage[] = sheetStages(true);

/** One click: the map, then the sheet on it. */
export const BUILD_STAGES: readonly Stage[] = [...MAP_STAGES, ...SHEET_STAGES];

/** 「生成公式表…」 beside an adopted map: inventory and reading (cache hits), then the sheet on the adopted map — the one thing the student waits for, so never batched. */
export const SHEET_ONLY_STAGES: readonly Stage[] = [INVENTORY, ...READING, ...sheetStages(false)];

/**
 * Folding new or re-uploaded lectures into an adopted map and sheet (§4.6): inventory and reading
 * of the new decks, refs moved to a re-uploaded deck's pages, the patch call, then the same
 * review loop, English and sheet stages as a build, limited by the runner to what changed.
 */
export const UPDATE_STAGES: readonly Stage[] = [
  INVENTORY,
  ...READING,
  { id: "remap", after: ["reread"], ai: mid("structure", "medium") },
  { id: "patch", after: ["remap"], ai: main("structure", "xhigh") },
  { id: "check", after: ["patch"], ai: mid("structure", "medium") },
  ...REVIEW,
  ...SHEET_STAGES,
];

/**
 * 重新生成 (§4.6, D12): the whole map again, the earlier map's concepts given to the blueprint, then
 * `relink` (code): matchIds pairs the new concepts with the old one to one, the matched keep their
 * old ids, and the course's adopted sheet follows them (relinkFormulas); formulas whose concept went
 * are listed, for 「重新生成公式表」. No sheet is drafted: the sheet's own 重新生成 is that.
 */
export const REGENERATE_STAGES: readonly Stage[] = [...MAP_STAGES, { id: "relink", after: ["english"], ai: null }];

/** What a checkpoint must have been made with: each prompt module's version, the schemas' and the text extractor's. */
export interface Versions {
  prompts: Readonly<Record<PromptSet, number>>;
  /** The structured-output schemas, which shape every checkpoint. */
  schema: number;
  extractor: number;
}

/** A stage's version: its checkpoint is reused only when it was made with the same. */
export function stageVersion(stage: Stage, v: Versions): string {
  const parts = [`schema ${v.schema}`];
  if (stage.extractsText) parts.push(`extractor ${v.extractor}`);
  if (stage.ai) parts.push(`${stage.ai.prompts} ${v.prompts[stage.ai.prompts]}`);
  return parts.join(", ");
}

/** What a finished stage leaves for resuming, beside its result. */
export interface Checkpoint {
  version: string;
  /** Order of writing within the job: a checkpoint older than one it read is stale. */
  seq: number;
}

export type Checkpoints = Readonly<Partial<Record<StageId, Checkpoint>>>;

/** The checkpoint to write when `stage` is done: today's version, written after every checkpoint so far. */
export function checkpoint(stage: Stage, checkpoints: Checkpoints, v: Versions): Checkpoint {
  const seq = Math.max(0, ...Object.values(checkpoints).map((c) => c?.seq ?? 0)) + 1;
  return { version: stageVersion(stage, v), seq };
}

/**
 * The stages whose checkpoints can be reused: made with today's versions, and later than the
 * checkpoints of the stages it read, which are reusable too. `stages` in run order. A stage read
 * that is not in `stages` is an input the job brings (the adopted map of a sheet-only job).
 */
export function doneStages(stages: readonly Stage[], checkpoints: Checkpoints, v: Versions): Set<StageId> {
  const inJob = new Set(stages.map((s) => s.id));
  const done = new Set<StageId>();
  for (const s of stages) {
    const c = checkpoints[s.id];
    const fresh = !!c && c.version === stageVersion(s, v);
    if (fresh && s.after.every((d) => !inJob.has(d) || (done.has(d) && checkpoints[d]!.seq < c.seq))) done.add(s.id);
  }
  return done;
}

/** The stages that can run now, in run order: not done, and every stage they read done. */
export function readyStages(stages: readonly Stage[], checkpoints: Checkpoints, v: Versions): Stage[] {
  const inJob = new Set(stages.map((s) => s.id));
  const done = doneStages(stages, checkpoints, v);
  return stages.filter((s) => !done.has(s.id) && s.after.every((d) => !inJob.has(d) || done.has(d)));
}

/** The next stage to run (resuming a job, or after one finished); null when the job is done. */
export function nextStage(stages: readonly Stage[], checkpoints: Checkpoints, v: Versions): Stage | null {
  return readyStages(stages, checkpoints, v)[0] ?? null;
}
