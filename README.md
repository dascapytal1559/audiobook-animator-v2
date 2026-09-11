# Animator v2

Animator turns audiobooks into movies while keeping their original narration. The first visual milestone is moodboards over a selected story; the final direction is animation. The target is for at least 95% of story runs to complete without intervention after setup.

The working product decisions, evidence, and backlog are in [PIPELINE.md](PIPELINE.md). The TypeScript/Effect foundation, source inspection, whole-book transcript import, paired splitting, story inventory, visual timeline, and browser editor with timing overlays are implemented. Both collections have 17 exported stories, ready to browse by duration and synopsis in the local [story inventory](data/stories/inventory.md). Each story lives in its own directory under `data/stories/`. GPT is the working story transcript; Rev.ai is retained as book-splitting evidence. Tower of Babylon is promoted to GPT and is the editor default; the other 16 stories are explicitly marked as awaiting GPT. Movie production is still to be implemented.

## Local setup

The project pins Node `24.20.0`, pnpm `11.25.0`, TypeScript `7.0.2`, and Effect `4.0.0-rc.112`. FFmpeg/ffprobe are external media tools; the inspected host has version `9.0.1`.

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm run cli --help
pnpm run cli --version
```

`pnpm test` builds the source and runs the colocated tests with Node's built-in test runner. The CLI runs compiled JavaScript from `dist/`.

## Source inspection

The source-media module reads a local file, computes its SHA-256 identity, probes audio streams and chapter metadata, and reports optional CUE evidence. It retains original timing information and reports malformed or conflicting evidence. Its result does not approve story boundaries.

The module is independently callable from `src/intake/source-media/index.ts`. It accepts an explicit request and uses Effect's filesystem and child-process services. The CLI is the application entry point; operational configuration belongs at that boundary.

```sh
pnpm run cli inspect --source data/books/exhalation/input/book.mp3 --config config/source-media.json
```

Both flags are required. Source and config paths resolve from the current directory. A bare `ffprobe` command uses PATH; a relative executable path containing a separator resolves from the configuration directory. The checked-in config spells out process timeout, output limits, hash buffer size, and a 20 ms diagnostic comparison tolerance. That tolerance is not approval of story boundaries.

Successful inspection emits JSON on stdout. Errors, help, and version text use stderr. For a saved inspection without pnpm's script banner:

```sh
mkdir -p data/inspections
pnpm --silent run cli inspect --source data/books/exhalation/input/book.mp3 --config config/source-media.json > data/inspections/exhalation.json
```

The original MP3s and raw transcript exports live under each book's `input/` directory. They contain 21 hours 45 minutes of audio in total and are excluded from Git. The `animator` symlink points to the legacy project, whose assets and implementation serve as reference.

## Local inputs and outputs

Save new downloads in `data/inbox/`. Once identified, each book's originals and raw exports go into its own input folder:

| Location | Contents |
| --- | --- |
| `data/inbox/` | New files waiting to be identified and filed. |
| `data/books/exhalation/input/` | Original `book.mp3` and exact `rev-export.json` for Exhalation. |
| `data/books/stories-of-your-life-and-others/input/` | Original `book.mp3` and exact `rev-export.json` for the second collection. |
| `data/books/<book>/artifacts/` | Imported transcript, source inspection, and preparation evidence. |
| `data/books/<book>/split/` | The split run's plan, run manifest, and acceptance inventory, plus the extras (author notes and credits) as verified audio/transcript pairs. |
| `data/books/<book>/inventory.md` | Readable per-book inventory of its stories with durations, synopses, and file links. |
| `data/stories/<story>/` | One directory per story: `story.json` (identity, locators, origin, editable synopsis), `audio/`, working GPT `transcript.json` / `transcript.txt`, split evidence (archived under `archive/rev/` for Tower of Babylon), raw GPT output in `transcription/`, planning documents, `shots/`, `decisions.json`, timing overlays, and caches. |
| `data/stories/inventory.md` and `inventory.json` | Combined story selection inventory, sorted by duration. |
| `data/story-relocation.json` | Hash-verified record of the move from `books/<book>/split/segments/` into `stories/`. |
| `data/cleanup-2026-09-09.json`, `data/cleanup-2026-09-09b.json` | Records of the two approved cleanups: what was removed, sizes, and the retained-hash check. |
| `data/stories/<story>/cache/` | Regenerable waveform peaks and speech regions, apart from source and work files. |

All `data/` files remain local. Source code, explicit configuration, project documents, and package files stay in the project root or their normal tracked folders. File moves preserve input bytes; `data/input-relocation.json` records the previous locations and matching hashes. Existing run evidence retains the paths used when those runs happened.

## Whole-book transcript import

The full-book path submits the original MP3 through the Rev AI dashboard and imports its JSON export locally. Both collections have completed this step. The prepare/import commands make no provider requests and need no API key:

```sh
node dist/book-transcription.js prepare --config config/rev-book.json
node dist/book-transcription.js import --config config/rev-book.json --transcript data/books/exhalation/input/rev-export.json --job-id eekQ2vQNJp3XjfF6
node dist/book-transcription.js import --config config/rev-stories-book.json --transcript data/books/stories-of-your-life-and-others/input/rev-export.json --job-id gbuckIu5tGOf8MiK
```

`config/rev-book.json` pins the Exhalation source hash and byte length. It explicitly supplies the audio stream, inspection settings, 17-hour/2-GB source limits, 64-MiB raw transcript limit, normalized-output limit, and timestamp tolerance. Config paths resolve from the config directory; command paths resolve from the working directory.

Preparation and import verify the original source through the source-media module. Artifacts under `data/books/exhalation/artifacts/` retain source inspection, preparation, exact raw transcript bytes, normalized words and punctuation, and plain text. Import requires the job ID shown for the exported file; dashboard JSON alone does not prove that association. Incompatible sources, job IDs, or exports cannot silently overwrite existing evidence.

Exhalation job `eekQ2vQNJp3XjfF6` returned 100,593 timed words; Stories of Your Life and Others job `gbuckIu5tGOf8MiK` returned 91,213. Both exact exports are retained. Whole-book word times use Rev's submitted-media timeline and remain unchanged. The original import records its clock mapping as unverified; later split evidence records the approximate mapping separately. Two independent transcript passes agree on all story and author-note ranges. Audio measurements locate the 19 internal cuts in quiet gaps on FFmpeg's decoded clock and measure the exact source endpoint. These checks support the cuts, while recognition accuracy and word alignment remain unmeasured. The current editor provides word seeking and waveform-based timing overlays for the selected story.

## Paired story splitting and inventory

The story-split module consumes a reviewed plan, slices the timed transcript, calls the verified audio extractor for every story and extra, and publishes a duration inventory after all pairs succeed. The existing stories were moved into `data/stories/<story>/` by a one-time relocation on 2026-09-09 that hash-checked every file before and after the move and wrote each story's `story.json`; `data/story-relocation.json` records those moves, and the script was removed afterwards. Extras stay with the book. A future split run still writes into `split/segments/`, so its stories need the same relocation and manifest step. Discovery is separate: the first Exhalation plan was produced by agents using transcript content and measured audio gaps. A reusable autonomous discovery service is still to be implemented.

```sh
node dist/split-stories.js --plan data/books/exhalation/split-plan.json --source data/books/exhalation/input/book.mp3 --config config/story-split.json --validate-only
node dist/split-stories.js --plan data/books/exhalation/split-plan.json --source data/books/exhalation/input/book.mp3 --config config/story-split.json --output data/books/exhalation/split
```

The plan pins source, normalized transcript, provider job, raw export, and supporting evidence identities. It partitions every transcript element exactly once and supplies ordered, nonoverlapping integer audio sample intervals. The intervals use FFmpeg's decoded-audio clock, with an inclusive start and exclusive end. Source chapter metadata does not choose or override cuts. Validation checks the supplied plan and identities; it does not independently establish the semantic quality of a cut.

Each segment contains `audio/audio.flac`, an audio verification manifest, `transcript.json`, and `transcript.txt`. Audio uses lossless 24-bit FLAC at the source sample rate and channel count. The paired JSON retains original provider timestamps and element IDs, and adds approximate times relative to the segment audio. These times are not forced alignment.

The files `split/inventory.md` and `split/inventory.json` record every story's verified duration and audio/transcript links. Author notes and credits appear separately. Durations are computed from verified decoded sample counts, not source metadata or transcript endpoints. These completed split artifacts remain unchanged when story descriptions are edited.

The combined [17-story inventory](data/stories/inventory.md) lists both collections from shortest to longest, with a short synopsis and file links for each story. Separate reading views cover [Exhalation](data/books/exhalation/inventory.md) and [Stories of Your Life and Others](data/books/stories-of-your-life-and-others/inventory.md). They link to the original split inventories for the books' eleven and ten extras respectively. Every segment has corresponding audio and transcript files. These artifacts remain local and are excluded from Git.

Independent acceptance for each book (`scripts/verify-paired-output.py`, run from a book directory) confirmed that recombining every segment exactly reconstructs the original transcript and the book's decoded 24-bit PCM. Each book has `paired-output-verification.json` recording the checks. The original acceptance suite included inventory and planning-input checks; current validation is run with `pnpm test` and `pnpm --filter editor test`. After moving the original inputs, real import and Exhalation split reruns also passed while preserving all 97 existing artifacts byte-for-byte; the cleanup evidence is in `data/input-relocation-verification.json`.

The checked-in configuration explicitly permits two concurrent segments, supplies all tool paths/timeouts and artifact limits, and allows a 0.1-second word-boundary tolerance. Tool paths resolve from the configuration file; source, transcript, and evidence paths resolve from the plan file. The output directory resolves from the working directory. An explicit `--source` supplies the current location of a moved source file; it resolves from the working directory and must match the source hash and audio details pinned by the plan. It does not change the historical plan or cut boundaries.

A compatible rerun verifies and reuses existing audio and paired files. A moved source is reusable when its content and media details match; the current locator is returned separately from historical source evidence. Changed content, processing configuration, tool versions, or corrupted artifacts fail rather than overwrite evidence. Output directories remain fixed for each saved run. Verified segments can be reused after a later segment fails; an incomplete audio publication stops for reconciliation. The complete machine-readable inventory is published last.

## Story manifests and reading inventories

Each story's `story.json` is its manifest: id and title, the book it came from, the premise-only synopsis, verified sample counts and durations, the hashes and relative paths of its audio and transcript files, and the origin of the split that produced it. Every load checks the manifest against the linked files, so an edit that breaks identity is caught rather than trusted. Edit the synopsis there, then rebuild the reading inventories:

```sh
pnpm run build
node dist/story-inventory.js --config config/story-inventory.json
```

The independently callable module is `src/modules/story-inventory/index.ts`. Its explicit configuration supplies the stories directory, each book's extras inventory and reading-view output, the combined outputs, and file-size limits; paths resolve from the config file. Every directory under the stories directory must hold a valid manifest for a configured book. It checks transcript hashes, audio manifests, file links, and sample-based durations through the shared story loader before publishing, without decoding audio or making provider requests.

The command updates the combined Markdown/JSON view and each book's readable Markdown view. The JSON retains exact durations, sample counts, file paths, and recorded hashes alongside the synopses. Human-readable durations are rounded to the nearest second. Invalid or stale inputs leave these views unchanged; valid description edits can be published repeatedly while the underlying split outputs stay intact.

## Current direction

The source chapter metadata is inaccurate and cannot decide story cuts. Both collections have now gone through whole-book transcription, transcript-led discovery, audio boundary checks, paired splitting, and inventories. The user has selected **The Great Silence (8:10)** for the first complete moodboard film. Its [story analysis](data/stories/the-great-silence/story-analysis.md) describes 15 evidenced narrative beats and continuity constraints; visual direction is being aligned in `PIPELINE.md`. Reusable autonomous discovery remains outstanding. Metadata remains available for comparison. Provider limits and the first transcription approach are documented in [the research note](docs/research/whole-book-transcription.md).

Modules live under `src/modules/` and expose their own operations. A thin Effect CLI supplies concrete services. A pipeline runner, database, and distributed workers have not been selected.

## Visual studies

The pilot has [five generated visual studies](data/stories/the-great-silence/visual-prototype/README.md), with the original images, exact prompts, and asset identities retained for seed import. **Graphic illustration** and **poetic abstraction** are available per scene. The 15 study panels and 14 proposed treatment sequences are imported into the current editor as labeled records; individual images, timing, and final image count remain creative work.

The old comparison player and two-minute timestamp demo commands were retired on 2026-09-09, and the demo material under `data/demo/` was purged with the intermediate scan logs and relocation bookkeeping (`data/cleanup-2026-09-09b.json`). The demo's Rev job id and what it demonstrated are kept in [the early-run history](docs/history/early-pipeline-runs.md).

## Story planning input

The `story` module loads a verified story for downstream analysis. It supplies the manifest-selected working transcript and verified media references in a read-only context; automated semantic planning and visual generation remain to be implemented.

```sh
pnpm run build
node dist/story.js --config config/story.json
```

The checked-in configuration selects the story directory for Tower of Babylon and supplies explicit read/element limits. Config paths resolve from the config file. The CLI prints JSON to stdout; help and errors use stderr. Code can call `loadStoryContext` from `src/modules/story/index.ts` directly through Effect.

The manifest's explicit `transcriptProvider` selects the format. OpenAI stories use `kind: "story-transcript"`, `gpt:wN` word IDs, exact GPT text/punctuation and initial sample positions. Their source book offset comes from audio verification, not Rev word IDs. Rev-only stories retain the paired format and are labelled as split text awaiting GPT. Both paths validate transcript identity, text and word counts, timing, audio identity and the original book interval. Downstream GPT loading does not reopen Rev files; the one-time timing seed records its Rev hash. Audio checks use the recorded verification manifest and actual file size; loading does not decode or rehash audio.

The pilot's narrative analysis is a separate, agent-authored document. Its timing windows are evidence for meaning, and the eventual visual timeline must also cover pauses and the audio before/after speech. The [source-check note](docs/research/great-silence-source-check.md) records published spellings for misrecognized names while preserving the raw transcript. Descriptions of story events, uncertain readings, and proposed visual details remain separate.

## Visual timeline

The `visual-timeline` module owns the storyboard for one verified clip, stored in the story directory `data/stories/<story>/` in two kinds of file. Generation records are immutable: any script writes `shots/<ulid>/record.json` with its image beside it, holding the clip identity (book, story, audio and transcript hashes, sample rate and count), an integer `startSample` on the clip's own clock, the mode, optional label/prompt/image/notes, `createdAt`, and the producer. The decisions overlay `decisions.json` is written only by the editor or CLI and holds per-shot overrides (`startSample`, `mode`, `selected`, `hidden`, `notes`) keyed by shot id, plus story settings such as the 16:9 frame aspect. Both files pin the clip identity, and every load verifies them against the story selected by `config/story.json`; a mismatch, an id that differs from its directory name, an image path outside its directory, or a decision for an unknown shot is an error that names the file.

The merge applies decision overrides over record fields, then groups shots with the same effective start as candidates. One candidate is selected per start: the explicitly selected one, otherwise the newest by `createdAt`. Hidden shots are never selected. The stitched timeline is the selected shots in start order, each holding until the next start and the last until the end of the clip; when nothing starts at sample 0 it opens with an explicit gap, so coverage is always total and visible.

```sh
pnpm run build
node dist/visual-timeline.js show --config config/visual-timeline.json
node dist/visual-timeline.js add --config config/visual-timeline.json --at-seconds 12.5 --mode graphic-illustration --label "Opening" --image path/to/image.png
```

`show` prints the records, decisions, candidate groups, and stitched timeline as JSON. `add` mints a ULID, copies the image (within the configured size limit) beside a new `record.json` written through a temporary file and rename, and prints the record; it never overwrites an existing shot. The configuration points at the story config and the story directory and sets explicit byte and count limits; paths resolve from the config file. Code can call `loadVisualTimeline`, `addShot`, and `writeDecisions` from `src/modules/visual-timeline/index.ts`.

### Seed import

The Great Silence starts populated (PIPELINE A33). A one-time import turns the 14 treatment spans and the 15 prototype panels into labeled study records under `shots/`, and writes a suggested `decisions.json` (the prototype's scene mix: graphic telescope, graphic neighboring parrots, poetic-abstraction listening) when none exists yet.

```sh
pnpm run build
node dist/visual-timeline-seed.js --config config/visual-timeline.json --treatment data/stories/the-great-silence/visual-treatment.md --prototype data/stories/the-great-silence/visual-prototype --dry-run
node dist/visual-timeline-seed.js --config config/visual-timeline.json --treatment data/stories/the-great-silence/visual-treatment.md --prototype data/stories/the-great-silence/visual-prototype
```

Treatment rows are parsed from the fixed six-column table under "Proposed sequences" and must be exactly 14 adjacent spans from 0 to the clip end; they become image-less records (`seed-treatment`). Each prototype board is checked against the hash in `assets.json`, cropped into thirds with ffmpeg (the wide board splits 341/342/341 px), verified with ffprobe, and imported as three image records carrying the board prompt (`seed-prototype`). Boards outside the two selected looks say so in their notes. Record ids are deterministic (sha256 of producer and a stable key, ULID-encoded with the fixed `createdAt`), so a re-run reports every record as unchanged; a record that differs from what would be written fails the run with the differing fields, and an existing `decisions.json` is never overwritten. `--dry-run` performs every check, including the crops, without writing. Pure helpers live in `src/modules/visual-timeline/seed.ts`.

## Editor client

The browser editor is the workspace package `packages/editor`: a Vite + React client that opens one verified story clip at a time and edits its visual timeline and word timing. The header has a story selector listing every story the server serves, grouped by book and shortest first; the open story rides in the URL as `?story=<story-id>` (a bare URL opens the server's default), so stories are bookmarkable and back/forward switch between them. Switching remounts the editor from scratch, and a story with unsaved changes asks before switching. It shows the letterboxed preview at the playhead, a transport with clip and book clocks, the waveform with detected speech regions shaded beneath it, up to three timing rows, the shot lane, and a panel for the shot under the playhead. The timeline toolbar has a Sentences / Words toggle and one toggle per row (Speech, Original, Auto, Edited), all remembered in the browser only. Sentences draws one box per chunk (a sentence, or a shorter run cut by a pause of at least the server's `chunking.pauseBreakMs`) with the words inside as clickable spans and the current word highlighted; Words draws one box per word. Either box is at least as wide as its spoken duration and grows into the following silence up to the next box, so text is only ellipsized when there is genuinely no room. The initial row (faint) shows the working transcript's initial positions, labelled GPT initial or Rev split, the Auto row shows only words the align script has placed, and the Edited row shows the effective times (manual, else auto, else original), with a yellow bar on words that have a manual value and a blue underline on words that have an auto value; the reference rows regroup their own chunks client-side using the pause and sentence-gap settings returned by the server. Clicking a word in any row seeks to that row's time for it. Decisions and word-timing edits save automatically 300 ms after each change under one Saved / Saving indicator; the working region is client-only and never saved.

```sh
pnpm --filter editor dev        # Vite dev server on http://127.0.0.1:5173, proxying /api to the editor server
pnpm --filter editor build      # typecheck, then static build into packages/editor/dist
pnpm --filter editor test       # pure-module tests (time, snap, chunks, selection, timing, merge, reducer) with node --test
```

For the API and Vite servers together, `scripts/editor-dev.sh start|restart|stop|status` manages this checkout's processes. The launcher starts detached processes with logs under `.dev/`, so they survive the calling terminal or tool command. Shutdown checks each process's command, working directory, and start time, sends TERM, and waits before any targeted KILL. PID files under `.dev/` are informational; `ps` and `lsof` provide the live checks.

The dev server proxies `/api` to `http://127.0.0.1:63620`, the editor server's port; set `EDITOR_API_PORT` to point it elsewhere. Without the real server, `node packages/editor/mock/server.mjs` lists two mock stories sharing one synthetic two-second clip on port `63621` (`MOCK_PORT` to change) with three timing layers, synthetic speech regions, and a canned align pass, and records every decisions and word-timing `PUT` at `/mock/puts` (read it on the mock's port directly; Vite only proxies `/api`); run the client against it with `EDITOR_API_PORT=63621 pnpm --filter editor dev`.

Timeline controls: click a word to seek and play, or a chunk's padding to seek to its start; drag a shot marker to move its start, snapping to chunk starts, word starts, and the midpoints of pauses of at least 300 ms, in that order of preference when equally near (hold Alt to disable); Ctrl/Cmd + wheel zooms; Space plays or pauses; Left/Right nudge 100 ms, with Shift 1 s; Home and End jump to the clip edges.

Word timing in the Edited row: click selects a word (or a whole sentence in Sentences mode), Shift-click extends the selection to a contiguous range, Escape clears it. Dragging any selected box moves every selected word by the same amount with durations preserved; the leading edge snaps to speech-region onsets within 8 px (Alt disables), the move is clamped so the group never crosses its unselected neighbours or the clip edges, and the toolbar shows the delta while dragging. Comma and period nudge the selection by 10 ms. Cmd/Ctrl+Z undoes and Shift+Cmd/Ctrl+Z redoes timing edits (client-side stack, each step autosaves). "Align selection" runs the server's automatic pass over the selected span and shows before → after median, p10, p90 boundary error and inside-speech fraction in the toolbar; there is no whole-clip button in the UI. A shot dropped on a word or sentence start is anchored to that word (`anchorWordId` in its decision) and follows the word's effective start; the marker carries an anchor glyph and the panel offers Detach, which keeps the current position as a plain `startSample`. Dropping a marker anywhere else detaches it.

## Editor server

The editor server is a thin Effect HTTP layer over the story, visual-timeline, and word-timing modules. It serves every story directory under the `storiesDirectory` named in `config/editor-server.json` on 127.0.0.1 with no authentication; the story selected through `config/visual-timeline.json` and `config/story.json` is the default and must live directly under that directory. The listing is taken once at start-up from each story's `story.json` (stories added later need a restart), the default story is verified before the server listens, and every other story is verified on its first open and kept for the process lifetime; a story that fails verification answers 500 and is retried on the next request. Records, decisions, and timing overlays are reread on every request because scripts write them independently, and a recursive watch on the open story's directory pushes change notices to the browser over server-sent events. Nothing in the server touches FFmpeg except the one-time waveform peaks and speech-region computation.

```sh
pnpm run build
node dist/editor-server.js --config config/editor-server.json --port 63620
node dist/editor-server.js --config config/editor-server.json --port 63620 --static packages/editor/dist
```

The listening URL, help, and errors go to stderr. Ctrl-C stops the server. With `--static`, files under the directory are served at `/` and `index.html` answers unknown paths without an extension for HTML navigations, so a single-page client can deep-link; without it, `/` is a short text pointer to the API.

All story routes are under `/api/stories/<story-id>/`; an id that is not in the listing is a 404 before any file is touched.

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

Errors are JSON `{ code, message }`: 400 for a bad request or invalid client-supplied decisions or timing, 404 for unknown shots and routes, 409 for an identity mismatch or an existing record, 413 for oversized bodies and uploads, 500 for invalid files on disk or a failed decode. `config/editor-server.json` names the stories directory, the visual-timeline config, the ffmpeg executable, the peaks bucket size and cache limit, the speech-detection parameters, the alignment lead and boundary pause, the watch debounce, the upload, request-timeout, and word-timing overlay size limits (`maxWordTimingBytes`; the auto overlay is about 90 bytes per word, so the 3.7-hour story needs several MB), and the chunking thresholds (`pauseBreakMs`, and `minSentenceBreakMs`: a transcriber's sentence mark only ends a chunk when the gap to the next word is at least this long, since a period with no audible pause behind it is treated as misplaced; the config value is the default and a story's `story.json` may override it under `chunking.minSentenceBreakMs`, which is how the rule is enabled story by story; the story payload lists every break merged this way under `chunking.mergedSentenceBreaks`); paths resolve from the config file. The pieces live in `src/modules/editor-server/`: `range.ts` (Range header parsing), `peaks.ts` (the shared decode, bucket reduction, and both caches), `chunks.ts` (sentence/pause chunking of the transcript), `timing.ts` (caches, the effective-timing merge for the story payload, and the align run), `routes.ts` (the config and story loaders, the story library, and the router layer), and `index.ts` (`makeEditorServer`, the full layer for `Layer.launch`).

## Word timing

The transcriber's word times lead the audio by roughly 150 ms on the pilot, so the `word-timing` module (`src/modules/word-timing/`) lets the editor and a script correct them without ever writing the paired transcript. Two overlay files in the story directory, both keyed by word id, holding `{ startSample, endSample }` on the clip clock, and pinned to the clip identity like `decisions.json`:

| File | Writer | Contents |
| --- | --- | --- |
| `word-timing.auto.json` | the align script only | `{ schemaVersion: 1, kind: "word-timing-auto", clip, updatedAt, producer, parameters: { leadMs, thresholdDbfs, minSilenceMs, minSpeechMs }, runs: [{ startSample, endSample, ranAt, report }], words }`. Each run replaces the entries for words whose original start lies in its range and appends itself to `runs`. |
| `word-timing.json` | the editor only | `{ schemaVersion: 1, kind: "word-timing-manual", clip, updatedAt, words }`. Replaced wholesale on every save. |

Effective timing is manual, else auto, else original, merged per request by the server before words, chunks, and shot anchors are served. Every entry must name a transcript word and satisfy `0 <= startSample < endSample <= sampleCount`; a bad file is an error naming it. Neighbouring words whose effective starts are out of order are not rejected (manual and auto entries mix freely) but are counted as `timing.inversions` in the story payload. A shot decision may carry `anchorWordId`; the shot then starts at that word's effective start, ahead of any `startSample` override, and moves with the word. `mergeTimeline` takes the map of effective word starts; callers without words pass an empty map, in which case anchors fall back to the override or record and are listed in `unresolvedAnchors`.

Speech regions come from the same ffmpeg decode as the waveform peaks: RMS per 10 ms frame in dBFS (a frame at digital zero is -Infinity), an absolute threshold of -50 dBFS, then cleanup in a fixed order: speech runs shorter than `minSpeechMs` are dropped first, silence runs shorter than `minSilenceMs` are bridged second, and a final pass guards against any short speech run remaining. The result is cached as `cache/speech.json` beside `cache/peaks.json` in the story directory (regenerable caches live under `cache/`, apart from source and work files), pinned to the audio hash and the three parameters.

The align pass (`alignRange`) is pure and takes the original transcript timing as input, never the overlays: the words whose original start lies in the range are shifted later by `alignment.leadMs`, each is assigned to the speech region it overlaps most (the nearest region when it overlaps none), and each region's words are mapped linearly so the earliest start lands on the region start and the latest end on the region end; a lone word fills its region. Regions are clipped to the range first, so no result leaves it, and a range with no region inside yields no entries. The report (`measureRange`) is computed before and after for the range: at phrase boundaries (the first word and every word following a pause of at least `alignment.boundaryPauseMs`), the median, p10, and p90 of the signed distance in ms from the word start to the nearest speech onset, plus the count and fraction of words lying wholly inside a speech region.

```sh
node dist/word-timing.js measure --config config/editor-server.json --from 0 --to 30
node dist/word-timing.js align   --config config/editor-server.json --from 0 --to 30 --dry-run
node dist/word-timing.js align   --config config/editor-server.json --from 0 --to 30
node dist/word-timing.js align   --config config/editor-server.json --all
node dist/word-timing.js align   --config config/editor-server.json --story exhalation --from 0 --to 30
```

`measure` prints the statistics for the original and the effective timing of the range without writing. `align` writes the range's entries into `word-timing.auto.json` and prints the run report; `--dry-run` prints without writing, and `--all` is the explicit whole-clip flag. `--story` names a directory under the editor config's `storiesDirectory`; without it the story config's default story is used. Ranges are in seconds and resolve to `[from, to)` on the clip clock. The editor reaches the same operations through `PUT /api/word-timing` and `POST /api/word-timing/align`, and reads the regions from `GET /api/speech`. Help and errors go to stderr.

## Known dependency details

Effect v4 is a release candidate. Its CLI declaration files currently contain a broken reference to an internal declaration, so `skipLibCheck` is explicitly enabled while application code remains strictly checked. No dependency patch is applied.

The pinned Redis client satisfies a required peer dependency of `@effect/platform-node`; this project does not configure a Redis server. Dependency versions, peer checks, and permitted installation hooks are explicit in the project configuration and lockfile.


## Working story transcription

Book-level Rev.ai transcription is used to identify and split stories. After selection, the story audio is transcribed by GPT and promoted to the working transcript. Planning, the editor, word timing and shot anchors then share the same GPT identity; GPT is no longer a read-only comparison row.

| File | Role |
| --- | --- |
| `transcript.json` / `transcript.txt` | Working GPT words and exact text. |
| `archive/rev/transcript.rev.json` / `transcript.rev.txt` | Tower of Babylon’s preserved Rev split evidence. Other stories still keep these files in their story root until archived. |
| `transcription/run.json`, `transcription/transcription-*.json` | Exact run configuration/audio hash and raw GPT responses. |
| `transcription/transcript.txt`, `joins.json`, `prepared.json` | Stitched output, overlap evidence and prepared working transcript. |
| `word-timing.auto.json` / `word-timing.json` | Automatic waveform timing and manual edits keyed by GPT IDs and the working transcript hash. |
| `archive/` | Earlier identities, overlays, Rev evidence and retired review material; see its README and relocation manifest. |

`config/story-transcription.json` explicitly selects `gpt-transcribe`, chunk size, overlap, encoding, concurrency, language and spelling hints. Its current hints are for Tower of Babylon; use story-appropriate explicit configuration for other stories. `OPENAI_API_KEY` comes from the environment or this repository's `.env`.

```sh
pnpm run build
python3 scripts/transcribe-story.py \
  --story data/stories/tower-of-babylon \
  --config config/story-transcription.json \
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
node scripts/promote-story-transcript.mjs \
  --story data/stories/tower-of-babylon \
  --input data/stories/tower-of-babylon/transcription/prepared.json
node dist/word-timing.js align --config config/editor-server.json --story tower-of-babylon --all
sh scripts/editor-dev.sh start
```

Transcription resumes only when the saved audio hash and configuration match. Joining refuses unreliable overlaps. Preparation preserves GPT wording and punctuation exactly. It currently bootstraps initial timing from the Rev split words supplied explicitly through `--seed`; this one-time dependency is recorded as `timing.method: "rev-seeded"`, and is not presented as GPT-generated timestamps. The standard waveform pass then adjusts those positions. A future audio-only forced aligner can replace the bootstrap without changing the working transcript contract.

Promotion validates the prepared transcript and run evidence, archives the prior identity and timing, and commits `story.json` to the new transcript hash. Identical promotion is a no-op. Stories with visual shots, shot decisions or nonempty manual word timing require an explicit mapping before changing transcript identity; the script refuses to discard that work. Stop the editor during promotion and restart it afterward, since story contexts are cached. A changed GPT text needs a new output run directory; existing run evidence is retained.

In the editor, **GPT initial**, **Auto**, and **Edited** are timing views of the same GPT words. Selection, manual timing, alignment and shot anchors operate on GPT IDs. Rev-only stories remain available as clearly labelled split evidence, with existing work preserved. Tower of Babylon's 9,808 GPT words and waveform adjustment are migrated; no new transcription request was made during this refactor.

Validation: `pnpm test`, `pnpm --filter editor test`, and `python3 scripts/test-story-transcription.py`.
