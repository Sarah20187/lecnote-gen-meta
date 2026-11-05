// Which Meta model does which stage of the generation pipeline, and what it costs.
// Prices: Meta Model API pricing page (dev.meta.ai/docs/pricing-rate-limits), US$ per million tokens.

import type { ModelTier } from "../core/gen/pipeline";

export interface MetaModel {
  id: string;
  input: number;
  cachedInput: number;
  output: number;
}

export const MUSE_SPARK: MetaModel = { id: "muse-spark-1.3", input: 1.25, cachedInput: 0.15, output: 4.25 };
export const MUSE_WONDER: MetaModel = { id: "muse-wonder-1.0", input: 4.0, cachedInput: 0.2, output: 20.0 };

/**
 * The pipeline's three tiers on Meta:
 * - small (reading every page): Muse Spark 1.3 — high volume, multimodal, low effort
 * - mid (re-reading failed pages, repairs, checks): Muse Spark 1.3 at a higher effort
 * - main (planning, drafting, reviewing the whole course): Muse Wonder
 * Set LECNOTE_MAIN_MODEL=muse-spark-1.3 where Muse Wonder (preview) is not available.
 */
export function modelFor(tier: ModelTier): MetaModel {
  if (tier !== "main") return MUSE_SPARK;
  const override = process.env.LECNOTE_MAIN_MODEL;
  if (override === MUSE_SPARK.id) return MUSE_SPARK;
  return MUSE_WONDER;
}

export function costUsd(model: MetaModel, u: { inputTokens: number; cachedTokens: number; outputTokens: number }): number {
  const fresh = Math.max(0, u.inputTokens - u.cachedTokens);
  return (fresh * model.input + u.cachedTokens * model.cachedInput + u.outputTokens * model.output) / 1_000_000;
}
