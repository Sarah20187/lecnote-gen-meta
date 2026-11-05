# LecNote one-click course generation on Meta models

**Turn a course's lecture slides into a knowledge map where every concept points to the slide page that defines it, with the model's output checked by code at every step. Runs on Muse Spark 1.3 and Muse Wonder.**

Meta Global AI Developer Hackathon · Indie Developer track · Build for Your World

---

## What was pre-existing and what was built during the hackathon

| | |
|---|---|
| **Pre-existing (not in this repo)** | **LecNote**, my private macOS app for typing notes on lecture PDFs (started Oct 16, 2026): the PDF reader, the lecture library, the course page, the "Ask AI" panel. |
| **Built during the hackathon (this repo)** | The **one-click generation pipeline** that builds a course's knowledge map and formula sheet from its slides (Oct 26 onward), and moving it onto **Meta's models**: the Meta Model API transport, the command-line runner and the sample course (Nov 4). |

All code in `src/` was written during the event. The only exceptions are two small pieces that were **re-declared** here so the repo runs on its own, instead of copying pre-existing files: the `ExamInfo` type (`src/core/course.ts`) and a lecture-title helper (`src/core/library.ts`). The desktop app's generation screens, which call the pipeline inside LecNote, stay in the private app. No pre-hackathon code or git history is included.

## The problem

A course is a dozen lectures and hundreds of slides. Before an exam I want one map of the whole course: the main threads, the concepts under each, and for every concept the page where the lecturer defines it. AI summaries are easy to get but hard to trust, because you can't check them against the slides. This pipeline makes every claim checkable: each concept has a home page, and code checks the model's output against the slide text before anything is kept.

## How Meta's models are used

The pipeline gives each stage to the model that fits it, and puts a code check after every model call. When a check fails, the problem goes back to a model as a repair task.

| Stage | What it does | Meta model | Reasoning effort | Checked by code |
|---|---|---|---|---|
| R | Read every slide page: kind, title, formulas in LaTeX, figure, terms, outline items | **Muse Spark 1.3** | low | every page answered once, titles appear on the page, formulas present where expected (`reading.ts`) |
| R′ | Re-read only the pages that failed the checks, with the failures attached | **Muse Spark 1.3** | medium | same checks again, readings merged (`mergeReadings`) |
| M2a | Plan the course map across lectures: threads, strands, concepts and each concept's home page | **Muse Wonder** | high | ids, sizes, home pages exist, branches anchored on outline/recap pages (`blueprint.ts`) |
| M2a′ | Repair the plan when code finds errors | **Muse Wonder** | high | same checks again |

- Every call uses **structured output** (`response_format: json_schema`) with the schemas in `src/core/gen/schemas.ts`, and the answer is also checked against the schema in code (`misfits`).
- Slide text goes in inside randomly named tags, and the prompts state that tag content is data, not instructions (`bundle.ts`), as a guard against prompt injection from slide content.
- Pages whose text layer can't carry the content (garbled maths, figures) can be sent as images to Muse Spark 1.3 (multimodal). The sample course here is text-only.
- Every call's tokens, cached tokens and cost go to a ledger (`out/ledger.json`). The run stops at a spending limit (`--budget`).
- If Muse Wonder (preview) isn't available in your region, set `LECNOTE_MAIN_MODEL=muse-spark-1.3`.

The full pipeline in the app has 22 stages (15 for the map, 7 for the formula sheet), including drafting, multi-angle review, fact-checking of review comments, an English version, and the formula sheet. All their prompts, schemas and checks are in `src/core/gen/`. The command-line runner here runs the first stages end to end on Meta.

## Run it

Requires Node 20+.

```bash
npm install

# 1. Without an API key: replays the answers Meta's models gave in the recorded run below,
#    and runs all the code checks on them
npm run demo:mock

# 2. On Meta's models
export META_API_KEY=...        # from dev.meta.ai
npm run generate               # writes out/: readings.json, blueprint.json, ledger.json, answers.json

# tests of the core (checks, repairs, schemas, prompts)
npm test
npm run typecheck
```

Options: `npx tsx src/cli/generate.ts <course.json> --budget 2.00 --out out`.
To run your own course, write a `course.json` like `samples/course.json`: one entry per lecture, with each page's text.

## A recorded run on Meta's models

`runs/2026-11-04-meta/` holds a real run on the sample course (2 lectures, 10 pages), Nov 4, 2026:

| Call | Model | Effort | Tokens in / out | Cost | Time |
|---|---|---|---|---|---|
| read L1 | muse-spark-1.3 | low | 1,467 / 1,319 | $0.0074 | 11.9 s |
| read L2 | muse-spark-1.3 | low | 1,538 / 2,085 | $0.0108 | 19.6 s |
| plan the map | muse-wonder-1.0 | high | 3,752 / 4,665 | $0.1083 | 29.4 s |
| repair the plan | muse-wonder-1.0 | high | 5,383 / 3,410 | $0.0897 | 19.5 s |

Every page reading passed the code checks. Wonder's first plan matched its JSON schema but failed 19 structural checks, mostly concepts not attached to any branch. One repair call fixed all of them: the final plan has 3 threads, 7 strands, 17 concepts (each with a home page) and a 12-step tour. Total: 4 calls, $0.22, 80 s of model time. `npm run demo:mock` replays exactly these answers.

## Repository layout

```
src/meta/client.ts      Meta Model API transport: Chat Completions + json_schema + reasoning_effort, retries, usage and cost   [Nov 4]
src/meta/models.ts      which Meta model runs which tier, and Meta's prices                                                       [Nov 4]
src/cli/generate.ts     the command-line runner: read → check → re-read → plan → check → repair, with a cost ledger              [Nov 4]
src/core/gen/           the generation core: stages, prompts, schemas, checks, automatic repairs, patch ops, remapping, diffs   [Oct 27–28]
src/core/structure.ts   the knowledge-map format                                                                                  [Oct 26]
src/core/formulas.ts    the formula-sheet format                                                                                  [Oct 27]
samples/course.json     a small original sample course (2 lectures, 10 pages), written for this repo
samples/mock-answers.json  the answers of the recorded Meta run, replayed by the mock mode
runs/2026-11-04-meta/   the recorded run: readings, plan, answers, cost ledger
```

## Where this code comes from

The generation core was written in LecNote's private repository during the event and copied here without its history. These are its commits (US Eastern time):

| Date | Commit | |
|---|---|---|
| Oct 26 12:00 | `b027859` | the course knowledge map format and viewer |
| Oct 27 10:38 | `1c7b1f0` | the formula sheet |
| Oct 27 16:45 | `ab989c0` | groundwork: format specs and checkers |
| Oct 27 17:40 | `6e200b7` | the pure core: checks, patch ops, schemas, prompts, stages |
| Oct 27 18:49 | `d0b5fbc` | every build stage run end to end on canned answers |
| Oct 27 21:23 | `ea7ffac` | transport and page inventory (desktop app) |
| Oct 27 23:04 | `f6d2939` | the job runner, the map and sheet pipelines (desktop app) |
| Oct 28 02:15 | `690853b` | the generation UI (desktop app) |
| Nov 4 | this repo | the Meta transport, the CLI runner and the sample course |

Not included: the lecture slides and hand-made maps of the real course I tested on, because they are my lecturer's copyrighted material, and the pre-existing LecNote app.

## License

MIT, see `LICENSE`.
