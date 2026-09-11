# Animator v2

Animator turns audiobooks into movies while keeping their original narration. The first visual milestone is a moodboard film over one selected story; the final direction is animation. Two Ted Chiang collections are split into 17 stories under `data/stories/`, The Great Silence carries the pilot's storyboard, and Tower of Babylon has a GPT working transcript. Movie production is still to be built.

This file is the map and the how-tos. The target, the words we use, every decision with its reason, and the backlog are in [CONTEXT.md](CONTEXT.md); agent directives are in `AGENTS.md`; the human roadmap is `HUMAN.md`. `data/` is local-only and not in git, so every evidence file named below exists only on this machine. The `animator` symlink points at the legacy project and is reference only.

## Map

| Layer | Where | What |
| --- | --- | --- |
| domain | `packages/domain` | The shapes and pure rules shared by the server, the CLIs, and the browser: schema primitives, clip identity, records, decisions, overlays, caches, every wire shape, the timeline merge, chunking, effective timing, the align pass, time conversions, ULIDs. No I/O. |
| core | `src/core/` | Node-side io every module shares: bounded reads, strict JSON decoding, atomic writes. |
| intake | `src/intake/` | Book to stories, run once per book and frozen: `source-media`, `transcription`, `story-audio`, `story-split`. |
| story modules | `src/modules/` | Everything that consumes a story: `story` (manifest and context), `story-inventory`, `story-transcription`, `visual-timeline`, `word-timing`, `editor-server`, `status`. |
| runs and commands | `src/run.ts`, `src/cli.ts`, `src/commands/` | Defaults merged with an optional run file, and the one command tree. |
| editor | `packages/editor` | The Vite + React client, decoding every response with the domain schemas. |

Each layer names only the layer below it. A module has one `contracts.ts` holding its Effect schemas and its `defaults`; the schema is the contract, a verb is a convenience.

The command surface is one tree, `pnpm run cli` (`node dist/cli.js`), and `--help` at any level is the reference:

```text
animator status        [--story <id>] [--run <file>] [--port N]     facts about every story and the server
animator intake        inspect | prepare | import | split            book intake, each with its per-book --run file
animator story         show                                          the verified story and working transcript
animator inventory     publish                                       the reading views over every manifest
animator timeline      show | add | seed                             records and decisions of one story
animator timing        measure | align                               word timing against the audio
animator transcription defaults | promote                            GPT re-transcription (Python steps listed in its help)
animator server        serve --port N [--static dir]                 the editor server
animator run           show                                          the effective settings
```

Every story-level verb takes `--story <id>` (the folder name under the stories directory; omit it to be told the ids) and an optional `--run <file>`. Data goes to stdout as JSON; help and errors go to stderr, errors as `code: message` naming the file or rule.

## Data layout

| Location | Contents |
| --- | --- |
| `data/inbox/` | New files waiting to be identified and filed. |
| `data/books/<book>/input/` | The original `book.mp3` and the exact Rev export. |
| `data/books/<book>/artifacts/` | Whole-book preparation, source inspection with its backfilled request, the imported transcript. Each records the run that produced it. |
| `data/books/<book>/split/` | The split's plan copy, run manifest (with its run file), acceptance inventory, and under `segments/` the extras (author notes and credits) as verified pairs. Hash-pinned evidence; keeps its layout. |
| `data/books/<book>/inventory.md` | The book's readable story inventory, published by `animator inventory publish`. |
| `data/stories/<id>/` | One story: `story.json`, `audio/`, `transcript.json`, `transcript.txt`, `shots/<ulid>/record.json` with images, `decisions.json`, `word-timing.auto.json`, `word-timing.json`, `cache/` (regenerable peaks and speech regions), `transcription/` and `archive/` where a GPT transcript was made, and agent-written `*.md` documents. |
| `data/stories/inventory.md`, `inventory.json` | The combined selection inventory, shortest first. |
| `data/story-relocation.json`, `data/cleanup-*.json` | Hash-verified records of the one-time moves and cleanups. |

Who writes what inside a story directory:

| File | Writer | Rule |
| --- | --- | --- |
| `story.json`, `audio/`, `transcript.json`, `transcript.txt` | intake, then only `animator transcription promote` | Hash-pinned identity; every load verifies them. |
| `shots/<ulid>/record.json` | any script, `animator timeline add`, the editor's upload | Immutable; never overwritten, a new ULID instead. |
| `decisions.json` | the editor, or a CLI verb | Overrides and selections keyed by shot id, pinned to the clip. |
| `word-timing.auto.json` | `animator timing align` only | Each run replaces its range's entries and appends itself with its parameters. |
| `word-timing.json` | the editor only | Manual word spans, replaced wholesale on each save. |
| `cache/*.json` | the editor server | Regenerable; pinned to the audio hash and the detection parameters. |

## Setup and checks

Pinned: Node `24.20.0`, pnpm `11.25.0`, TypeScript `7.0.2`, Effect `4.0.0-rc.112`. FFmpeg and ffprobe are external; the host has `9.0.1`.

```sh
pnpm install --frozen-lockfile
pnpm check                      # domain tests, root build and tests, editor tests and typecheck, in order
pnpm run cli --help
scripts/editor-dev.sh start     # API on 127.0.0.1:63620 and Vite on 127.0.0.1:5173, detached, logs under .dev/
```

`pnpm test` alone builds the root and runs its colocated tests from `dist/`. The dev launcher starts `animator server serve` with the code defaults and manages only processes it started from this checkout; stop and restart through it. One known flaky test: the `/api/events` watcher test fails on alternate runs on this machine and predates the current layout.

## Runs and settings

There is no settings folder. Every module declares its defaults in code (`storyDefaults`, `visualTimelineDefaults`, `editorDefaults`, `storyInventoryDefaults`, `transcriptionDefaults`), and `animator run show` prints the effective set. A run file is a JSON object with any subset of the sections `storiesDirectory`, `booksDirectory`, `story`, `timeline`, `editor`, `inventory`, and `transcription`, laid over the defaults and then checked strictly, so a misspelt key fails by name; directory paths in it resolve from the file. The stories and books directories default to `data/stories` and `data/books` under the checkout, whatever the working directory. The editor server prints its effective settings beside its listening URL; the caches and the auto timing overlay record the values they were produced with; the intake tools take their per-book run file as `--run` and copy it into `artifacts/preparation.json`, `split/run-manifest.json`, and `artifacts/source-inspection.request.json`.

## Where things are: status

Run this first in any session:

```sh
pnpm --silent run cli status
pnpm --silent run cli status --story the-great-silence
```

It prints one JSON report over every story directory: whether the manifest and linked files verify (a failure is reported with its code and message, never omitted), the transcript provider, the word-timing overlays with the auto overlay's coverage and whether its recorded parameters still match this run's settings, the timeline's records, images, selections, hidden shots, gaps, undecided candidate groups, and unresolved anchors, whether the peaks and speech caches are fresh, stale, or absent, the Markdown documents in the directory, and whether the editor server answers. Facts only; nothing is written and no audio is decoded.

## Working on a story

```sh
pnpm --silent run cli story show --story the-great-silence            # the verified context and working transcript
pnpm --silent run cli timeline show --story the-great-silence         # records, decisions, candidate groups, stitched timeline
pnpm --silent run cli timeline add --story the-great-silence --at-seconds 12.5 --mode graphic-illustration --label "Opening" --image path/to/image.png
pnpm --silent run cli timing measure --story the-great-silence --from 0 --to 30
pnpm --silent run cli timing align --story the-great-silence --from 0 --to 30 --dry-run
pnpm --silent run cli timing align --story the-great-silence --all    # whole clip, on the user's say-so (A43)
```

**Timeline.** A generation record is `shots/<ulid>/record.json` with its image beside it: the clip identity, an integer `startSample` on the clip clock, a mode, optional label, prompt, image, and notes, `createdAt`, and the producer. `decisions.json` holds per-shot overrides (`startSample`, `anchorWordId`, `mode`, `selected`, `hidden`, `notes`) and story settings such as the 16:9 frame. The merge (`mergeTimeline` in the domain package) applies overrides over records, groups shots with the same effective start, selects one per group (the explicitly selected, else the newest, never a hidden one), and stitches the selected shots so each holds until the next start, with an explicit opening gap; a decision that breaks a rule is refused naming the file. An anchored shot follows its word's effective start. The one-time seed import (`animator timeline seed`) put the 14 treatment spans and 15 prototype panels into The Great Silence with deterministic ids, so a re-run is a no-op.

**Word timing.** The transcriber's word times lead the audio by roughly 150 ms on the pilot, so two overlays correct them without ever writing the transcript:

| File | Writer | Contents |
| --- | --- | --- |
| `word-timing.auto.json` | the align script only | `{ schemaVersion: 1, kind: "word-timing-auto", clip, updatedAt, producer, parameters: { leadMs, thresholdDbfs, minSilenceMs, minSpeechMs }, runs: [{ startSample, endSample, ranAt, report }], words }`. Each run replaces the entries for words whose original start lies in its range and appends itself to `runs`. |
| `word-timing.json` | the editor only | `{ schemaVersion: 1, kind: "word-timing-manual", clip, updatedAt, words }`. Replaced wholesale on every save. |

Effective timing is manual, else auto, else original, merged per request before words, chunks, and shot anchors are served. Speech regions come from the same ffmpeg decode as the waveform peaks (RMS per 10 ms frame, an absolute threshold of -50 dBFS, short-run cleanup) and are cached under `cache/`. The align pass is pure and takes the original timing only: words in the range are shifted by the lead, assigned to the speech region they overlap most (a word in silence follows its sentence), and mapped linearly onto their region. Every run reports median, p10, and p90 onset error at phrase boundaries and the fraction of words inside speech, before and after.

**Chunks.** A chunk is a maximal run of words ended by sentence punctuation with an audible gap (at least the story's `chunking.minSentenceBreakMs`, a fact recorded in `story.json`, else the setting's default of 0), by a pause of at least `pauseBreakMs`, or by the end. The server and the client chunk with the same rule from the transcript's element order.

## Working story transcription

Book-level Rev.ai transcription identifies and splits stories. After selection, the story audio is transcribed by GPT and promoted to the working transcript; planning, the editor, word timing, and shot anchors then share that identity.

| File | Role |
| --- | --- |
| `transcript.json` / `transcript.txt` | Working GPT words and exact text. |
| `archive/rev/transcript.rev.json` / `transcript.rev.txt` | Tower of Babylon’s preserved Rev split evidence. Other stories still keep these files in their story root until archived. |
| `transcription/run.json`, `transcription/transcription-*.json` | Exact run configuration/audio hash and raw GPT responses. |
| `transcription/transcript.txt`, `joins.json`, `prepared.json` | Stitched output, overlap evidence and prepared working transcript. |
| `word-timing.auto.json` / `word-timing.json` | Automatic waveform timing and manual edits keyed by GPT IDs and the working transcript hash. |
| `archive/` | Earlier identities, overlays, Rev evidence and retired review material; see its README and relocation manifest. |

The transcription run file (schema and defaults: `TranscriptionSettings` in `src/modules/story-transcription/contracts.ts`; the run Tower of Babylon used is recorded in its `transcription/run.json`) explicitly selects `gpt-transcribe`, chunk size, overlap, encoding, concurrency, language and spelling hints. Write a run file with story-appropriate hints for other stories; the Python script has no defaults of its own. `OPENAI_API_KEY` comes from the environment or this repository's `.env`.

```sh
pnpm run build
python3 scripts/transcribe-story.py \
  --story data/stories/tower-of-babylon \
  --run <run.json> \
  --output data/stories/tower-of-babylon/transcription
python3 scripts/stitch-story-transcript.py \
  --story data/stories/tower-of-babylon \
  --directory data/stories/tower-of-babylon/transcription
python3 scripts/prepare-story-transcript.py \
  --story data/stories/tower-of-babylon \
  --seed data/stories/tower-of-babylon/archive/rev/transcript.rev.json \
  --text data/stories/tower-of-babylon/transcription/transcript.txt \
  --run data/stories/tower-of-babylon/transcription \
  --output data/stories/tower-of-babylon/transcription/prepared.json
sh scripts/editor-dev.sh stop
pnpm --silent run cli transcription promote \
  --story tower-of-babylon \
  --input data/stories/tower-of-babylon/transcription/prepared.json
pnpm --silent run cli timing align --story tower-of-babylon --all
sh scripts/editor-dev.sh start
```

Transcription resumes only when the saved audio hash and configuration match. Joining refuses unreliable overlaps. Preparation preserves GPT wording and punctuation exactly. It currently bootstraps initial timing from the Rev split words supplied explicitly through `--seed`; this one-time dependency is recorded as `timing.method: "rev-seeded"`, and is not presented as GPT-generated timestamps. The standard waveform pass then adjusts those positions. A future audio-only forced aligner can replace the bootstrap without changing the working transcript contract.

Promotion validates the prepared transcript and run evidence, archives the prior identity and timing, and commits `story.json` to the new transcript hash. Identical promotion is a no-op. Stories with visual shots, shot decisions or nonempty manual word timing require an explicit mapping before changing transcript identity; the script refuses to discard that work. Stop the editor during promotion and restart it afterward, since story contexts are cached. A changed GPT text needs a new output run directory; existing run evidence is retained.

In the editor, **GPT initial**, **Auto**, and **Edited** are timing views of the same GPT words. Selection, manual timing, alignment and shot anchors operate on GPT IDs. Rev-only stories remain available as clearly labelled split evidence, with existing work preserved. Tower of Babylon's 9,808 GPT words and waveform adjustment are migrated; no new transcription request was made during this refactor.

Validation: `pnpm test`, `pnpm --filter editor test`, and `python3 scripts/test-story-transcription.py`.

## Editor

`packages/editor` is a Vite + React client that opens one verified story at a time. The story rides in the URL as `?story=<id>`; a bare URL opens the story this browser last showed, else the picker. It shows the letterboxed preview at the playhead, a transport with clip and book clocks, the waveform with speech regions shaded beneath, up to three timing rows (Original, Auto, Edited), the shot lane, and a panel for the shot under the playhead. Decisions and word-timing edits autosave 300 ms after each change; the working region is client-only.

Timeline controls: click a word to seek and play, or a chunk's padding to seek to its start; drag a shot marker to move its start, snapping to chunk starts, word starts, and the midpoints of pauses of at least 300 ms, in that order of preference when equally near (hold Alt to disable); Ctrl/Cmd + wheel zooms; Space plays or pauses; Left/Right nudge 100 ms, with Shift 1 s; Home and End jump to the clip edges.

Word timing in the Edited row: click selects a word (or a whole sentence in Sentences mode), Shift-click extends the selection to a contiguous range, Escape clears it. Dragging any selected box moves every selected word by the same amount with durations preserved; the leading edge snaps to speech-region onsets within 8 px (Alt disables), the move is clamped so the group never crosses its unselected neighbours or the clip edges, and the toolbar shows the delta while dragging. Comma and period nudge the selection by 10 ms. Cmd/Ctrl+Z undoes and Shift+Cmd/Ctrl+Z redoes timing edits (client-side stack, each step autosaves). "Align selection" runs the server's automatic pass over the selected span and shows before → after median, p10, p90 boundary error and inside-speech fraction in the toolbar; there is no whole-clip button in the UI. A shot dropped on a word or sentence start is anchored to that word (`anchorWordId` in its decision) and follows the word's effective start; the marker carries an anchor glyph and the panel offers Detach, which keeps the current position as a plain `startSample`. Dropping a marker anywhere else detaches it.

```sh
pnpm --filter editor dev        # Vite on 127.0.0.1:5173, proxying /api to the editor server (EDITOR_API_PORT to change)
pnpm --filter editor build      # domain build, typecheck, static build into packages/editor/dist
pnpm --filter editor test       # pure-module tests with node --test
EDITOR_API_PORT=63621 pnpm --filter editor dev   # against node packages/editor/mock/server.mjs, which records every PUT at /mock/puts
```

The editor server (`animator server serve --port 63620 [--static packages/editor/dist]`) is a thin Effect HTTP layer over the story, visual-timeline, and word-timing modules on 127.0.0.1 with no authentication. It lists every story directory once at start (stories added later need a restart), verifies each story on its first open and keeps it for the process, rereads records, decisions, and overlays on every request because scripts write them independently, and pushes change notices over server-sent events from a recursive watch on the open story's directory. Every route is under `/api/stories/<story-id>/`; an unknown id is a 404 before any file is touched.

| Route | Purpose |
| --- | --- |
| `GET /api/stories` | `{ defaultStoryId, stories }`, each story `{ id, title, bookId, bookTitle, wordCount, sampleRateHz, sampleCount, durationSeconds, durationDisplay }` from its manifest, in directory order. |
| `GET …/story` | Clip identity, story and book titles, `sourceStartSample` (the clip's start on the book clock, for a book-time display), the transcript words, and `chunks`. Each word is `{ id, value, startSample, endSample, original, auto?, manual? }`: the top-level times are effective (see Word timing), `original` is the transcriber's, `auto` and `manual` are the overlay layers when present. `chunks` are maximal word runs on effective times ended by sentence punctuation (`.`, `?`, `!`), a pause of at least `chunking.pauseBreakMs`, or the transcript end, each with `id`, `startSample`, `endSample`, `text`, `wordIds`, and `breakReason`. `timing` is `{ inversions, autoRuns, manualCount, autoCount }`. Reread on every request. |
| `GET …/timeline` | The `loadVisualTimeline` result with effective word starts supplied for shot anchors: records (with `imageUrl` when a record has an image), decisions, candidate groups, the stitched timeline, and `unresolvedAnchors`. |
| `PUT …/decisions` | Body `{ settings, shots }`; validates (including every `anchorWordId` against the transcript) and replaces `decisions.json` atomically, then returns the fresh timeline. Bounded by `maxDecisionsBytes`. |
| `PUT …/word-timing` | Body `{ words: { [wordId]: { startSample, endSample } } }`; validates and replaces `word-timing.json` wholesale, then returns the fresh `…/story` payload. Bounded by `maxDecisionsBytes`. |
| `POST …/word-timing/align` | Body `{ startSample, endSample, wholeClip? }`; runs the align pass over the range, merges the result into `word-timing.auto.json`, and returns `{ report, story }`. A range covering the whole clip is refused unless `wholeClip` is `true`. |
| `GET …/speech` | Detected speech regions: `{ schemaVersion: 1, kind: "speech-regions", audioSha256, sampleRateHz, sampleCount, frameSamples, thresholdDbfs, minSilenceMs, minSpeechMs, regions: [{ startSample, endSample }] }`, cached at `<story>/cache/speech.json` and recomputed whenever a pin differs. |
| `POST …/shots` | `multipart/form-data` with `startSample` or `startSeconds`, `mode`, optional `label`, `prompt`, `notes`, and an optional `image` file (`.png`, `.jpg`, `.jpeg`, `.webp`). Creates an immutable record through `addShot` with producer `editor`. Returns 201 with the record. |
| `GET …/shots/:id/image` | The record's image with its content type; 404 for anything that is not a ULID-named record with a supported image. |
| `GET …/audio` | The story FLAC with `Accept-Ranges: bytes`, single byte ranges (206, 416 with the size, 200 otherwise), and HEAD. |
| `GET …/peaks` | Waveform peaks: `{ schemaVersion: 1, audioSha256, sampleRateHz, sampleCount, samplesPerBucket, min, max }` with int16 extremes per bucket, the last bucket partial. Computed with `ffmpeg` streaming mono s16le into the peaks and speech reductions at once, checked against the verified sample count, written atomically to `<story>/cache/peaks.json`, and recomputed whenever the cache's pins differ. A miss on either cache decodes once and rewrites both. |
| `GET …/events` | Server-sent events: `ready` on connect, `timeline-changed` (debounced) after any change under the story directory, and a comment heartbeat every 15 seconds. The client refetches the story and timeline; no payload is pushed. |

Errors are JSON `{ code, message }`: 400 for a bad request or invalid client-supplied decisions or timing, 404 for unknown shots and routes, 409 for an identity mismatch or an existing record, 413 for oversized bodies and uploads, 500 for invalid files on disk or a failed decode. The editor settings (`editorDefaults` in `src/modules/editor-server/contracts.ts`, overridable under `editor` in a run file) name the ffmpeg executable, the peaks bucket size and cache limit, the speech-detection parameters, the alignment lead and boundary pause, the watch debounce, the upload, request-timeout, and word-timing overlay size limits (`maxWordTimingBytes`; the auto overlay is about 90 bytes per word, so the 3.7-hour story needs several MB), and the chunking thresholds (`pauseBreakMs`, and `minSentenceBreakMs`: a transcriber's sentence mark only ends a chunk when the gap to the next word is at least this long, since a period with no audible pause behind it is treated as misplaced; the setting is the default and a story's `story.json` may override it under `chunking.minSentenceBreakMs`, which is how the rule is enabled story by story; the story payload lists every break merged this way under `chunking.mergedSentenceBreaks`). The pieces live in `src/modules/editor-server/`: `range.ts` (Range header parsing), `peaks.ts` (the shared decode, bucket reduction, and both caches), `timing.ts` (caches, the effective-timing merge for the story payload, and the align run), `routes.ts` (the story library and the router layer), and `index.ts` (`makeEditorServer`, the full layer for `Layer.launch`).

## Intake: from a book to stories

Intake is frozen; the steps the two books took, and what a third book would need, are in [CONTEXT.md](CONTEXT.md#when-a-new-book-arrives). The tools take their per-book run file as `--run` and record it beside their outputs.

```sh
pnpm --silent run cli intake inspect --source data/books/exhalation/input/book.mp3 --run data/books/exhalation/artifacts/source-inspection.request.json
pnpm --silent run cli intake prepare --run <run.json>
pnpm --silent run cli intake import  --run <run.json> --transcript data/books/exhalation/input/rev-export.json --job-id eekQ2vQNJp3XjfF6
pnpm --silent run cli intake split   --plan data/books/exhalation/split-plan.json --source data/books/exhalation/input/book.mp3 --run <run.json> --validate-only
pnpm --silent run cli intake split   --plan data/books/exhalation/split-plan.json --source data/books/exhalation/input/book.mp3 --run <run.json> --output data/books/exhalation/split
pnpm --silent run cli inventory publish
```

Source inspection hashes the file, probes streams and chapters, and reports CUE evidence without approving any boundary. Whole-book transcription goes through the Rev dashboard; import verifies the pinned source and the job id and never overwrites existing evidence. The split consumes a reviewed plan that partitions every transcript element exactly once into integer sample intervals on FFmpeg's decoded clock; it verifies every identity, extracts lossless 24-bit FLAC pairs, reuses verified pairs on a rerun, and publishes the duration inventory last. `scripts/verify-paired-output.py`, run from a book directory, confirmed that recombining every segment reconstructs each book's transcript and decoded PCM exactly. Exhalation job `eekQ2vQNJp3XjfF6` returned 100,593 timed words; Stories of Your Life and Others job `gbuckIu5tGOf8MiK` returned 91,213.

Edit a story's synopsis in its `story.json`, then `animator inventory publish` rebuilds the reading views; invalid or stale inputs leave them unchanged.

## Pointers

- [CONTEXT.md](CONTEXT.md): target, glossary, decision index, backlog, and what a new book would need.
- [docs/decisions](docs/decisions/): one file per decision with its status, reason, and the code that cites it.
- [docs/history](docs/history/): earlier rounds, evidence, and the first runs. [docs/research](docs/research/): the transcription provider survey and the pilot's source check. [docs/reviews](docs/reviews/): the architecture review this layout came from.
- The pilot's agent-written documents live beside its data: `data/stories/the-great-silence/story-analysis.md`, `visual-treatment.md`, and `visual-prototype/`.

## Known dependency details

Effect v4 is a release candidate. Its CLI declaration files contain a broken reference to an internal declaration, so `skipLibCheck` is explicitly enabled while application code remains strictly checked. No dependency patch is applied. The pinned Redis client satisfies a required peer dependency of `@effect/platform-node`; nothing here uses Redis. Boolean CLI flags carry an explicit default because this CLI version otherwise treats them as required.
