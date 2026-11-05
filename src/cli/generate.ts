#!/usr/bin/env node
// lecnote-gen: run the first stages of LecNote's one-click course generation on Meta models.
//
//   Stage R   read every page            Muse Spark 1.3, effort low     → code checks each reading
//   Stage R'  re-read failed pages        Muse Spark 1.3, effort medium  → code checks again
//   Stage M2a plan the course map         Muse Wonder,    effort high    → code checks the plan,
//                                                                          one repair round on Wonder
//
// Usage:
//   META_API_KEY=… npx tsx src/cli/generate.ts samples/course.json        # real calls to Meta
//   npx tsx src/cli/generate.ts samples/course.json --mock                 # saved answers, no key
//   options: --out <dir> (default out/), --budget <usd> (default 2.00)

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import katex from "katex";
import { buildBundle, marker, stepInput, type Digests, type Inventory, type PageDigest, type Part } from "../core/gen/bundle";
import { checkBlueprint, type BlueprintContext } from "../core/gen/blueprint";
import type { Deck, Issue, PageAt } from "../core/gen/checkStructure";
import { structureTargets } from "../core/gen/limits";
import { readPages } from "../core/gen/prompts/reader";
import { blueprint as blueprintPrompt } from "../core/gen/prompts/structure";
import { mergeReadings, readingIssues, rereadPages } from "../core/gen/reading";
import { blueprintSchema, digestSchema, misfits, type BlueprintAnswer, type JsonSchema } from "../core/gen/schemas";
import { MetaTransport, MockTransport, type Effort, type GenResult, type Transport } from "../meta/client";
import { modelFor } from "../meta/models";
import type { ModelTier } from "../core/gen/pipeline";

interface SampleCourse {
  title: string;
  lectures: { no: number; title: string; file: string; pages: { page: number; text: string; image?: string | null; figure?: boolean }[] }[];
  exams: Inventory["exams"];
  note: string;
}

interface LedgerRow {
  purpose: string;
  model: string;
  effort: Effort;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
  seconds: number;
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const VALUE_OPTIONS = new Set(["--out", "--budget"]);
const coursePath = args.find((a, i) => !a.startsWith("--") && !VALUE_OPTIONS.has(args[i - 1] ?? "")) ?? "samples/course.json";
const outDir = option("--out", "out");
const budget = Number(option("--budget", "2.00"));
const mock = flag("--mock");

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const log = (s: string) => process.stdout.write(`${s}\n`);
const ledger: LedgerRow[] = [];
const answers: Record<string, unknown> = {};
const spent = () => ledger.reduce((t, r) => t + r.costUsd, 0);

async function ask<T>(t: Transport, purpose: string, tier: ModelTier, effort: Effort, prompt: { system: string; instruction: string }, parts: readonly Part[], schema: JsonSchema): Promise<T> {
  if (spent() >= budget) throw new Error(`budget of $${budget.toFixed(2)} reached before ${purpose}`);
  const model = modelFor(tier);
  log(`  → ${purpose.padEnd(22)} ${model.id} (${effort})`);
  const r: GenResult = await t.call({ purpose, prompt, parts, schema, model, effort });
  ledger.push({ purpose, model: r.model, effort, inputTokens: r.inputTokens, cachedTokens: r.cachedTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, seconds: r.ms / 1000 });
  const value = JSON.parse(r.text) as T;
  const off = misfits(schema, value);
  if (off.length) throw new Error(`${purpose}: answer does not fit its schema: ${off.slice(0, 3).join("; ")}`);
  answers[purpose] = value;
  log(`    ✓ ${r.inputTokens} in (${r.cachedTokens} cached) / ${r.outputTokens} out · $${r.costUsd.toFixed(4)} · ${(r.ms / 1000).toFixed(1)} s`);
  return value;
}

/** Renders LaTeX as the app does (display mode): null when it renders, else KaTeX's error. */
const renderTex = (tex: string, display: boolean): string | null => {
  try {
    katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: "ignore" });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

const showIssues = (issues: readonly Issue[]) => {
  for (const i of issues.slice(0, 8)) log(`    ! ${i.where}: ${i.message}`);
  if (issues.length > 8) log(`    … ${issues.length - 8} more`);
};

async function main() {
  const course = JSON.parse(await readFile(coursePath, "utf8")) as SampleCourse;
  const transport: Transport = mock
    ? new MockTransport(JSON.parse(await readFile("samples/mock-answers.json", "utf8")) as Record<string, unknown>)
    : new MetaTransport(process.env.META_API_KEY ?? "", dirname(resolve(coursePath)));

  const inventory: Inventory = {
    lectures: course.lectures.map((l) => ({
      no: l.no,
      title: l.title,
      file: l.file,
      sha256: sha(l.pages.map((p) => p.text).join("\f")),
      pages: l.pages.map((p) => ({ page: p.page, text: p.text, image: p.image ?? null, figure: p.figure ?? false })),
    })) as Inventory["lectures"],
    exams: course.exams,
    examFiles: [],
    note: course.note,
  };
  const m = mock ? "m-0000000000000000" : marker();
  log(`LecNote one-click generation on Meta models — ${course.title}`);
  log(`${inventory.lectures.length} lectures, ${inventory.lectures.reduce((n, l) => n + l.pages.length, 0)} pages · ${mock ? "MOCK (saved answers)" : "Meta Model API"} · budget $${budget.toFixed(2)}\n`);

  // Stage R: read every page, then code checks every reading; failed pages are read again on a stronger setting.
  log("Stage R — read every page (Muse Spark 1.3)");
  const digests: Record<string, PageDigest[]> = {};
  for (const l of inventory.lectures) {
    const pages = l.pages.map((p) => p.page);
    const prompt = readPages({ deck: `L${l.no}`, pages, images: l.pages.filter((p) => p.image).map((p) => p.page) });
    const parts = buildBundle(inventory, {}, { marker: m, lectures: [l.no], images: true, examFiles: false });
    const read = await ask<{ pages: PageDigest[] }>(transport, `gen.read.L${l.no}`, "small", "low", prompt, parts, digestSchema);
    let digest = read.pages;
    const issues = readingIssues(l.pages, digest, renderTex);
    log(`    code checks: ${issues.length ? `${issues.length} issue(s)` : "all pages pass"}`);
    showIssues(issues);
    const again = rereadPages(issues);
    if (again.length) {
      const prompt2 = readPages({ deck: `L${l.no}`, pages: again, images: [], retry: true });
      const parts2 = [...buildBundle(inventory, {}, { marker: m, lectures: [l.no], pages: { [l.no]: again }, images: true, examFiles: false }), stepInput(m, "issues", issues.filter((i) => again.includes(i.page)))];
      const reread = await ask<{ pages: PageDigest[] }>(transport, `gen.reread.L${l.no}`, "mid", "medium", prompt2, parts2, digestSchema);
      digest = mergeReadings(l.pages, digest, reread.pages);
      const left = readingIssues(l.pages, digest, renderTex);
      log(`    after re-reading: ${left.length ? `${left.length} issue(s) left` : "all pages pass"}`);
    }
    digests[l.sha256] = digest;
  }

  // Stage M2a: plan the whole course's map across lectures; code checks the plan against the slides.
  log("\nStage M2a — plan the course map across lectures (Muse Wonder)");
  const totalPages = inventory.lectures.reduce((n, l) => n + l.pages.length, 0);
  const targets = structureTargets(totalPages, inventory.lectures.length);
  const decks: Deck[] = inventory.lectures.map((l) => ({ no: l.no, file: l.file, sha256: l.sha256, pages: l.pages.length, title: l.title, texts: l.pages.map((p) => p.text) }));
  const roadmapPages: PageAt[] = inventory.lectures.flatMap((l) =>
    (digests[l.sha256] ?? []).filter((d) => d.roadmapItems.length || d.kind === "outline" || d.kind === "recap").map((d) => ({ lecture: l.no, page: d.page })),
  );
  const ctx: BlueprintContext = { decks, roadmapPages, targets };
  const bundle = buildBundle(inventory, digests as Digests, { marker: m, images: false, examFiles: false });
  const mapTargets = { concepts: targets.concepts, links: targets.links, contrasts: targets.contrasts };
  let plan = await ask<BlueprintAnswer>(transport, "gen.map.blueprint", "main", "high", blueprintPrompt({ targets: mapTargets, previous: false }), bundle, blueprintSchema);
  let issues = checkBlueprint(plan, ctx);
  log(`    code checks: ${issues.length ? `${issues.length} issue(s)` : "the plan passes"}`);
  showIssues(issues);
  if (issues.some((i) => i.severity === "error")) {
    const parts = [...bundle, stepInput(m, "blueprint", plan), stepInput(m, "issues", issues)];
    plan = await ask<BlueprintAnswer>(transport, "gen.map.blueprint.repair", "main", "high", blueprintPrompt({ targets: mapTargets, previous: false, retry: true }), parts, blueprintSchema);
    issues = checkBlueprint(plan, ctx);
    log(`    after repair: ${issues.length ? `${issues.length} issue(s) left` : "the plan passes"}`);
    showIssues(issues);
  }

  // Output: the readings, the plan, the cost ledger, and the answers (to replay with --mock).
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "readings.json"), JSON.stringify(digests, null, 2));
  await writeFile(join(outDir, "blueprint.json"), JSON.stringify(plan, null, 2));
  await writeFile(join(outDir, "ledger.json"), JSON.stringify(ledger, null, 2));
  await writeFile(join(outDir, "answers.json"), JSON.stringify(answers, null, 2));

  log("\nCourse map plan");
  for (const th of plan.threads) {
    log(`  ● ${th.title}  [${th.origin}]`);
    for (const st of plan.strands.filter((s) => s.parent === th.id)) {
      log(`    ○ ${st.title}`);
      for (const c of plan.concepts.filter((c) => c.parent === st.id)) log(`      · ${c.term}  (L${c.homeLecture} p${c.homePage})`);
    }
  }
  const secs = ledger.reduce((t, r) => t + r.seconds, 0);
  log(`\n${ledger.length} model calls · $${spent().toFixed(4)} · ${secs.toFixed(1)} s of model time · written to ${outDir}/`);
}

main().catch((e: unknown) => {
  process.stderr.write(`\nerror: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
