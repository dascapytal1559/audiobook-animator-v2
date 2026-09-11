# Agent-ergonomics review of the animator-v2 architecture

Written 2026-09-09 by the lead agent. This is a review, not a change set. Nothing in `src/`, `config/`, `data/`, or the top-level documents was modified. `AGENTS.md` is human-edited only; section 7 is a suggestion for it.

## 1. The brief

The original prompt asked an agent to redesign plans and design documents for agent ergonomics. Adapted to a review of an existing repository, the brief is:

> Think deeply about how agent-intuitive, agent-ergonomic, and agent-accretive this repository already is, and where it is not. Put yourself in the driver's seat: you are the agent who will open this repo cold next session and be asked to advance it. What would most enable you to understand the situation accurately, control the system precisely, and produce correct results with the least expenditure of tokens, tool calls, and wall-clock? Review the code, data layout, configuration, tooling, and documents as one synthetic system rather than a collection of parts. Judge whether it forms a coherent, cohesive, modular, interconnected tower of linked abstractions that is legible to an agent. Report what already serves that goal, what taxes it, and the smallest set of changes that would make the whole more legible, more controllable, and more accretive across sessions. Recommend; do not modify.

Three words carry the weight:

- **Intuitive**: can I predict where a thing lives, what it is called, and what will happen if I run it, without reading everything?
- **Ergonomic**: how many hops, files, and commands separate an intent from its effect? How much must I hold in working memory?
- **Accretive**: does each session leave the next one better off, or does knowledge evaporate into chat history?

## 2. What was read

Every file under `src/`, `packages/editor/src/`, `config/`, `scripts/`, and `docs/`, both top-level documents, the story manifest and overlay files for The Great Silence, the book artifacts for Exhalation, the git log, and the dev-server logs. Both test suites were run and pass.

| Suite | Tests | Result |
| --- | --- | --- |
| root (`pnpm test`) | 125 | pass |
| editor (`pnpm --filter editor test`) | 45 | pass |

## 3. The system as it stands

One sentence: audiobooks are hashed, transcribed once as a whole, split into hash-pinned story directories, and each story directory then accumulates overlays (shots, decisions, word-timing) that an HTTP server merges for a browser editor and a set of CLIs.

The module import graph, computed from `src/modules/*/`:

```text
source-media        <- transcription, story-audio, story-split
transcription       <- story-split, story-planning, visual-timeline, editor-server
story-audio         <- story-split, story-planning
story-split         <- story-planning
story-planning      <- story-inventory, visual-timeline, word-timing, editor-server
visual-timeline     <- word-timing, editor-server
word-timing         <- editor-server
editor-server       <- (entry points only)
```

Read as layers, this is already a tower:

| Layer | Concern | Modules |
| --- | --- | --- |
| L0 | bytes, hashes, bounded IO, atomic writes | `source-media`, `story-planning/io.ts` |
| L1 | book-level artifacts | `transcription`, `story-audio` |
| L2 | the story as a verified unit | `story-split`, `story-planning`, `story-inventory` |
| L3 | per-story overlays | `visual-timeline`, `word-timing` |
| L4 | surfaces | `editor-server`, nine CLI entry files, `packages/editor` |

The tower is real in the code. It is not advertised anywhere, and its base is misnamed (section 5.4).

## 4. What already serves an agent

This repo is unusually legible. The following should be kept and named as conventions, because they are the reason a cold agent can trust what it reads.

- **One `contracts.ts` per module, Effect Schemas as the contract.** Q19's rule "the schema is the contract, the CLI is a convenience" is honoured. An agent can read a schema and write a valid file without running anything.
- **Hash-pinned identity on every artifact.** `ClipIdentity` on records, decisions, and overlays. A stale or misfiled artifact fails with a message naming the file. This is the single most agent-protective property in the system: it converts silent corruption into loud, located errors.
- **Two-writer rule, stated per file.** Records are immutable and script-written; decisions are editor-or-CLI; auto timing is script-only; manual timing is editor-only. The transcript is never written. An agent knows exactly which file it may touch.
- **Decision IDs cited from code.** JSDoc references like `(A51)` appear 24 distinct times across `src/` and the client. That is a live link from implementation to rationale. Few repos have this.
- **Explicit limits and pins everywhere.** No hidden defaults, exact versions, `verifyDepsBeforeRun: error`. An agent never has to guess what a run will do.
- **Errors that name the file and the rule.** Every failure path says which path, which field, which bound.
- **Atomic writes, bounded reads, change detection during read.** `io.ts` is small and correct.
- **Deterministic seed import.** Re-running the seed is a no-op that reports drift. This is the accretive pattern the rest of the pipeline should copy.
- **A mock server, a process manager that verifies ownership before signalling, and colocated tests.** Verification is cheap.
- **PIPELINE.md's Q/A/B numbering.** Questions, assumptions, and backlog items have stable IDs with dates. This is the accretive spine of the project.

## 5. Findings, ranked by leverage

Each finding gives the observation, why it costs an agent, and the recommendation.

### 5.1 The authority file is empty

`AGENTS.md` is 0 bytes. `PIPELINE.md` says agent workflow instructions live there. The user's global rules say it is the only file with authority. Every convention listed in section 4 is followed in the code and stated in no authoritative place.

Cost: a cold agent must read roughly 80 KB of prose across `README.md` and `PIPELINE.md`, then the code, to infer rules it could have been told in 60 lines. That is on the order of 30k tokens of orientation per session before any work starts, and any rule not inferred is a rule that may be broken.

Recommendation: populate `AGENTS.md` with a map, the conventions, the hard rules, the commands, and the gotchas. Section 7 drafts it. This is the highest-leverage change in the repo and it is a documentation change only.

### 5.2 There is no situation report

To answer "where is the pilot up to?" today I ran three CLIs with three different configs, read the story directory listing, opened `decisions.json`, and inspected the auto overlay's `runs` array. Nothing prints the state of a story, let alone of all seventeen.

Cost: every planning session re-derives state by hand. Mistakes here are the expensive kind: acting on a stale picture.

Recommendation: add one read-only command, for example `animator status [--story <id>]`, that prints JSON per story:

```json
{
  "id": "the-great-silence",
  "verified": true,
  "durationSeconds": 489.99,
  "wordTiming": { "auto": { "coverage": 1.0, "runs": 3, "parametersMatchConfig": true }, "manual": 4, "inversions": 0 },
  "timeline": { "records": 29, "withImage": 15, "selected": 14, "hidden": 0, "gaps": [[0, 12345]], "unresolvedAnchors": [] },
  "caches": { "peaks": "fresh", "speech": "fresh" },
  "documents": ["story-analysis.md", "visual-treatment.md"]
}
```

Everything needed already exists as module operations. The command is a fold over `loadStoryContext`, `loadVisualTimeline`, `loadOverlays`, and the cache pin checks. Make it the first thing `AGENTS.md` tells an agent to run.

### 5.3 Story selection is ambient and reached through a three-file config chain

`config/editor-server.json` names `visual-timeline.json`, which names `story-planning.json`, which names one `storyDirectory`. That directory is "the default story". The `word-timing` CLI accepts `--story`; the `visual-timeline` CLI does not and always uses the chain; the server takes the story from the URL. So there are three mechanisms for the same intent, and one of them is a global mutable setting in a config file.

Cost: to inspect a different story's timeline an agent must edit `config/story-planning.json`, which also changes the server's default and the seed target. An agent that forgets to change it back has silently repointed other tools. A56 already made the server multi-story, so the "default story" concept in A18 is now vestigial for everything except the browser's bare URL.

Recommendation: the story is an argument, never a setting. Every story-scoped command takes `--story <id>` resolved under one `storiesDirectory`. The server keeps a default only for the bare URL. Collapse the chain: either one `config/animator.json` with per-module sections, or per-module configs that never reference each other. Explicit configuration was the user's rule; explicit does not require scattered.

### 5.4 The kernel is hidden inside a mid-level module and its primitives are copied eleven times

`story-planning/io.ts` is the shared IO library for five other modules. `visual-timeline/contracts.ts` is where `ClipIdentity`, `IsoUtc`, and `Producer` live, so `word-timing` imports from `visual-timeline`. `editor-server` imports `Sha256` from `transcription`. Meanwhile the schema primitives `Path`, `Positive`, `Index`, `Id`, `Text`, `Sha256` are re-declared in eleven contract files with small variations (some `Text` require a non-space character, some do not; `Sha256` exists twice). `decode` is re-declared five times and `sameClip` twice, each copy existing only to re-tag the error type.

Cost: the dependency graph lies about what depends on what. An agent reading `story-planning` expects planning and finds the kernel. An agent adding a schema must decide which of eleven `Positive`s to copy. Any fix to a primitive must be applied eleven times or silently diverge.

Recommendation: create `src/core/` with `schema.ts` (the primitives, once), `io.ts` (moved from story-planning), `identity.ts` (`ClipIdentity`, `sameClip`, `Sha256`, `IsoUtc`, `Producer`), and `error.ts` (section 5.8). Rename `story-planning` to `story`: it loads manifests and verified contexts, and "planning" is what happens afterwards. After this the import graph reads as the layer table in section 3.

### 5.5 The client hand-mirrors the contracts and re-implements two merges

`packages/editor/src/api.ts` opens with "Shapes mirror contracts.ts by hand; the client cannot import Effect schemas." `merge.ts` and `chunks.ts` in the client re-implement `mergeTimeline` and `computeChunks` from the server. A27 says nothing is implemented twice; these are.

Cost: every rule change is two edits and two tests, and the two can drift without any check noticing. The next feature on the roadmap, generation from the frontend, will widen this.

Recommendation: a third workspace package, `packages/domain`, holding plain TypeScript types and the pure functions (`mergeTimeline` without Effect, `computeChunks`, `effectiveTiming`, `alignRange`, `measureRange`, the time conversions). Both the root package and the client import it. The Effect schemas in `src/` can derive their `Type` from those types or the reverse; either direction gives one source of truth. The functions are already pure, so this is a move, not a rewrite.

### 5.6 Nine entry files, nine hand-rolled argument parsers, one Effect CLI with one command

`src/cli.ts` is the Effect CLI and exposes only `inspect`. The other eight entry files each build their own `parseArgs`, usage string, error printer, and stdout writer. The README states the CLI is the application entry point; it is not.

Cost: an agent must learn nine invocations, each with its own config file and flag vocabulary, and cannot discover them from `--help`. Every new module adds a tenth.

Recommendation: one tree, `animator <module> <verb>`, with uniform `--story`, `--config`, `--dry-run`, and JSON on stdout. The Effect CLI already exists; move the eight commands under it. Keep the module operations untouched. `animator --help` then documents the surface, and `AGENTS.md` can point to it instead of listing commands.

### 5.7 There is no CLI verb that writes decisions, and no batch add

`writeDecisions` is exported from `visual-timeline` but the CLI offers only `show` and `add`. A script that wants to select candidates must either PUT over HTTP or hand-write `decisions.json` with the correct `clip` and `updatedAt`. `add` takes one shot per process.

Cost: the moodboard film will need dozens of records and a selection pass. Today that is dozens of process spawns and a hand-edited overlay. Both are error-prone in exactly the place the two-writer rule is meant to protect.

Recommendation: `animator timeline decide --story <id> --set <shotId>.selected=true` or a JSON patch body on stdin, and `animator timeline add --from-json <file>` for batches. Both go through the existing module functions.

### 5.8 Six error types with overlapping codes, re-wrapped at every boundary

Each module has its own tagged error with codes such as `IoFailed` and `InvalidConfig`. Crossing a module boundary maps the inner error to the outer type, keeping the message and dropping the tag.

Cost: modest for a human reading one message; real for an agent triaging a run log across modules, where "which layer failed" is the first question.

Recommendation: one `AnimatorError` in `src/core/error.ts` with `module`, `code`, `path?`, and `message`. Modules keep their code unions; the wrapper functions disappear.

### 5.9 Operations take config paths, not values

`loadVisualTimeline({ configPath })`, `addShot({ configPath, ... })`, and similar read config from disk inside the operation. `routes.ts` works around this by threading `storyDirectory` overrides.

Cost: a future runner (B12) or the frontend-generation features cannot compose operations with in-memory values without touching the filesystem chain. Tests must write config files.

Recommendation: operations take decoded values (`StoryContext`, limits, producer). A thin loader turns a config path into those values once, at the entry point. In Effect terms this is a `StoryLibrary` service and a config layer, which also removes the chain in 5.3.

### 5.10 Documents are excellent prose in the wrong shape

`README.md` is 38 KB and `PIPELINE.md` is 40 KB. Both are accurate. Both are narrative paragraphs where an agent wants tables, trees, and one-line pointers. The README restates what `--help` says and what the contract JSDoc says, so there are three places to keep in sync. The term "planning directory" survives in three places after the relocation made it the story directory. The manifest's `origin.segmentPath` points at a directory that no longer exists, which is intended as a historical locator but reads as a broken link.

Cost: orientation tokens, and drift. Three descriptions of one rule will eventually disagree.

Recommendation: the README becomes a map and a set of how-tos: the layer table, the data layout table, the command tree, and pointers. Contract details live in `contracts.ts` JSDoc, which is already good. `PIPELINE.md` keeps target, decision tree, and backlog; the assumptions table moves to `docs/decisions/A<nn>-<slug>.md`, one file each, keeping the numbers so the code references still resolve, and gaining room for status, supersession, and evidence links. Add a short glossary: book, story, clip, segment, record, shot, decision, overlay, cache. Rename `origin.segmentPath` to `originalSegmentPath` or add a `historical: true` flag so the schema says what the prose says. State once that `data/` is local-only and the evidence files it cites are not in git.

### 5.11 Small items

- `pnpm check` that runs typecheck and both test suites. Today that is three commands.
- The `redis` dependency exists only to satisfy a peer requirement. It belongs in the `AGENTS.md` gotchas so no agent goes looking for a Redis server.
- The `animator` symlink to the legacy project is reference-only. Say so where an agent will see it.
- `data/books/<book>/split/segments/` still holds extras while stories moved out. Two places for "segments" is a naming hazard; `extras/` would say what is there.

## 6. The target shape

If every recommendation above landed, the tower would read like this from the top:

```text
AGENTS.md            what an agent may do, must do, must never do; run `animator status` first
README.md            map: layers, data layout, command tree, pointers
PIPELINE.md          target, decision tree, backlog
docs/decisions/      one file per assumption, stable A-numbers, cited from code
docs/reviews/        this file and its successors

animator <module> <verb> --story <id>     one CLI, discoverable from --help
packages/editor      client, imports packages/domain
packages/domain      plain types and pure functions shared by server and client

src/core/            schema primitives, io, identity, error      (L0)
src/modules/
  source-media, transcription, story-audio                       (L1)
  story-split, story, story-inventory                            (L2)
  visual-timeline, word-timing                                   (L3)
  editor-server                                                  (L4)

data/stories/<id>/   story.json, audio/, transcript.*, shots/, decisions.json,
                     word-timing*.json, cache/, agent-authored .md
```

The property that makes this legible is that each level names only the level below it, and each name says what the thing is. An agent can then read top-down and stop at the depth its task needs.

## 7. Suggested content for AGENTS.md

Only the human edits this file. The following is a draft to take or leave.

```markdown
# AGENTS.md

Start every session with `animator status` (until it exists: read README "Map" and run `pnpm check`).

## Hard rules
- Never write transcript.json, transcript.txt, audio/, or story.json identity fields. They are hash-pinned evidence.
- Two writers, two files: scripts write shots/<ulid>/record.json and word-timing.auto.json; the editor or the CLI writes decisions.json and word-timing.json.
- Never overwrite an existing record. Mint a new ULID.
- Every config value is explicit. No defaults in code.
- The dev servers are the user's workspace. Use scripts/editor-dev.sh; never kill them by hand.
- data/ is local-only and not in git. Evidence files cited in docs live only on this machine.

## Conventions
- One contracts.ts per module; the Effect Schema is the contract.
- Cite the assumption ID in JSDoc when code implements a decision: `(A51)`.
- Errors name the file and the rule. Reads are bounded; writes are atomic.
- Time is integer samples on the clip clock. Seconds are for display only.
- Colocated *.test.ts, node --test, built to dist first.

## Commands
- pnpm check
- animator --help
- scripts/editor-dev.sh status

## Gotchas
- redis is pinned only to satisfy a peer dependency; nothing uses it.
- The animator symlink is the legacy project, reference only.
- skipLibCheck is on because of an Effect RC declaration bug; application code stays strict.
```

## 8. Suggested order

1. `AGENTS.md` (5.1) and `animator status` (5.2). One day. Both change how every later session starts.
2. `--story` everywhere and the config chain collapsed (5.3). Removes the ambient global.
3. `src/core/` and the rename to `story` (5.4), then `AnimatorError` (5.8). Mechanical, well covered by the existing tests.
4. `packages/domain` (5.5). Do this before frontend generation lands, not after.
5. One CLI tree (5.6) with the decisions and batch verbs (5.7).
6. Operations take values (5.9). Naturally falls out of 5 and prepares B12.
7. Documents reshaped (5.10) and the small items (5.11).

Items 1, 2, and 7 are documentation and additive code. Items 3 to 6 move code without changing behaviour and should each be one commit that the test suites verify.
