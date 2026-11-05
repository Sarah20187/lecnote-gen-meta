// The Meta Model API transport for the generation pipeline.
//
// Every model call of the pipeline is a GenRequest (system prompt, course material as tagged parts,
// the answer's JSON schema, a reasoning effort). This sends it to Meta's OpenAI-compatible Chat
// Completions endpoint with structured output (`response_format: json_schema`), so the answer is
// constrained to the schema the core checks next. Usage, cached tokens and cost go to the ledger.

import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { Part } from "../core/gen/bundle";
import type { Prompt } from "../core/gen/prompts/structure";
import { costUsd, type MetaModel } from "./models";

export const META_BASE_URL = process.env.META_BASE_URL ?? "https://api.meta.ai/v1";

export type Effort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface GenRequest {
  /** "gen.read", "gen.map.blueprint", …: what the call is for, in the ledger. */
  purpose: string;
  prompt: Prompt;
  /** Course material (core bundle.ts) and the step's own inputs. Image paths are relative to `imageRoot`. */
  parts: readonly Part[];
  /** The answer's JSON schema (core gen/schemas.ts). */
  schema: object;
  model: MetaModel;
  effort: Effort;
  /** Includes reasoning tokens on Meta. */
  maxCompletionTokens?: number;
}

export interface GenResult {
  text: string;
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
}

export interface Transport {
  call(req: GenRequest): Promise<GenResult>;
}

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/** Turn the core's parts into Chat Completions content: text merged, images as data URLs, cache breaks dropped (Meta caches prefixes automatically). */
async function content(parts: readonly Part[], instruction: string, imageRoot: string): Promise<ContentPart[]> {
  const out: ContentPart[] = [];
  const say = (text: string) => {
    const last = out.at(-1);
    if (last?.type === "text") last.text += text;
    else out.push({ type: "text", text });
  };
  for (const p of parts) {
    if (p.type === "text") say(p.text);
    else if (p.type === "image") {
      const file = resolve(imageRoot, p.path);
      const b64 = (await readFile(file)).toString("base64");
      out.push({ type: "image_url", image_url: { url: `data:${MIME[extname(file).toLowerCase()] ?? "image/png"};base64,${b64}` } });
    }
  }
  say(`\n${instruction}`);
  return out;
}

export class MetaTransport implements Transport {
  constructor(
    private readonly apiKey: string,
    private readonly imageRoot = process.cwd(),
    private readonly baseUrl = META_BASE_URL,
  ) {
    if (!apiKey) throw new Error("META_API_KEY is not set");
  }

  async call(req: GenRequest): Promise<GenResult> {
    const body = {
      model: req.model.id,
      messages: [
        { role: "system", content: req.prompt.system },
        { role: "user", content: await content(req.parts, req.prompt.instruction, this.imageRoot) },
      ],
      response_format: { type: "json_schema", json_schema: { name: req.purpose.replace(/[^a-zA-Z0-9_-]/g, "_"), schema: req.schema } },
      reasoning_effort: req.effort,
      ...(req.maxCompletionTokens ? { max_completion_tokens: req.maxCompletionTokens } : {}),
    };
    const started = Date.now();
    let last = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          model?: string;
          choices: { message: { content: string | null; refusal?: string | null } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
        };
        const msg = json.choices[0]?.message;
        if (!msg?.content) throw new Error(`${req.purpose}: no answer${msg?.refusal ? ` (refused: ${msg.refusal})` : ""}`);
        const usage = {
          inputTokens: json.usage?.prompt_tokens ?? 0,
          cachedTokens: json.usage?.prompt_tokens_details?.cached_tokens ?? 0,
          outputTokens: json.usage?.completion_tokens ?? 0,
        };
        return { text: msg.content, model: json.model ?? req.model.id, ...usage, costUsd: costUsd(req.model, usage), ms: Date.now() - started };
      }
      last = `${res.status} ${await res.text()}`;
      if (res.status !== 429 && res.status < 500) break;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    throw new Error(`${req.purpose}: Meta API ${last}`);
  }
}

/** Replays saved answers by purpose: lets anyone run the pipeline without an API key (judges, CI). */
export class MockTransport implements Transport {
  constructor(private readonly answers: Readonly<Record<string, unknown>>) {}
  async call(req: GenRequest): Promise<GenResult> {
    const a = this.answers[req.purpose];
    if (a === undefined) throw new Error(`mock: no saved answer for ${req.purpose}`);
    return { text: JSON.stringify(a), model: `${req.model.id} (mock)`, inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0, ms: 0 };
  }
}
