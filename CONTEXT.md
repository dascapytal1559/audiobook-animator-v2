# Animator: context

Shared working document for the user and the lead agent: the target, the pipeline, the words we use, the decisions with their reasons, and the backlog. Agent directives are in `AGENTS.md`; humans read `README.md`; the human roadmap is `HUMAN.md`.

Updated: 2026-09-18, Australia/Melbourne. Alignment is ongoing; an open question is not an approved requirement. Implementation can proceed on settled modules while other branches are discussed.

## Target

Turn audiobooks into movies, starting with individual stories from two collections by Ted Chiang.

- Keep the original audiobook narration and build the movie around it. **Confirmed Q1.**
- After book-level setup, at least 95% of story runs should complete without human intervention. Track human time separately. Routine stage approvals are not the intended operating model. **Confirmed Q2.**
- Use a modular TypeScript application based on Effect. Adopt an exactly pinned Effect v4 release candidate and accept deliberate upgrades. **Confirmed Q3.**
- First product module: **split-to-short-stories**.
- First visual milestone: **moodboards over the story's narration**. The final product should be animated. **Confirmed Q6.**
- Prioritize getting individual stories selectable so creative iteration can start. The eventual audio should be mostly narration; detailed trimming and pacing changes can come later. **Q4 direction.**
- Split both the transcript and corresponding audio for all stories in the returned book, then show an inventory with every story's duration. The user chooses a story from that inventory. **Confirmed Q8.**
- Include a synopsis for every story in the inventory. **Confirmed inventory follow-up.**
- Use **The Great Silence (8:10)** for the first complete moodboard film. **Confirmed Q9.**
- Keep **graphic illustration** and **poetic abstraction** available as visual modes, chosen per scene. The film can combine both, and the user can change individual scenes. **Confirmed Q10/Q11 prototype response.**
- Build a **story editor centred on one verified audio clip**. It is first a visual layer over script-generated storyboard shots: scripts write shots at times, the frontend stitches them against the narration and lets the user view and adjust them. Finer-detail generation features are added to the frontend over time. **Confirmed Q12.**
- Existing chapter metadata is inaccurate, as explicitly confirmed by the user. It cannot decide story cuts or serve as a fallback when transcript evidence is uncertain. The plan is whole-book transcription before story discovery and extraction. **Q5 response and full-book follow-up; A7.**

The autonomy percentage is a target, not a demonstrated result. A successful run must pass output checks; silently producing poor or incomplete output does not count as autonomous success. The denominator, exception categories, and quality gates will be made explicit as the relevant modules are designed.

## Pipeline overview

1. **Audiobook input and inspection:** identify the source, audio stream, chapter metadata, and other boundary evidence.
2. **Book-level timed transcription:** produce a transcript on the original audio timeline. A provider may use technical chunks internally without defining the stories.
3. **Story discovery, paired splitting, and inventory:** identify narrative boundaries from the spoken content and word timestamps, verify them against the audio, split the transcript and corresponding audio for every story, then list the stories with verified durations and short synopses. The user selects from that inventory. Metadata may be retained for comparison but cannot set or override a cut.
4. **Story transcription and alignment:** transcribe selected story audio with GPT, promote it as the working text, and align its words to the waveform. Rev.ai remains book-splitting evidence. Tower of Babylon is migrated; other stories await their GPT pass. Initial timing currently uses a recorded one-time Rev seed.
5. **Story planning:** understand the narrative, identify meaningful beats, and describe the people, places, objects, and continuity needed to visualize it. Link factual claims to the transcript and distinguish interpretation from visual invention.
6. **Visual timeline:** plan visuals against the narration timeline.
7. **Moodboard movie, then animation:** first overlay moodboards on narration; later animate the visuals while preserving story continuity.
8. **Polish:** ambience and music, with narration remaining the primary soundtrack.

The foundation, source inspection, timestamp demo, whole-book transcript import, and verified audio extraction are implemented. Both collections have completed transcripts, reviewed split plans, and all 38 paired outputs. The combined inventory contains 17 stories with durations and premise-only synopses; notes and credits are available separately. Independent whole-book reconstruction checks passed for each book's audio and transcript. Later movie stages still need delivery contracts and acceptance criteria.

## Glossary

Use these words in code, documents, and conversation; a schema comment defers to this list.

| Term | Meaning |
| --- | --- |
| book | One audiobook as delivered: the original MP3 and its whole-book Rev export under `data/books/<book>/`. |
| intake | Everything that turns a book into story directories: inspection, whole-book transcription, the split plan, audio extraction, and the split. Frozen; bespoke for a new book if need be. |
| story | The unit of all creative work: one narrative from a book, living in `data/stories/<id>/` with its verified audio and transcript. The folder name is the story id. |
| manifest | `story.json`: the story's identity, file locators with hashes, origin, and editable synopsis. Verified against its files on every load. |
| clip | The story's audio as the editor and timeline see it; the clip clock counts integer samples from the clip's first sample. |
| clip identity | Book id, story id, audio hash, transcript hash, sample rate, sample count. Every per-story artifact carries it and is refused on mismatch. |
| segment | A slice of a book produced by the split: a story or an extra. Historical term; a story's `originalSegmentPath` points at where its segment was. |
| extra | An author's note or credits, split from the book and kept with the book under `split/segments/`. Never a story. |
| working transcript | The story's `transcript.json`: Rev split text by default, or GPT text once promoted. Written only by `animator transcription promote`. |
| element | One word (with timing) or one piece of punctuation, in transcript order. |
| overlay | A file keyed to the transcript that changes what is read without changing the transcript: `word-timing.auto.json`, `word-timing.json`, `decisions.json`. |
| record, shot | An immutable generation record under `shots/<ulid>/record.json`, possibly with an image beside it: a start on the clip clock, a mode, a producer. |
| image track | An independent visual sequence over a story's narration. Each draft has its own image track; the editor previews one track at a time. Existing shots belong to `main`. |
| decision | A per-shot override or selection in `decisions.json`, written only by the editor or a CLI verb. |
| candidate group | Every shot in one image track with the same effective start; one is selected, by decision or newest-wins. |
| stitched timeline | Each image track's selected shots in order, each holding until its track's next start, with an explicit opening gap when nothing starts at sample 0. |
| chunk | A run of words the editor draws as one box: ended by a sentence mark with an audible gap, a long pause, or the end. |
| sentence | A unit of the working text delimited by sentence punctuation, with abbreviations and quoted continuations accounted for. Its membership does not depend on narration gaps or timing edits. |
| subtitle cue | The text displayed together over the picture: a whole sentence when it fits, otherwise one successive phrase from that sentence. It follows its words' effective timing independently of shots. |
| story map | `story-map.json`: a story's subjects and sections as ranges of transcript word ids, pinned to the clip identity. Written by agents and scripts, read by the Scenes and Cast & world sections and `story map`. |
| subject | A character, location, object, or motif that recurs in a story, with a stable id, its mentions, and optional reference images. |
| mention | An inclusive run of words where the narration names or clearly refers to a subject. |
| section | A run of the narration with a structural role: act, chapter, scene, or beat. Sections nest by containment. |
| Scenes | The editor section that shows the story map as scenes: structure on the left, one scene's detail (heading, summary, subjects, its image and description takes, transcript passage) on the right, seeking the shared playhead (A63). |
| take | One source's output for a scene, shown beside the others and never picked by the editor: an image track's shot at the scene's start, or one model's description of it recorded in `scene-descriptions.json` (A63). |
| Cast & world | The editor section that shows the story map as subjects: the cast grouped by kind on the left, the selected subject's detail on the right, seeking the shared playhead (A63). |
| speech region | A span the energy detector calls speech; the snap targets and the align pass use them. |
| run | One invocation of a tool: its effective settings are the code defaults with an optional run file laid over them, and its outputs record them. |
| settings | The values a run uses, one section per module: `story`, `timeline`, `editor`, `inventory`, `transcription`. |
| cache | Regenerable derived data under `<story>/cache/`, pinned to the audio hash and the parameters that produced it. |
| producer | Who wrote an artifact and at what version. |
| domain | `packages/domain`: the shapes and pure rules shared by the server, the CLIs, and the browser. |
| core | `src/core/`: the Node-side io every module shares. |

## Recommended next milestones

The immediate product milestone is **one complete, watchable moodboard film using a selected story's original narration**. This follows Q4's priority of starting creative work on individual stories and Q6's visual milestone. The proposed delivery order below is the lead agent's recommendation; The Great Silence is confirmed as the pilot, with graphic illustration and poetic abstraction available per scene. The remaining creative brief, generation budget, and visual acceptance criteria are still open.

| Order | Outcome | Modules and evidence of completion |
| --- | --- | --- |
| 1 | A pilot story and creative direction | The Great Silence is selected (Q9). Develop a book-level brief covering visual style, interpretation, audience, and spending limits, with an explicit story override if needed. Pilot iteration establishes the brief; it does not introduce routine production-stage approvals. |
| 2 | A source-grounded story plan | B08 produces narrative beats, perspective, recurring people/places/objects, and important changes. Evidence points to existing transcript element IDs. Stated facts, uncertain readings, and creative visual choices remain distinguishable. |
| 3 | A complete visual treatment on the narration timeline | B09 specifies what the viewer sees and why, with image holds and changes driven by meaning and pacing. Keep narration/reveal order and cover the entire story audio, including titles and quiet intervals. |
| 4 | A playable moodboard film | B10 produces consistent reference images and story images, then composes them with the original narration. Review the whole film for coherence, continuity, pacing, and support of the narration. File validity alone is insufficient. |
| 5 | A repeatable story-to-film run | Repeat on a contrasting story and refine the reusable pipeline. B12 records completion, cost, retries, and interventions; supports resume and selective regeneration; and measures unattended runs against the agreed quality criteria. |
| 6 | An animated story film | Build animation from the story plan, visual references, and narration timing established by the moodboard film. Adapt shot lengths to the chosen animation capabilities; then address ambience/music and final polish under B11. |

Recovery, reuse, explicit cost limits, and run records belong in each new module from its first real execution. Broader orchestration should follow the needs demonstrated by these runs. B06 reusable story discovery and B07 production transcription submission remain part of the full audiobook pipeline; the 17 prepared stories already supply the inputs for the visual pilot.

The main product uncertainty is now visual interpretation: how to turn narrated scenes, reflections, and explanations into a coherent viewing experience. Keep story planning focused on the fields exercised by the first film.

## Decision tree

```text
Audiobook -> movie
├── Original narration retained [Q1 confirmed]
│   └── Moodboards over narration first; animated final product [Q6 confirmed]
│       ├── One complete visual pilot: The Great Silence [Q9 confirmed]
│       ├── Source-grounded story plan -> visual timeline -> images and composition
│       ├── Graphic illustration / poetic abstraction per scene [Q10/Q11 confirmed]; production settings and quality criteria [open]
│       ├── Scene images: hosted GPT-5.4 Image 2, local Qwen Image 2.1 as free fallback [A64]
│       └── Story editor centred on one audio clip [Q12 confirmed]
│           ├── Viewer over script-generated shots first; frontend generation later [Q12]
│           ├── Vite + React client in its own workspace package [Q13, A28]
│           ├── Operations: waveform/words/seek, span edit, mode, image attach, loop, seed [Q14]
│           ├── Assign existing images only in v1 [Q15]; whole clip, unsaved working region [Q16]
│           ├── Two layers: immutable generation records + decisions overlay [Q17, A19, A25, A32]
│           ├── Shot = start point with hold until next shot [Q18, A30, A31]
│           ├── Schema is the contract, CLI is a convenience [Q19]
│           ├── 16:9 letterboxed preview, per-story setting [Q20]
│           ├── Old prototype player discarded [A17]; behaviours from demo viewer carried [A24]
│           ├── Preview subtitles: whole sentences or automatic phrases, optional word highlighting; export and manual subtitle editing later [A61]
│           ├── Story map: subjects and sections as word ranges, read-only in the browser [A62]
│           ├── One editor page of collapsible sections: Video, Scenes, Cast & world, transport, lanes [A63]
│           └── Word timing alignment against the audio [Q21–Q25 confirmed 2026-09-09]
│               ├── Overlay files, transcript untouched; script and editor own separate files [A36, A42]
│               ├── Three visible tracks: Original, Auto, Edited [A52]
│               ├── Contiguous selection, translate-only group drag, autosave, undo [Q21, A38–A41, A53]
│               ├── Shots anchor to a word and detach when moved [Q22, A51]
│               ├── Energy-only first pass: lead shift + phrase snap + interior scale [Q24, A45–A48]
│               └── Excerpt-first application; whole clip on explicit say-so [Q23, A43]
├── >=95% unattended story runs after setup [Q2 confirmed]
│   └── Verified completion and reusable artifacts [A5]
│       └── Later: quality gates, exception handling, measurement details
├── Modular TypeScript / Effect v4 RC [Q3 confirmed]
│   ├── Fresh v2 implementation [A1]
│   ├── Validated module contracts and explicit services [A2]
│   └── Local CLI, Node LTS, pnpm, exact pins [A3]
└── Split-to-short-stories
    ├── Preserve originals and source-relative timing [A4]
    ├── Credits and notes kept separately [A6]
    ├── Source inspection and metadata evidence preservation [implemented]
    ├── Selectable stories first; detailed narration trims/pacing later [Q4 direction]
    ├── All stories get corresponding audio/transcript splits and duration inventory before selection [Q8 confirmed]
    ├── Lossless FLAC at source rate/channels, integer-sample extraction [A9]
    └── Metadata confirmed inaccurate; cannot decide cuts [Q5 and follow-up]
        ├── Transcribe before story discovery/extraction [A7]
        ├── Technical chunks retain book timing and do not define stories [A8]
        ├── Small Rev AI timestamp demo [Q7 confirmed; completed]
        ├── Full Exhalation transcript imported [100,593 timed words]
        ├── Transcript-led story/note partition and decoded-audio boundary checks [complete]
        └── Paired splits and duration inventory [both collections complete; 17 stories ready]
```

## Decisions

One file per decision under [docs/decisions](docs/decisions/), each with its status, the decision, the reason, and the code that cites it. Challenging one reopens what depends on it.

| ID | Decision | Status |
| --- | --- | --- |
| A1 | [Build fresh v2 contracts, using legacy assets and useful behavior as reference.](docs/decisions/A1-build-fresh-v2-contracts-using.md) | standing |
| A2 | [One application with focused modules.](docs/decisions/A2-application-focused-modules.md) | standing |
| A3 | [Start with a local CLI, Node LTS, pnpm, and exact dependency/configuration pins.](docs/decisions/A3-start-local-cli-node-lts.md) | standing |
| A4 | [Keep original audio unchanged and preserve source-relative timing for every cut.](docs/decisions/A4-keep-original-audio-unchanged-preserve.md) | standing |
| A5 | [Completion requires verified outputs, and verified work should be reusable on reruns.](docs/decisions/A5-completion-requires-verified-outputs-verified.md) | standing |
| A6 | [Preserve credits and author's notes as separately classified material; story jobs process stories.](docs/decisions/A6-preserve-credits-author-s-notes.md) | standing |
| A7 | [Transcribe the audiobook before discovering story boundaries and extracting stories.](docs/decisions/A7-transcribe-audiobook-before-discovering-story.md) | standing |
| A8 | [Any technical transcription chunks retain the original book timeline and do not define stories or alter source audio.](docs/decisions/A8-any-technical-transcription-chunks-retain.md) | standing |
| A9 | [Export story audio as lossless 24-bit FLAC at the source sample rate and channel count, with a matching timed transcript beside it.](docs/decisions/A9-export-story-audio-lossless-24.md) | standing |
| A10 | [First story cuts retain spoken titles and complete narration at the original pace.](docs/decisions/A10-first-story-cuts-retain-spoken.md) | standing |
| A11 | [Group local originals and raw exports under each book's `input/` directory, with `data/inbox/` for new downloads.](docs/decisions/A11-group-local-originals-raw-exports.md) | standing |
| A12 | [Keep selection synopses short and focused on the premise, without revealing endings.](docs/decisions/A12-keep-selection-synopses-short-focused.md) | standing |
| A13 | [Story plans distinguish facts supported by the transcript, uncertain interpretations, and invented visual details.](docs/decisions/A13-story-plans-distinguish-facts-supported.md) | standing |
| A14 | [Plan visual beats around changes in action, idea, emotion, or setting, while retaining the narration's order and intended reveals.](docs/decisions/A14-plan-visual-beats-around-changes.md) | standing |
| A15 | [The planner proposes each scene's visual mode, and a user can override any scene.](docs/decisions/A15-planner-proposes-scene-s-visual.md) | standing |
| A16 | [Use recurring motifs and the prototype's related green/blue/warm-gold palette to connect the two modes in the pilot.](docs/decisions/A16-use-recurring-motifs-prototype-s.md) | standing |
| A17 | [Discard the prototype comparison player and its server.](docs/decisions/A17-discard-prototype-comparison-player-server.md) | standing |
| A18 | [The editor opens exactly one verified story segment at a time, chosen by book and story ID, with The Great Silence as the default.](docs/decisions/A18-editor-opens-exactly-verified-story.md) | amended |
| A19 | [A `visual-timeline` module owns two schemas per story: immutable generation records under `data/stories/<story>/shots/` and a `decisions.json` overlay beside them.](docs/decisions/A19-module-owns-two-schemas-per.md) | standing |
| A20 | [Time on the timeline is stored as integer samples on the clip's own clock, zero at clip start.](docs/decisions/A20-time-timeline-stored-integer-samples.md) | standing |
| A21 | [The editor previews in the browser.](docs/decisions/A21-editor-previews-browser.md) | standing |
| A22 | [Waveform peaks are computed server-side once, cached beside the clip, and served with byte-range audio streaming.](docs/decisions/A22-waveform-peaks-computed-server-side.md) | standing |
| A23 | [The editor server binds to loopback with no authentication.](docs/decisions/A23-editor-server-binds-loopback-no.md) | standing |
| A24 | [Word-click seeking, follow-playback highlighting, and dual clip-time and book-time clocks are carried from the demo viewer as behaviours, re-implemented in the new stack.](docs/decisions/A24-word-click-seeking-follow-playback.md) | standing |
| A25 | [Several generation records may target the same time.](docs/decisions/A25-several-generation-records-may-target.md) | standing |
| A26 | [Files are the only channel between scripts and the frontend.](docs/decisions/A26-files-channel-between-scripts-frontend.md) | standing |
| A27 | [The editor server is a thin Effect HTTP layer in the root package over module operations.](docs/decisions/A27-editor-server-thin-effect-http.md) | standing |
| A28 | [The React client is a new `packages/editor` workspace package with exactly pinned Vite and React.](docs/decisions/A28-react-client-new-workspace-package.md) | standing |
| A29 | [Preview is image swapping in the browser synced to audio playback, not a video file.](docs/decisions/A29-preview-image-swapping-browser-synced.md) | standing |
| A30 | [Each generation record is a directory `shots/<shot-id>/` with `record.json` and its image beside it.](docs/decisions/A30-generation-record-directory-image-beside.md) | standing |
| A31 | [A record's image is optional.](docs/decisions/A31-record-s-image-optional.md) | standing |
| A32 | [Decisions are keyed by shot ID and hold overrides for `startSample`, `mode`, `selected`, and `hidden`, plus story-level settings such as frame aspect.](docs/decisions/A32-decisions-keyed-shot-id-hold.md) | standing |
| A33 | [The 15 prototype frames and the 14 treatment spans are imported once as generation records with their origin as `producer`, labeled as studies.](docs/decisions/A33-15-prototype-frames-14-treatment.md) | standing |
| A34 | [Dragging a shot start snaps to the nearest word start or measured quiet-gap midpoint within a small pixel radius; a modifier disables snapping.](docs/decisions/A34-dragging-shot-start-snaps-nearest.md) | standing |
| A35 | [Vite, React, and the peaks format receive exact version pins looked up at implementation time.](docs/decisions/A35-vite-react-peaks-format-receive.md) | standing |
| A36 | [Word timing edits live in overlay files in the story's story directory, keyed by word id, holding `startSample`/`endSample` on the clip clock and pinned to the transcript hash.](docs/decisions/A36-word-timing-edits-live-overlay.md) | standing |
| A37 | [The server merges effective timing before words, chunks, and snap targets are served.](docs/decisions/A37-server-merges-effective-timing-before.md) | standing |
| A38 | [Selection is a contiguous range and client-only: click selects, shift-click extends, Escape clears.](docs/decisions/A38-selection-contiguous-range-client-click.md) | standing |
| A39 | [A group move is a horizontal drag of any selected box; every selected word's start shifts by the same amount and ends ride along, so durations are preserved.](docs/decisions/A39-group-move-horizontal-drag-any.md) | standing |
| A40 | [A moved group clamps against its unselected neighbours so order and non-overlap are preserved.](docs/decisions/A40-moved-group-clamps-against-unselected.md) | standing |
| A41 | [Undo and redo for timing edits with the usual keys, client-side stack.](docs/decisions/A41-undo-redo-timing-edits-usual.md) | standing |
| A42 | [Two files, two writers: the script owns `word-timing.auto.json`; the editor owns `word-timing.json`.](docs/decisions/A42-two-files-two-writers-script.md) | standing |
| A43 | [Excerpt-first: the automatic pass runs on the editor selection or an explicit CLI range; the whole clip requires an explicit flag and the user's say-so.](docs/decisions/A43-excerpt-first-automatic-pass-runs.md) | standing |
| A44 | [Detected speech regions are shaded under the waveform.](docs/decisions/A44-detected-speech-regions-shaded-waveform.md) | standing |
| A45 | [Speech detection is explicit config: absolute -50 dBFS on 10 ms RMS frames, minimum silence 150 ms, minimum speech 50 ms.](docs/decisions/A45-speech-detection-explicit-config-absolute.md) | standing |
| A46 | [Speech regions are computed in the same FFmpeg decode as peaks and cached beside them under `<story>/cache/`, pinned to the audio hash.](docs/decisions/A46-speech-regions-computed-same-ffmpeg.md) | standing |
| A47 | [The align algorithm is a pure function in a `word-timing` module: shift the range's words by the configured lead (default 150 ms), assign each word to the speech region it overlaps most, snap each region's first start and last end to the region edges, scale interior words linearly.](docs/decisions/A47-align-algorithm-pure-function-module.md) | standing |
| A48 | [Every align run reports before and after for its range: median boundary error, spread, and fraction of words fully inside speech.](docs/decisions/A48-align-run-reports-before-after.md) | standing |
| A49 | [Server routes for speech regions, manual timing writes, and a ranged align; the CLI exposes the same align operation.](docs/decisions/A49-server-routes-speech-regions-manual.md) | standing |
| A50 | [Build order: speech shading, then selection and group move, then the automatic pass on the first 30 seconds, each landing on the running dev server.](docs/decisions/A50-build-order-speech-shading-then.md) | standing |
| A51 | [A shot placed on a word start records an anchor to that word id in its decision and follows the word's effective start; dragging the shot marker detaches it to a plain sample position; snapping to a word re-anchors.](docs/decisions/A51-shot-placed-word-start-records.md) | standing |
| A52 | [Three timing tracks with toolbar toggles: Original (transcriber, read-only, faint), Auto (scripted, read-only), Edited (effective; the one selected and dragged, never empty).](docs/decisions/A52-three-timing-tracks-toolbar-toggles.md) | standing |
| A53 | [Autosave on every timing change about 300 ms after the last edit, with the same saved/saving indicator as decisions; no commit step.](docs/decisions/A53-autosave-timing-change-about-300.md) | standing |
| A54 | [A transcriber's sentence mark only ends a sentence chunk when the gap to the next word is at least the story's `chunking.minSentenceBreakMs`, set per story in `story.json` and defaulting to the server config's value of 0 (rule off).](docs/decisions/A54-transcriber-s-sentence-mark-ends.md) | standing |
| A55 | [A story is a directory: `data/stories/<story-id>/` holds `story.json` (identity, current file locators, origin, and the editable synopsis), the verified `audio/` and transcript pair, planning documents, `shots/`, `decisions.json`, timing overlays, and caches.](docs/decisions/A55-story-directory-holds-identity-current.md) | standing |
| A56 | [The editor server opens every story directory under the stories directory (`data/stories/` unless a run file overrides it) and lists them at `GET /api/stories`; each story's routes live under `/api/stories/<story-id>/`.](docs/decisions/A56-editor-server-opens-story-directory.md) | amended |
| A57 | [Defaults live in code; a config is a record of one run, kept beside its output.](docs/decisions/A57-defaults-in-code-run-files.md) | standing |
| A58 | [Shapes and pure rules shared by server and client live once, in `packages/domain`.](docs/decisions/A58-one-source-of-truth-for-shapes.md) | standing |
| A59 | [Intake produces stories; everything else consumes them, and the story manifest is the boundary.](docs/decisions/A59-intake-produces-stories.md) | standing |
| A60 | [Image tracks are independent sequences over one story's narration.](docs/decisions/A60-independent-image-tracks.md) | standing |
| A61 | [Preview subtitles derive sentences and phrases from the working transcript, independently of timeline chunks.](docs/decisions/A61-derived-preview-subtitles.md) | standing |
| A62 | [A story map names a story's subjects and structure as word ranges; the editor explores it read-only.](docs/decisions/A62-story-map-and-explorer.md) | standing |
| A63 | [The editor is one page of collapsible sections; the story map is the Scenes and Cast & world sections.](docs/decisions/A63-single-page-of-collapsible-sections.md) | standing |
| A64 | [Scene images are rendered by hosted GPT-5.4 Image 2; local Qwen Image 2.1 is the free fallback. What follows Understand's waking shot is open.](docs/decisions/A64-hosted-scene-image-renderer.md) | standing |

## When a new book arrives

Intake is frozen and may need bespoke handling. The path the two existing books took: `animator intake inspect` on the original, `animator intake prepare` with a run file pinning its hash, whole-book transcription through the Rev dashboard, `animator intake import` of the export, an agent-authored split plan checked against measured audio gaps, `animator intake split`, then relocation of each story segment into `data/stories/<id>/` with a `story.json` (the one-time relocation script was removed after its run; write a new one from `data/story-relocation.json` if needed), and `animator inventory publish`. A reusable discovery service (B06) and production transcription submission (B07) remain unbuilt until a third book makes them worth building.

## History

Round-by-round responses, source-file evidence, the stack survey from foundation time, and the legacy-project assessment are archived in [docs/history/project-evidence.md](docs/history/project-evidence.md); the first transcription, split, and inventory runs are in [docs/history/early-pipeline-runs.md](docs/history/early-pipeline-runs.md). Cleanups and relocations are recorded in `data/cleanup-2026-09-09.json`, `data/cleanup-2026-09-09b.json`, and `data/story-relocation.json`.

## Backlog and readiness

| ID | Module / task | Status | Completion / remaining prerequisite |
| --- | --- | --- | --- |
| B00 | Project/source inventory and working decision record | Done for first round | Legacy and two sources inspected; findings and open decisions recorded here. |
| B01 | TypeScript / Effect application foundation | Done | Exact pins, explicit config, thin CLI; frozen install, strict source typecheck, build, help/version and invalid-flag behavior verified. |
| B02 | Source-media inspection | Done | Callable Effect module and CLI, explicit config, 19 combined tests, real-file JSON/hashes verified for both books. No story approval or extraction. |
| B03 | Split plan and story classification | Both collection plans reviewed | Exhalation has 20 segments and the second collection has 18. Independent transcript audits agree; all 36 internal cuts use measured audio gaps. General discovery exception handling remains open. |
| B04 | Extract and verify story audio | Done for both collections | Thirty-eight verified FLAC/transcript pairs. Independent full-book PCM and transcript reconstruction passed for each book. Tests cover source relocation and interrupted-run reuse. |
| B05 | First splitter acceptance on both collections | Passed | Both books have reviewed boundaries, verified pairs and inventories, and exact full audio/transcript reconstruction. Provider recognition and precise word alignment remain unmeasured. |
| B06 | Story discovery from transcription | Both plans produced by agents; reusable module remains | Independent transcript partitions and measured quiet gaps supply both plans. Build a reusable discovery service and uncertainty policy from this evidence; metadata cannot decide cuts. |
| B07 | Book-level timed transcription | Both books imported | Exhalation job `eekQ2vQNJp3XjfF6`: 100,593 timed words. Stories job `gbuckIu5tGOf8MiK`: 91,213 timed words. Exact exports and whole-book prepare/import remain. The demo-only API path is retired; production submission remains backlog work. |
| B07a | Playable timestamp demo | Historical demo complete; code retired | The live 120s result established timestamp playback with 344 words. Original audio, exports, and timing evidence remain; the current editor supplies playback and timing controls. |
| B07b | Story inventory and selection | Complete; pilot selected | The [17-story inventory](data/stories/inventory.md) and per-book reading views contain verified durations, premise-only synopses, and media links. The Great Silence is selected under Q9. The renderer uses story manifests without changing split evidence. |
| B08 | Story planning and continuity | Input loader complete; pilot analysis drafted | Read-only Effect loader verified on the real story and covered by the current root suite. Agent-authored analysis has 15 evidenced beats and a canonical-name source check. A world model (entities, time layers, invariants) was drafted and withdrawn on 2026-09-09 at the user's request; reusable subject references remain a prerequisite for consistent image generation. Automated semantic generation/output contract remain open. |
| B09 | Visual timeline | Editable timeline implemented; final treatment in progress | B14 stores immutable generation records and editable decisions on the clip sample clock; B17 seeds the 14 treatment sequences and 15 study panels. Final image choices, precise pacing, and full-film render remain. |
| B10 | Moodboards over narration, then animation | Current editor previews study shots | B15/B16 provide the working preview and scene controls; B18–B21 add timing overlays and whole-clip pilot alignment. The old comparison player is retired. Full-film image production, rendering, budget, and quality criteria remain open. |
| B11 | Ambience and music | Backlog | Needs assembled movie and sound-design criteria. |
| B12 | Pipeline runner, recovery, and autonomy measurement | Develop through real visual runs | Record cost, retries, output checks, and interventions from the first run. Reuse completed work and support selective regeneration; establish quality criteria and repeat across stories before claiming the 95% target. Choose broader durable execution from actual module needs. |
| B14 | `visual-timeline` module: generation-record and decisions schemas, merge, validation, `add`/`show` CLI | Done 2026-09-08 | `src/modules/visual-timeline/`, `config/visual-timeline.json`, `node dist/visual-timeline.js`. Records are ULID directories under `shots/`; decisions overlay in `decisions.json`; both pinned to the clip identity from `loadStoryContext`. 12 tests. `Schema.Record` key checks are not enforced in rc.112, so decision keys are validated in the merge. |
| B15 | Editor server: Effect HTTP on loopback, clip audio with byte ranges, cached peaks, story folder watch with server-sent events, static client serving | Done 2026-09-08 | `src/modules/editor-server/`, `config/editor-server.json`, `node dist/editor-server.js --config config/editor-server.json --port 63620 --static packages/editor/dist`. Peaks cache is `cache/peaks.json` in the story directory (21,102 buckets of 1,024 samples for the pilot), not in the verified split folder. 13 tests plus a real run. |
| B16 | Editor client: `packages/editor` with pinned Vite 8.2.2 and React 19.2.8 | Done 2026-09-08 | Waveform, word lane with click-to-seek and follow, shot lane with drag and snapping, 16:9 letterboxed preview, candidate panel, hide/merge/new-shot/attach, loop, client-only working region, debounced decisions save, live refetch on server-sent events. The client mirrors the merge rule locally for instant feedback. 25 pure-module tests plus browser QA against a mock and the real server. |
| B17 | Seed import: prototype frames and treatment spans as labeled generation records | Done 2026-09-08 | `node dist/visual-timeline-seed.js`. 29 records: 14 image-less treatment spans and 15 panels cropped from the five study boards with FFmpeg; deterministic ULIDs make reruns no-ops. A suggested `decisions.json` selecting the prototype's proposed mix was written once. 9 tests. |
| B18 | `word-timing` module: overlay schemas, effective merge, speech-region detection, align algorithm, `align` CLI; shot anchors in the timeline merge | Done 2026-09-09 | A36, A37, A42, A45–A49, A51. Completion: pure-function tests for regions and align; CLI reports before/after on a range of the pilot. |
| B19 | Editor server: speech cache beside peaks, timing merge in the story payload, manual timing write route, ranged align route, anchor-aware timeline | Done 2026-09-09 | A46, A49. Completion: routes tested against the synthetic fixture and the real clip. |
| B20 | Editor client: speech shading, three timing tracks with toggles, contiguous selection, group drag with snapping and clamping, nudge, undo/redo, autosave, align-selection with report, shot anchoring and detaching | Done 2026-09-09 | Q21, Q22, A38–A41, A44, A50–A53. Completion: browser QA on the running dev server. |
| B21 | Excerpt runs on the pilot, then whole clip, then every story on the user's say-so | All 17 stories aligned 2026-09-09 | Run 0–30 s: 69 words, 8 speech regions; boundary onset error median −210 ms → 0 ms (p10 −770 → −306, p90 −106 → 0); words inside speech 87% → 100%; all shifts between +140 and +302 ms. The user judged the first 30 s "very good" and asked for the whole clip. Whole-clip run with `--all`: 1,189 words, 149 regions, 162 boundaries; onset error median −140 ms → 0 (p10/p90 −379/+480 → 0/0); words inside speech 86% → 100%. Shifts: p10 +40 ms, median +147 ms, p90 +300 ms, extremes −260 ms (around 187 s, "astronomers used a SIBO") and +540 ms (around 338 s and 454 s). Those three spots are the places to eyeball on the Auto row. No manual entries exist yet. After approving the pilot's Auto track the user asked for every story. Sanity checks on one story per collection showed the same constant lead (130–150 ms) and sane speech detection on the 22.05 kHz narrator. The whole-clip pass then ran on all 16 remaining stories: original boundary onset error medians of −64 to −144 ms, all zeroed; words fully inside speech 82–87% before and 100% after; 15 MB of auto overlays in total. The first attempt failed on the seven stories over about 1h20m because the auto overlay borrowed the 1 MiB decisions limit; it now has its own explicit `limits.maxWordTimingBytes` (16 MiB). Caveat carried from A54: the 150 ms sentence-break rule was measured across the corpus and does not transfer (5–6% of breaks sit under 150 ms with no clean gap), so it needs a per-story setting or a manual join layer before it is trusted beyond the pilot. |
| B22 | Story selector: multi-story editor server and a header picker in the client | Done 2026-09-09 | A56. `GET /api/stories` plus story-scoped routes; `--story` on the word-timing CLI; the mock server lists two stories. Completion: route tests on the synthetic fixture (listing, 404s, every route under the prefix) and browser QA switching between stories on the running dev server. |
| B23 | Agent ergonomics: `src/core/`, `src/intake/`, `packages/domain`, run files instead of `config/`, one command tree, `animator status` | Done 2026-09-11 | A57 to A59. Every step verified by `pnpm check`; the review that led here is `docs/reviews/2026-09-09-agent-ergonomics-review.md`. The story-level error types are folded into one `AnimatorError` carrying `module` and `code`; intake keeps its own, being frozen. |
| B24 | Preview subtitles with automatic sentence/phrase grouping and optional word highlighting | Done 2026-09-12 | A61. Two-line display follows effective word timing; separate subtitle and highlight toggles are remembered in the browser. Domain tests cover text preservation, grouping, layout, and timing. Browser checks cover playback, toggles, resizing, story switching, and pending timing edits. Export and manual subtitle editing remain deferred. |
| B25 | Story map and explorer: `story-map.json` schema and rules in the domain, server route and `story map` verb, explorer view in the client | Done 2026-09-18 | A62. Domain tests cover the rules, resolution, and the current chain; server tests cover refusal cases and image serving; the mock server carries a map. The Great Silence has an agent-authored map: 17 subjects with 158 mentions, 5 acts holding the analysis's 15 beats, continuity images attached. Understand has one written from the transcript alone: 32 subjects with 355 mentions, 9 acts and 49 beats, no images. Map authoring is by hand or agent; no extraction tool exists. |
| B13 | Local input organization and source relocation | Done | Five input files moved with exact hashes retained; current paths/configs/docs updated. Real imports and all 20 Exhalation pairs reuse 97 unchanged artifacts. No loose root audio/transcript files or compatibility symlinks for those inputs remain. |

Current readiness assessment: all 17 stories have verified audio/transcript pairs and live under `data/stories/`, with notes and credits retained with their books. The Great Silence is selected. Its source analysis is drafted, its editable timeline and study imports work in the browser editor, and the whole clip has an automatic timing overlay. The next product delivery is a complete moodboard film: consistent visual references and story images, final pacing, and a separate render command. Image provider, budget, output settings, and quality criteria remain open. Reusable autonomous discovery and semantic generation remain backlog work. The 95% autonomy target is not demonstrated; no complete movie has been rendered.
