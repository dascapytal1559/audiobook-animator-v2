# Animator v2

Animator turns audiobooks into movies while keeping their original narration. The first visual milestone is moodboards over a selected story; the final direction is animation. The target is for at least 95% of story runs to complete without intervention after setup.

The working product decisions, evidence, and backlog are in [PIPELINE.md](PIPELINE.md). The TypeScript/Effect foundation, source inspection, live Rev AI transcription, paired transcript/audio splitting, and story inventory are implemented. Both collections have 17 exported stories, ready to browse by duration and synopsis in the local [story inventory](data/books/inventory.md). Movie production is still to be implemented.

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

The module is independently callable from `src/modules/source-media/index.ts`. It accepts an explicit request and uses Effect's filesystem and child-process services. The CLI is the application entry point; operational configuration belongs at that boundary.

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
| `data/books/<book>/split/` | Verified story audio, transcripts, and inventory. |
| `data/books/<book>/synopses.json` | Editable, premise-only story descriptions tied to the paired transcripts. |
| `data/books/<book>/inventory.md` | Readable book inventory with durations, synopses, and file links. |
| `data/books/inventory.md` and `inventory.json` | Combined story selection inventory, sorted by duration. |
| `data/demo/rev-ai/input/rev-export.json` | The original two-minute demo export. |

All `data/` files remain local. Source code, explicit configuration, project documents, and package files stay in the project root or their normal tracked folders. File moves preserve input bytes; `data/input-relocation.json` records the previous locations and matching hashes. Existing run evidence retains the paths used when those runs happened.

## Timestamp demo

The two-minute sample is near the opening of What's Expected of Us. A real Rev AI dashboard job returned 344 timed words. Its raw JSON, normalized transcript, source-clock mapping, audio, and playable viewer are local under `data/demo/rev-ai/` and excluded from Git.

To import the existing dashboard result and rebuild the viewer:

```sh
node dist/demo-transcription.js --config config/rev-demo.json --import-transcript data/demo/rev-ai/input/rev-export.json --job-id znnDmVYYcvkBwgit
node dist/demo-view.js --transcript data/demo/rev-ai/artifacts/transcript.json --output data/demo/rev-ai/demo.html
node dist/demo-serve.js --directory data/demo/rev-ai --port 63618
```

The preview is at `http://127.0.0.1:63618/demo.html`. Select a word to seek and play; both clip and original decoded-audio times are shown. The server supports byte ranges so audio seeking works, binds to loopback, and exposes only the demo HTML/audio.

Import and rendering make no provider requests. A separate API demo mode reads `REV_AI_API_KEY`, records its submitted job ID, and supports polling/resume; it has been tested with fake HTTP responses, not live credentials. Its explicit configuration limits submissions to 120 seconds. If saved job/submission records are missing but artifacts remain, it stops for reconciliation before contacting Rev.

The demo verifies that real timed data can be imported and played. The demo alone does not measure recognition accuracy, exact word alignment, or whole-book speech coverage. Exhalation now has separate transcript and audio evidence for its story boundaries, described below.

## Whole-book transcript import

The full-book path submits the original MP3 through the Rev AI dashboard and imports its JSON export locally. Both collections have completed this step. The prepare/import commands make no provider requests and need no API key:

```sh
node dist/book-transcription.js prepare --config config/rev-book.json
node dist/book-transcription.js import --config config/rev-book.json --transcript data/books/exhalation/input/rev-export.json --job-id eekQ2vQNJp3XjfF6
node dist/book-transcription.js import --config config/rev-stories-book.json --transcript data/books/stories-of-your-life-and-others/input/rev-export.json --job-id gbuckIu5tGOf8MiK
```

`config/rev-book.json` pins the Exhalation source hash and byte length. It explicitly supplies the audio stream, inspection settings, 17-hour/2-GB source limits, 64-MiB raw transcript limit, normalized-output limit, and timestamp tolerance. Config paths resolve from the config directory; command paths resolve from the working directory.

Preparation and import verify the original source through the source-media module. Artifacts under `data/books/exhalation/artifacts/` retain source inspection, preparation, exact raw transcript bytes, normalized words and punctuation, and plain text. Import requires the job ID shown for the exported file; dashboard JSON alone does not prove that association. Incompatible sources, job IDs, or exports cannot silently overwrite existing evidence.

Exhalation job `eekQ2vQNJp3XjfF6` returned 100,593 timed words; Stories of Your Life and Others job `gbuckIu5tGOf8MiK` returned 91,213. Both exact exports are retained. Whole-book word times use Rev's submitted-media timeline and remain unchanged. The original import records its clock mapping as unverified; later split evidence records the approximate mapping separately. Two independent transcript passes agree on all story and author-note ranges. Audio measurements locate the 19 internal cuts in quiet gaps on FFmpeg's decoded clock and measure the exact source endpoint. These checks support the cuts, while recognition accuracy and word alignment remain unmeasured. The existing clickable viewer is for the two-minute demo.

## Paired story splitting and inventory

The story-split module consumes a reviewed plan, slices the timed transcript, calls the verified audio extractor for every story and extra, and publishes a duration inventory after all pairs succeed. Discovery is separate: the first Exhalation plan was produced by agents using transcript content and measured audio gaps. A reusable autonomous discovery service is still to be implemented.

```sh
node dist/split-stories.js --plan data/books/exhalation/split-plan.json --source data/books/exhalation/input/book.mp3 --config config/story-split.json --validate-only
node dist/split-stories.js --plan data/books/exhalation/split-plan.json --source data/books/exhalation/input/book.mp3 --config config/story-split.json --output data/books/exhalation/split
```

The plan pins source, normalized transcript, provider job, raw export, and supporting evidence identities. It partitions every transcript element exactly once and supplies ordered, nonoverlapping integer audio sample intervals. The intervals use FFmpeg's decoded-audio clock, with an inclusive start and exclusive end. Source chapter metadata does not choose or override cuts. Validation checks the supplied plan and identities; it does not independently establish the semantic quality of a cut.

Each segment contains `audio/audio.flac`, an audio verification manifest, `transcript.json`, and `transcript.txt`. Audio uses lossless 24-bit FLAC at the source sample rate and channel count. The paired JSON retains original provider timestamps and element IDs, and adds approximate times relative to the segment audio. These times are not forced alignment.

The files `split/inventory.md` and `split/inventory.json` record every story's verified duration and audio/transcript links. Author notes and credits appear separately. Durations are computed from verified decoded sample counts, not source metadata or transcript endpoints. These completed split artifacts remain unchanged when story descriptions are edited.

The combined [17-story inventory](data/books/inventory.md) lists both collections from shortest to longest, with a short synopsis and file links for each story. Separate reading views cover [Exhalation](data/books/exhalation/inventory.md) and [Stories of Your Life and Others](data/books/stories-of-your-life-and-others/inventory.md). They link to the original split inventories for the books' eleven and ten extras respectively. Every segment has corresponding audio and transcript files. These artifacts remain local and are excluded from Git.

Independent acceptance for each book confirmed that recombining every segment exactly reconstructs the original transcript and the book's decoded 24-bit PCM. Each book has `paired-output-verification.json` recording the checks. All 83 tests pass, including six inventory tests and four planning-input tests. After moving the original inputs, real import and Exhalation split reruns also passed while preserving all 97 existing artifacts byte-for-byte; the cleanup evidence is in `data/input-relocation-verification.json`.

The checked-in configuration explicitly permits two concurrent segments, supplies all tool paths/timeouts and artifact limits, and allows a 0.1-second word-boundary tolerance. Tool paths resolve from the configuration file; source, transcript, and evidence paths resolve from the plan file. The output directory resolves from the working directory. An explicit `--source` supplies the current location of a moved source file; it resolves from the working directory and must match the source hash and audio details pinned by the plan. It does not change the historical plan or cut boundaries.

A compatible rerun verifies and reuses existing audio and paired files. A moved source is reusable when its content and media details match; the current locator is returned separately from historical source evidence. Changed content, processing configuration, tool versions, or corrupted artifacts fail rather than overwrite evidence. Output directories remain fixed for each saved run. Verified segments can be reused after a later segment fails; an incomplete audio publication stops for reconciliation. The complete machine-readable inventory is published last.

## Story synopses and reading inventories

Each book's `synopses.json` contains original, premise-only descriptions checked against its story transcripts. A description carries the canonical story ID/title and paired transcript hash, so it cannot silently attach to a different cut. Edit the descriptions there, then rebuild the reading inventories:

```sh
pnpm run build
node dist/story-inventory.js --config config/story-inventory.json
```

The independently callable module is `src/modules/story-inventory/index.ts`. Its explicit configuration supplies the books, input/output paths, and file-size limits; paths resolve from the config file. It requires exactly one matching synopsis for each story and checks transcript hashes, audio manifests, file links, and sample-based durations before publishing. It uses existing audio verification records without decoding audio or making provider requests.

The command updates the combined Markdown/JSON view and each book's readable Markdown view. The JSON retains exact durations, sample counts, file paths, and recorded hashes alongside the synopses. Human-readable durations are rounded to the nearest second. Invalid or stale inputs leave these views unchanged; valid description edits can be published repeatedly while the underlying split outputs stay intact.

## Current direction

The source chapter metadata is inaccurate and cannot decide story cuts. Both collections have now gone through whole-book transcription, transcript-led discovery, audio boundary checks, paired splitting, and inventories. The user has selected **The Great Silence (8:10)** for the first complete moodboard film. Its [story analysis](data/books/exhalation/planning/the-great-silence/story-analysis.md) describes 15 evidenced narrative beats and continuity constraints; visual direction is being aligned in `PIPELINE.md`. Reusable autonomous discovery remains outstanding. Metadata remains available for comparison. Provider limits and the first transcription approach are documented in [the research note](docs/research/whole-book-transcription.md).

Modules live under `src/modules/` and expose their own operations. A thin Effect CLI supplies concrete services. A pipeline runner, database, and distributed workers have not been selected.

## Visual comparison prototype

The first pilot has [five generated visual studies and a narrated comparison player](data/books/exhalation/planning/the-great-silence/visual-prototype/README.md). **Graphic illustration** and **poetic abstraction** are the two selected modes, available independently for each scene. The player opens in **Scene mix**, where either mode can be assigned to each of three opening scenes without restarting narration. Suggested assignments and user overrides are visible; choices survive switching views but reset on reload. The original style and interpretation comparisons remain available over the same 25-second passage, alongside the proposed pipeline.

The [full-story treatment draft](data/books/exhalation/planning/the-great-silence/visual-treatment.md) proposes 14 visual sequences across all 8:10. Scene assignments, precise timing, and final image count remain open; the generated studies are prototype material.

The [world model](data/books/exhalation/planning/the-great-silence/world-model.md) is the continuity reference for image generation: every character, place, instrument, and idea in the story with a canonical prompt description, the six time layers the narration moves between, the pairings that structure its argument, the shared palette and motifs, and numbered rules for what is never shown. Each fact is marked as stated in the narration, a confirmed name, a cited external reference, or a revisable design choice.

```sh
node data/books/exhalation/planning/the-great-silence/visual-prototype/server.mjs
```

Open [http://127.0.0.1:63619/](http://127.0.0.1:63619/). All five images and the exact built-in imagegen prompts are stored beside the prototype. The original story audio is streamed unchanged; the prototype saves no preferences.

## Story planning input

The `story-planning` module loads a verified story for downstream analysis. Its current deliverable is the original paired transcript and verified media references in a read-only context; automated semantic planning and visual generation remain to be implemented.

```sh
pnpm run build
node dist/story-planning.js --config config/story-planning.json
```

The checked-in configuration selects The Great Silence, pins its split inventory hash and collection title, and supplies explicit read/element limits. Config paths resolve from the config file. The CLI prints JSON to stdout; help and errors use stderr. Code can call `loadStoryContext` from `src/modules/story-planning/index.ts` directly through Effect.

The context retains the complete existing paired transcript, including raw words, punctuation, stable element IDs, original book indexes, provider timestamps, and approximate story-relative word times. It also supplies the exact sample-based duration and resolved audio/transcript paths. Loading checks the inventory and transcript identities, source pairing, element references, timing, and text consistency. Audio checks use the recorded verification manifest and actual file size; loading does not decode or rehash the audio.

The pilot's narrative analysis is a separate, agent-authored document. Its timing windows are evidence for meaning, and the eventual visual timeline must also cover pauses and the audio before/after speech. The [source-check note](docs/research/great-silence-source-check.md) records published spellings for misrecognized names while preserving the raw transcript. Descriptions of story events, uncertain readings, and proposed visual details remain separate.

## Visual timeline

The `visual-timeline` module owns the storyboard for one verified clip, stored under `data/books/<book>/planning/<story>/` in two kinds of file. Generation records are immutable: any script writes `shots/<ulid>/record.json` with its image beside it, holding the clip identity (book, story, audio and transcript hashes, sample rate and count), an integer `startSample` on the clip's own clock, the mode, optional label/prompt/image/notes, `createdAt`, and the producer. The decisions overlay `decisions.json` is written only by the editor or CLI and holds per-shot overrides (`startSample`, `mode`, `selected`, `hidden`, `notes`) keyed by shot id, plus story settings such as the 16:9 frame aspect. Both files pin the clip identity, and every load verifies them against the story selected by `config/story-planning.json`; a mismatch, an id that differs from its directory name, an image path outside its directory, or a decision for an unknown shot is an error that names the file.

The merge applies decision overrides over record fields, then groups shots with the same effective start as candidates. One candidate is selected per start: the explicitly selected one, otherwise the newest by `createdAt`. Hidden shots are never selected. The stitched timeline is the selected shots in start order, each holding until the next start and the last until the end of the clip; when nothing starts at sample 0 it opens with an explicit gap, so coverage is always total and visible.

```sh
pnpm run build
node dist/visual-timeline.js show --config config/visual-timeline.json
node dist/visual-timeline.js add --config config/visual-timeline.json --at-seconds 12.5 --mode graphic-illustration --label "Opening" --image path/to/image.png
```

`show` prints the records, decisions, candidate groups, and stitched timeline as JSON. `add` mints a ULID, copies the image (within the configured size limit) beside a new `record.json` written through a temporary file and rename, and prints the record; it never overwrites an existing shot. The configuration points at the story-planning config and the planning directory and sets explicit byte and count limits; paths resolve from the config file. Code can call `loadVisualTimeline`, `addShot`, and `writeDecisions` from `src/modules/visual-timeline/index.ts`.

### Seed import

The Great Silence starts populated (PIPELINE A33). A one-time import turns the 14 treatment spans and the 15 prototype panels into labeled study records under `shots/`, and writes a suggested `decisions.json` (the prototype's scene mix: graphic telescope, graphic neighboring parrots, poetic-abstraction listening) when none exists yet.

```sh
pnpm run build
node dist/visual-timeline-seed.js --config config/visual-timeline.json --treatment data/books/exhalation/planning/the-great-silence/visual-treatment.md --prototype data/books/exhalation/planning/the-great-silence/visual-prototype --dry-run
node dist/visual-timeline-seed.js --config config/visual-timeline.json --treatment data/books/exhalation/planning/the-great-silence/visual-treatment.md --prototype data/books/exhalation/planning/the-great-silence/visual-prototype
```

Treatment rows are parsed from the fixed six-column table under "Proposed sequences" and must be exactly 14 adjacent spans from 0 to the clip end; they become image-less records (`seed-treatment`). Each prototype board is checked against the hash in `assets.json`, cropped into thirds with ffmpeg (the wide board splits 341/342/341 px), verified with ffprobe, and imported as three image records carrying the board prompt (`seed-prototype`). Boards outside the two selected looks say so in their notes. Record ids are deterministic (sha256 of producer and a stable key, ULID-encoded with the fixed `createdAt`), so a re-run reports every record as unchanged; a record that differs from what would be written fails the run with the differing fields, and an existing `decisions.json` is never overwritten. `--dry-run` performs every check, including the crops, without writing. Pure helpers live in `src/modules/visual-timeline/seed.ts`.

## Editor client

The browser editor is the workspace package `packages/editor`: a Vite + React client that opens one verified story clip and edits its visual timeline. It shows the letterboxed preview at the playhead, a transport with clip and book clocks, the waveform/word/shot lanes, and a panel for the shot under the playhead. Decisions save automatically 300 ms after each change; the working region is client-only and never saved.

```sh
pnpm --filter editor dev        # Vite dev server on http://127.0.0.1:5173, proxying /api to the editor server
pnpm --filter editor build      # typecheck, then static build into packages/editor/dist
pnpm --filter editor test       # pure-module tests (time, snap, merge, reducer) with node --test
```

The dev server proxies `/api` to `http://127.0.0.1:63620`, the editor server's port; set `EDITOR_API_PORT` to point it elsewhere. Without the real server, `node packages/editor/mock/server.mjs` serves a synthetic two-second clip on port `63621` (`MOCK_PORT` to change) and records every `PUT /api/decisions` at `/mock/puts`; run the client against it with `EDITOR_API_PORT=63621 pnpm --filter editor dev`.

Timeline controls: click a word to seek and play; drag a shot marker to move its start, snapping to word starts and to the midpoints of pauses of at least 300 ms (hold Alt to disable); Ctrl/Cmd + wheel zooms; Space plays or pauses; Left/Right nudge 100 ms, with Shift 1 s; Home and End jump to the clip edges.

## Editor server

The editor server is a thin Effect HTTP layer over the story-planning and visual-timeline modules. It serves exactly one verified story, the one selected through `config/visual-timeline.json` and `config/story-planning.json`, on 127.0.0.1 with no authentication. The story is verified once at start-up; records and decisions are reread on every request because scripts write them independently, and a recursive watch on the planning directory pushes change notices to the browser over server-sent events. Nothing in the server touches FFmpeg except the one-time waveform peaks computation.

```sh
pnpm run build
node dist/editor-server.js --config config/editor-server.json --port 63620
node dist/editor-server.js --config config/editor-server.json --port 63620 --static packages/editor/dist
```

The listening URL, help, and errors go to stderr. Ctrl-C stops the server. With `--static`, files under the directory are served at `/` and `index.html` answers unknown paths without an extension for HTML navigations, so a single-page client can deep-link; without it, `/` is a short text pointer to the API.

| Route | Purpose |
| --- | --- |
| `GET /api/story` | Clip identity, story and book titles, `sourceStartSample` (the clip's start on the book clock, for a book-time display), and the transcript words with `startSample`/`endSample` on the clip clock. |
| `GET /api/timeline` | The `loadVisualTimeline` result: records (with `imageUrl` when a record has an image), decisions, candidate groups, and the stitched timeline. |
| `PUT /api/decisions` | Body `{ settings, shots }`; validates and replaces `decisions.json` atomically, then returns the fresh timeline. Bounded by `maxDecisionsBytes`. |
| `POST /api/shots` | `multipart/form-data` with `startSample` or `startSeconds`, `mode`, optional `label`, `prompt`, `notes`, and an optional `image` file (`.png`, `.jpg`, `.jpeg`, `.webp`). Creates an immutable record through `addShot` with producer `editor`. Returns 201 with the record. |
| `GET /api/shots/:id/image` | The record's image with its content type; 404 for anything that is not a ULID-named record with a supported image. |
| `GET /api/audio` | The story FLAC with `Accept-Ranges: bytes`, single byte ranges (206, 416 with the size, 200 otherwise), and HEAD. |
| `GET /api/peaks` | Waveform peaks: `{ schemaVersion: 1, audioSha256, sampleRateHz, sampleCount, samplesPerBucket, min, max }` with int16 extremes per bucket, the last bucket partial. Computed once with `ffmpeg` streaming mono s16le into a running reduction, checked against the verified sample count, written atomically to `<planningDirectory>/peaks.json`, and recomputed whenever the cache's pins differ. |
| `GET /api/events` | Server-sent events: `ready` on connect, `timeline-changed` (debounced) after any change under the planning directory, and a comment heartbeat every 15 seconds. The client refetches `/api/timeline`; no payload is pushed. |

Errors are JSON `{ code, message }`: 400 for a bad request or invalid client-supplied decisions, 404 for unknown shots and routes, 409 for an identity mismatch or an existing record, 413 for oversized bodies and uploads, 500 for invalid files on disk or a failed peaks decode. `config/editor-server.json` names the visual-timeline config, the ffmpeg executable, the peaks bucket size and cache limit, the watch debounce, and the upload and request-timeout limits; paths resolve from the config file. The pure pieces live in `src/modules/editor-server/`: `range.ts` (Range header parsing), `peaks.ts` (bucket reduction and cache), `routes.ts` (the router layer), and `index.ts` (`makeEditorServer`, the full layer for `Layer.launch`).

## Known dependency details

Effect v4 is a release candidate. Its CLI declaration files currently contain a broken reference to an internal declaration, so `skipLibCheck` is explicitly enabled while application code remains strictly checked. No dependency patch is applied.

The pinned Redis client satisfies a required peer dependency of `@effect/platform-node`; this project does not configure a Redis server. Dependency versions, peer checks, and permitted installation hooks are explicit in the project configuration and lockfile.
