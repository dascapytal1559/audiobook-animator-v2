# Animator pipeline

Shared working document for the user and lead agent. This records the product, decisions, evidence, and implementation backlog. Agent workflow instructions live in `AGENTS.md`.

Updated: 2026-09-09, Australia/Melbourne (stories relocated to `data/stories/` the same day). Alignment is ongoing; an open question is not an approved requirement. Implementation can proceed on settled modules while other branches are discussed.

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
4. **Story planning:** understand the narrative, identify meaningful beats, and describe the people, places, objects, and continuity needed to visualize it. Link factual claims to the transcript and distinguish interpretation from visual invention.
5. **Visual timeline:** plan visuals against the narration timeline.
6. **Moodboard movie, then animation:** first overlay moodboards on narration; later animate the visuals while preserving story continuity.
7. **Polish:** ambience and music, with narration remaining the primary soundtrack.

The foundation, source inspection, timestamp demo, whole-book transcript import, and verified audio extraction are implemented. Both collections have completed transcripts, reviewed split plans, and all 38 paired outputs. The combined inventory contains 17 stories with durations and premise-only synopses; notes and credits are available separately. Independent whole-book reconstruction checks passed for each book's audio and transcript. Later movie stages still need delivery contracts and acceptance criteria.

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

## Standing assumptions

These are explicit engineering calls, open to challenge. Challenging one reopens the decisions and implementation that depend on it.

| ID | Assumption | Reason |
| --- | --- | --- |
| A1 | Build fresh v2 contracts, using legacy assets and useful behavior as reference. | The old stages have drifted apart and the legacy build does not pass. |
| A2 | One application with focused modules. Each exposes validated inputs, outputs, and failures; Effect services handle media tools, storage, and providers. | Keeps modules independently callable and gives external dependencies explicit boundaries. |
| A3 | Start with a local CLI, Node LTS, pnpm, and exact dependency/configuration pins. | Fits the available local media and tools; module operations can also be called by a later runner or interface. |
| A4 | Keep original audio unchanged and preserve source-relative timing for every cut. A story is the author's narrative unit, not an arbitrary duration segment. | Later transcripts and visuals must remain traceable to the original narration. |
| A5 | Completion requires verified outputs, and verified work should be reusable on reruns. | The autonomy target depends on detecting failure and avoiding unnecessary repeated work. |
| A6 | Preserve credits and author's notes as separately classified material; story jobs process stories. | Extras should remain available without being mistaken for story content. |
| A7 | Transcribe the audiobook before discovering story boundaries and extracting stories. Metadata is optional comparison evidence and never a cut authority or automatic fallback. | Whole-book transcription is feasible, and the user explicitly confirms that the metadata is inaccurate. |
| A8 | Any technical transcription chunks retain the original book timeline and do not define stories or alter source audio. | Provider request limits should not dictate narrative boundaries. |
| A9 | Export story audio as lossless 24-bit FLAC at the source sample rate and channel count, with a matching timed transcript beside it. Extraction requests use integer decoded-audio sample intervals with an exclusive end. | Preserve narration quality and reproducible cuts for later movie work; the source MP3 remains unchanged. |
| A10 | First story cuts retain spoken titles and complete narration at the original pace. Cut in quiet gaps between stories and extras; keep every author note and credit segment separately. | Makes the stories selectable now without premature editing of their internal narration. |
| A11 | Group local originals and raw exports under each book's `input/` directory, with `data/inbox/` for new downloads. Separate the current source location from unchanged historical evidence and verified content identity. | Moving an identical input should preserve completed transcription and splits without rewriting their provenance. |
| A12 | Keep selection synopses short and focused on the premise, without revealing endings. Store editable descriptions separately from completed split evidence, linked by story ID and transcript hash. | Helps the user compare stories while allowing descriptions to change without repeating media work or invalidating accepted outputs. |
| A13 | Story plans distinguish facts supported by the transcript, uncertain interpretations, and invented visual details. Preserve raw transcription and attach evidence to interpretations or corrections. | Recognition errors and unspecified visual details must not silently become story canon. |
| A14 | Plan visual beats around changes in action, idea, emotion, or setting, while retaining the narration's order and intended reveals. Adjacent beats may share an image. | Stories can contain reflection, reported examples, flashbacks, and future references; word/sentence boundaries and event chronology do not by themselves define the viewing sequence. |
| A15 | The planner proposes each scene's visual mode, and a user can override any scene. Graphic illustration is a useful starting point for concrete subjects; poetic abstraction is useful for ideas and emotional passages. These are suggestions, not mandatory rules. | Supports the autonomy target while preserving the user's creative control over individual scenes. |
| A16 | Use recurring motifs and the prototype's related green/blue/warm-gold palette to connect the two modes in the pilot. | Provides a starting point for continuity when the rendering style changes; this remains a creative proposal the user can change. |
| A17 | Discard the prototype comparison player and its server. Their files remain on disk as evidence of the studies; no code is carried into the editor. | It was a throwaway with hard-coded scenes, a fixed 25-second window, and no persistence. |
| A18 | The editor opens exactly one verified story segment at a time, chosen by book and story ID, with The Great Silence as the default. It never opens arbitrary audio files. | Every timeline stays tied to a verified clip identity. |
| A19 | A `visual-timeline` module owns two schemas per story: immutable generation records under `data/stories/<story>/shots/` and a `decisions.json` overlay beside them. Both pin the clip's audio and transcript hashes. The editor is a client of this module, not the owner of the format. | Separates immutable evidence from editable choices, matching A12, and lets any script produce records. |
| A20 | Time on the timeline is stored as integer samples on the clip's own clock, zero at clip start. Seconds are derived for display. | Consistent with the sample-exact splitting already done. |
| A21 | The editor previews in the browser. A separate CLI renders the film from the timeline with FFmpeg. The editor never shells out to FFmpeg for the film. | Keeps the editor responsive and the render reproducible. |
| A22 | Waveform peaks are computed server-side once, cached beside the clip, and served with byte-range audio streaming. | Keeps the browser cheap and works for the multi-hour stories. |
| A23 | The editor server binds to loopback with no authentication. | It is a personal desktop tool. |
| A24 | Word-click seeking, follow-playback highlighting, and dual clip-time and book-time clocks are carried from the demo viewer as behaviours, re-implemented in the new stack. | Those behaviours were verified useful; the code belongs to the old stack. |
| A25 | Several generation records may target the same time. The decisions file records which candidate is selected; unselected candidates remain visible as alternatives. Selecting is a decision, not a deletion. | Preserves generated work and supports comparison. |
| A26 | Files are the only channel between scripts and the frontend. The editor server watches the story folder and pushes changes to the browser over server-sent events. No queue, database, or socket protocol. | A script that finishes writing a file is immediately visible without coordination. |
| A27 | The editor server is a thin Effect HTTP layer in the root package over module operations. Later frontend generation features call the same operations the CLIs use. | Nothing is implemented twice. |
| A28 | The React client is a new `packages/editor` workspace package with exactly pinned Vite and React. Vite serves the client in development and proxies to the Effect server; the production build is static files served by the same Effect server. | Keeps pipeline modules framework-free. |
| A29 | Preview is image swapping in the browser synced to audio playback, not a video file. | Instant feedback; rendering stays a separate CLI under A21. |
| A30 | Each generation record is a directory `shots/<shot-id>/` with `record.json` and its image beside it. The record holds `startSample`, `mode`, `prompt`, relative `imagePath`, `createdAt`, `producer`, and `notes`. Shot IDs are ULIDs. | Any script can mint an ID and write a record without coordination. |
| A31 | A record's image is optional. An image-less shot renders as a placeholder card with mode color and notes. | Lets treatment spans seed the timeline and lets the user sketch before generating. |
| A32 | Decisions are keyed by shot ID and hold overrides for `startSample`, `mode`, `selected`, and `hidden`, plus story-level settings such as frame aspect. Merge order is generated record, then decision override. | Two writers never touch the same file. |
| A33 | The 15 prototype frames and the 14 treatment spans are imported once as generation records with their origin as `producer`, labeled as studies. | The editor is never empty on first open. |
| A34 | Dragging a shot start snaps to the nearest word start or measured quiet-gap midpoint within a small pixel radius; a modifier disables snapping. Snap targets come from the paired transcript. | No new audio analysis is needed. |
| A35 | Vite, React, and the peaks format receive exact version pins looked up at implementation time. | Matches the project's pinning rule. |
| A36 | Word timing edits live in overlay files in the story's planning directory, keyed by word id, holding `startSample`/`endSample` on the clip clock and pinned to the transcript hash. The paired transcript is never written and is the backup by construction. | It is hash-pinned acceptance evidence; a copy would be a second source of truth. |
| A37 | The server merges effective timing before words, chunks, and snap targets are served. Chunking reruns on effective times. | One place decides what "the timing" is. |
| A38 | Selection is a contiguous range and client-only: click selects, shift-click extends, Escape clears. Sentence mode selects whole sentences and moves all their words. | Covers the alignment use without a discontiguous-selection model. |
| A39 | A group move is a horizontal drag of any selected box; every selected word's start shifts by the same amount and ends ride along, so durations are preserved. The leading edge snaps to speech onsets, Alt disables, comma and period nudge by 10 ms. | Q21: translate only; start time is what matters. |
| A40 | A moved group clamps against its unselected neighbours so order and non-overlap are preserved. | Prevents silent inversions. |
| A41 | Undo and redo for timing edits with the usual keys, client-side stack. | Manual alignment is trial and error. |
| A42 | Two files, two writers: the script owns `word-timing.auto.json`; the editor owns `word-timing.json`. Effective timing is manual, else auto, else original. Re-running the script replaces auto entries for its range and never touches manual ones. | Same two-layer rule as shot records and decisions (Q17). |
| A43 | Excerpt-first: the automatic pass runs on the editor selection or an explicit CLI range; the whole clip requires an explicit flag and the user's say-so. | Q23: the user spot-checks a couple of excerpts first. |
| A44 | Detected speech regions are shaded under the waveform. | Makes misalignment visible and supplies snap targets. |
| A45 | Speech detection is explicit config: absolute -50 dBFS on 10 ms RMS frames, minimum silence 150 ms, minimum speech 50 ms. | Measured on the pilot: the energy histogram is bimodal with a trough at -50 dBFS and the source is noise-gated, so a relative threshold is meaningless. |
| A46 | Speech regions are computed in the same FFmpeg decode as peaks and cached beside them as `speech.json`, pinned to the audio hash. | One pass, two artifacts. |
| A47 | The align algorithm is a pure function in a `word-timing` module: shift the range's words by the configured lead (default 150 ms), assign each word to the speech region it overlaps most, snap each region's first start and last end to the region edges, scale interior words linearly. Regions with no words are ignored; words wholly in silence attach to the nearest region. | Measured on the pilot: a constant ~150 ms lead with ~140 ms jitter and no drift; this correction takes words fully inside speech from 86% to 94%. |
| A48 | Every align run reports before and after for its range: median boundary error, spread, and fraction of words fully inside speech. | That is how excerpts are judged before widening. |
| A49 | Server routes for speech regions, manual timing writes, and a ranged align; the CLI exposes the same align operation. | Editor and scripts share one implementation (A27). |
| A50 | Build order: speech shading, then selection and group move, then the automatic pass on the first 30 seconds, each landing on the running dev server. | Lets the user see the problem before the tools arrive. |
| A51 | A shot placed on a word start records an anchor to that word id in its decision and follows the word's effective start; dragging the shot marker detaches it to a plain sample position; snapping to a word re-anchors. The audio clock remains the only ground truth. | Q22: shots follow words by default but move independently. |
| A52 | Three timing tracks with toolbar toggles: Original (transcriber, read-only, faint), Auto (scripted, read-only), Edited (effective; the one selected and dragged, never empty). Clicking a word in any track seeks to that track's time. | The user wants the original and the scripted result visible for reference. |
| A53 | Autosave on every timing change about 300 ms after the last edit, with the same saved/saving indicator as decisions; no commit step. | The write is a small JSON file. |
| A54 | A transcriber's sentence mark only ends a sentence chunk when the gap to the next word is at least `chunking.minSentenceBreakMs` (150 ms, the same as the speech detector's minimum silence). Breaks merged by this rule are listed in the story payload for audit. Confirmed on the pilot 2026-09-09: of 95 sentence breaks, three sat on gaps of 0–64 ms and the user verified all three were misplaced periods; the next smallest gap is 180 ms and the median is about 1 s. | A period with no audible pause behind it is a transcription error, and the margin on the pilot is wide. Other narrators must be measured before trusting the threshold. |
| A55 | Each story gets a world model beside its analysis and treatment: stable entity IDs with canonical prompt descriptions, time layers, structural rhymes, shared visual language, and numbered invariants. Every fact is classed as stated (with evidence IDs), canonical name, cited external reference, or revisable design decision. | Separately generated images must agree with each other, and invented design details must never become story canon. The entity and invariant IDs are the fields a later B08 output contract formalizes. |
| A56 | A story is a directory: `data/stories/<story-id>/` holds `story.json` (identity, current file locators, origin, and the editable synopsis), the verified `audio/` and transcript pair, planning documents, `shots/`, `decisions.json`, timing overlays, and caches. `data/books/<book>/` is the pre-treated input and book-level processing: originals, imports, the split plan and its acceptance inventory, and the extras. Story ids are unique across books. Configs select a story by its directory; the manifest is verified against the linked files on every load, and the split inventory is retained as origin evidence, not reopened. | Stories are the unit of creative work, so everything about one story lives in one place and any script can find it by id. The split inventory stays an unchanged acceptance artifact; the manifest is the current locator, as A11 separates location from identity for inputs. |

## Round responses and current frontier

**Q9 — Pilot story, confirmed:** the user selected **The Great Silence (8:10)** for the first complete moodboard film. Its verified audio and paired transcript are under `data/stories/the-great-silence/`.

**Q10/Q11 — Visual modes, confirmed from prototypes:** the user wants both **graphic illustration** and **poetic abstraction** at their disposal, choosing one for some scenes and the other elsewhere. Retain the looks actually shown: the `graphic-literal` study and the `painterly-abstract` study. This permits both scene presets within one film; it does not select a single global treatment or silently convert the abstract option to graphic rendering.

Per-scene recommendations remain editable under A15. The initial mixed-excerpt proposal is graphic telescope, graphic neighboring parrots, then poetic abstraction for the listening passage. Those assignments are a demonstration of the control, not the user's choices for those scenes. The [full-story proposed treatment](data/stories/the-great-silence/visual-treatment.md) now covers the complete 489.9856689342404-second audio in 14 adjacent visual sequences, with mode suggestions, evidence IDs, and continuity notes. The sequence spans are approximate planning boundaries, not final edit points or an image count. Scene timing, image count, production provider/budget/output settings, and quality criteria remain open.

The story is a reflective first-person parrot address. Its plan needs to support ideas and reported examples as well as physical settings. The narrator and Alex, the African gray parrot in the reported research example, must remain distinct. Recognition errors in names and terms need evidenced interpretation under A13; raw provider output stays unchanged.

A [world model](data/stories/the-great-silence/world-model.md) now records the story's entities, time layers, structural rhymes, shared visual language, and thirteen numbered invariants, with every fact classed as stated, canonical, external reference, or design decision under A55. It supplies the reusable subject descriptions the treatment listed as a prerequisite for consistent reference generation; the six design defaults it chooses, such as a non-identifying Pepperberg figure, are listed for the user to change.

B08's read-only planning input loader and the pilot's [source-grounded analysis](data/stories/the-great-silence/story-analysis.md) are complete. The analysis contains 15 semantic beats with 46 checked evidence IDs; these beats do not prescribe an image count. A [primary-source check](docs/research/great-silence-source-check.md) verifies canonical names while preserving raw ASR. The real CLI returns all 1,189 words and 2,512 elements exactly as they appear in the paired transcript. The planning-input checks pass in the current root suite. Automated semantic generation and its persisted output contract remain open.

**Visual studies and current interface:** five imagegen boards supplied 15 frames for the user to compare. The user selected graphic illustration and poetic abstraction as available scene modes. The boards, prompts, and identities are retained in [the study archive](data/stories/the-great-silence/visual-prototype/README.md) and imported into the editor under B17. The old comparison player and the Rev timestamp demo entry points were retired on 2026-09-09. Original narration, provider exports, and completed evidence remain intact. Production image generation, budget, and full-film quality criteria remain open.

**Q12–Q20 — Story editor, confirmed 2026-09-08:** the user asked for a new editor centred on an audio clip, discarding the old one. Exploration found no editor in the legacy project at all; the "old editor" is the prototype comparison player, which is discarded under A17. Confirmed: **Q12** the editor is first a visual layer over script-generated storyboard shots, with finer-detail generation features added to the frontend over time; **Q13** Vite plus React in its own workspace package; **Q14** the first version has waveform and transcript words with seek, scene span create/move/split/merge/delete with snapping, per-shot mode, attaching existing images with synced preview, loop, and seeding from the treatment; **Q15** assign existing images only, with a prompt field and asset list on each shot from day one; **Q16** the whole clip always, with an unsaved working region; **Q17** two layers, immutable generation records plus a decisions overlay; **Q18** a shot is a start point that holds until the next shot, so coverage is automatic and spans are never stored; **Q19** the JSON schema is the contract and a repo CLI is a validating convenience; **Q20** a 16:9 letterboxed preview stored as a per-story setting. Assumptions A17–A35 record the resulting engineering calls.

**Editor delivered, 2026-09-08:** B14–B17 are implemented and verified together: typecheck clean, 117 root tests and 25 client tests passing, and a browser session against the real server on The Great Silence. Clicking a word seeked and played with the telescope study frame in the preview; selecting a different candidate wrote `decisions.json` within the debounce, and the CLI `show` command read the same selection back; restoring the file externally refreshed the browser through server-sent events. Known rough edges: pressing Space while a word button has focus re-triggers that word instead of pausing; treatment span 02 at 20.0 s precedes the abstract listening panel at 20.32 s, so a placeholder card shows for a third of a second until one of them is moved or hidden. The old prototype player and `HANDOFF.md` are discarded; the prototype's files remain as evidence.

**Q21–Q25 — Word timing alignment, confirmed 2026-09-09:** the user wants to select several words or sentences with Shift and move their timestamps as a group, because the provider timings do not match the waveform, plus a scripted first pass. Measurement on The Great Silence (10 ms RMS envelope, -50 dBFS threshold) found a constant lead of about 150 ms at phrase onsets and offsets, jitter with a spread of about 140 ms, no drift, 63% of word ends butt-joined to the next start, and 86% of words fully inside detected speech. A global shift plus per-phrase snap with interior scaling raises that to 94%. No model-based aligner is installed locally; Rev offers forced alignment by public URL at about US$0.18 per audio hour; a local CTC aligner would need a pinned Python sidecar. Confirmed: **Q21** translate only, start time matters most; **Q22** shots follow their word by default and detach when moved, with the audio clock as ground truth; **Q23** the script writes directly and the user spot-checks excerpts before the whole clip; **Q24** the energy-only pass in this repo is the first pass; **Q25** phrase-accurate timing is enough for now, with a CTC aligner as the upgrade path. Assumptions A36–A53 record the design.

Earlier transcription, splitting, relocation, and inventory progress is retained in [the early-run history](docs/history/early-pipeline-runs.md). Those entries describe the implementation at the time; the current backlog below records what remains active.

## Source evidence

Inspected read-only on 2026-09-05. Both source MP3s are separate local files outside the `animator` symlink. They were initially in the v2 root and are now under each book's `input/` folder. Their bytes are unchanged; large source audio remains local and is excluded from Git.

| Source | Duration | Audio | Track evidence |
| --- | --- | --- | --- |
| `data/books/exhalation/input/book.mp3` | 11:22:08.885 | Mono MP3, 44.1 kHz | 9 stories + opening credits, author's note, end credits |
| `data/books/stories-of-your-life-and-others/input/book.mp3` | 10:23:26.140 | Mono MP3, 22.05 kHz | 8 stories + opening credits, story notes, end credits |

- Embedded titles identify the collections as **Exhalation** and **Stories of Your Life and Others**, both by Ted Chiang.
- Both files have MP3 chapter timestamps and an embedded `CUESHEET`. MP3 chapter titles repeat the collection name; CUE track titles identify the actual stories and extras.
- Ordered chapter/CUE track counts match: 12 and 11. Chapter ranges are contiguous, with no gaps or overlaps in the inspected metadata.
- CUE positions are `minutes:seconds:frames`, with 75 frames per second. Parsed CUE starts are 0-13.667 ms earlier than chapter starts for Exhalation and 0-11.333 ms earlier for Stories. This supports correspondence; it does not prove semantic cut quality. See the [GNU CUE specification](https://www.gnu.org/software/ccd2cue/manual/ccd2cue.pdf).
- Both files contain an attached JPEG cover. Media operations must explicitly select audio.
- The files are byte-identical by SHA-256 to legacy `animator/audiobooks/Exhalation/book.mp3` and `animator/audiobooks/Stories_of_Your_Life_and_Others/book.mp3` respectively.
- Partial legacy transcripts exist for three Exhalation stories and Tower of Babylon. No whole-book transcript or separate EPUB/PDF/book text was found in the inspected v2 and legacy trees, excluding dependencies, Git data, caches, and secrets.
- **The Lifecycle of Software Objects** occupies a 3h43m14s track. Processing a short-story collection does not guarantee small downstream jobs.

The initial metadata lists **17 stories and 6 extra tracks** across the two books; this is not the actual content segmentation. Exhalation transcription reveals an author note after each of its nine stories, plus opening and closing credits. Original files and legacy outputs have not been changed.

### Legacy timestamps are comparison evidence

| Story | Embedded chapter range, seconds | Legacy configured range, seconds |
| --- | --- | --- |
| The Merchant and the Alchemist's Gate | 14.104-3570.067 | 20-3463 |
| Exhalation | 3570.067-6459.466 | 3573-6358 |
| What's Expected of Us | 6459.466-6866.046 | 6464-6779 |

The old cuts shorten tracks substantially. Another legacy copy uses different trims. They cannot be treated as authoritative without further validation.

## Architecture and implementation direction

The application will use `src/modules/<module-name>/` for module implementation, with a thin CLI at the application boundary. Module operations remain callable without the CLI. Concrete provider/media/storage implementations are supplied through Effect layers. Runtime schemas validate external inputs and persisted outputs.

The first independent module is **source-media inspection**: probe an explicit local path, fingerprint the source, identify audio streams, and preserve chapter and CUE evidence with its timing precision and diagnostics. It does not decide final story boundaries or cut audio.

The splitter separates boundary evidence, a validated split plan, audio extraction, and verification. Boundary discovery uses a whole-book timed transcript and the original audio. Inaccurate chapter/CUE metadata cannot set cuts, override transcript/audio evidence, or silently substitute for missing evidence. The split plan pins source, transcript, and evidence hashes, partitions transcript elements, and supplies integer decoded-audio sample intervals. Paired output preserves raw provider timestamps and adds approximate segment-relative times. Both collections have reviewed plans; reusable autonomous discovery and its exception policy remain to be designed. No full workflow engine or distributed infrastructure has been selected.

### Current stack evidence

Verified against official sources and npm metadata on 2026-09-05; recheck before installation and pin the selected versions.

| Component | Evidence / decision |
| --- | --- |
| Effect | Stable `3.22.1`; chosen release-candidate line currently `4.0.0-rc.112`. |
| Effect Node integration | Matching `@effect/platform-node@4.0.0-rc.112`. |
| TypeScript | Current stable `7.0.2`; Effect requires at least 5.9. |
| Node | Current LTS `24.20.0`, already installed locally. |
| pnpm | Current stable `11.25.0`; the host initially has `11.24.0`. The project will pin its selected version. |
| Media tools | Local `ffmpeg` and `ffprobe` are available; FFmpeg reports `9.0.1`. |

Effect's [homepage](https://effect.website/) recommends the RC, and the [release announcement](https://effect.website/blog/releases/effect/40-rc) describes v4's release-candidate status. Registry evidence: [Effect](https://registry.npmjs.org/effect), [Node integration](https://registry.npmjs.org/@effect%2fplatform-node), [TypeScript](https://registry.npmjs.org/typescript), [pnpm](https://registry.npmjs.org/pnpm). [Node release information](https://nodejs.org/en/about/previous-releases).

In v4, CLI, workflow, cluster, process, AI, HTTP, and SQL integrations use `effect/unstable/*`; this is a distinct stability boundary even when core Effect becomes stable. v4 service patterns differ from v3. Use the [official migration guide](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md) and installed version APIs when implementing.

Foundation choices: NodeNext ESM, compiled JavaScript, Node's built-in test runner, and strict application typechecking. `skipLibCheck: true` is explicit because the RC's CLI declarations refer to an internal `Param.getParamMetadata` declaration that is absent from the published declarations. No dependency patch is maintained. DOM type libraries satisfy Effect's cross-runtime declarations; they do not add a browser runtime.

`@effect/platform-node` declares a required Redis peer dependency, so `redis@6.2.1` is pinned to satisfy it; no Redis service is configured. pnpm's version-11 settings live in `pnpm-workspace.yaml`. The only permitted dependency lifecycle hook is `msgpackr-extract@3.0.4`; engine compatibility, peer compatibility, and lifecycle decisions are explicit.

**Cleanup, 2026-09-09 — approved:** retired the old timestamp viewer, demo-only Rev submission/import scaffolding, and comparison player; retained shared whole-book normalization/import and all accepted source evidence. Removed scratch media and empty logs. The client now consumes configured chunking thresholds, and dev-server shutdown is scoped to this checkout. Historical MP3 blobs were removed from local Git storage without changing the current committed tree or index. Verification passed: 121 root tests, 45 editor tests, and the client build. All 300 protected data files (4,354,476,081 bytes) retained their hashes. Live checks covered the story/timeline APIs, waveform and speech caches, audio byte ranges, change events, browser word seeking, narration playback, and study images. The detached dev launcher keeps the servers running after its command exits. The [cleanup record](data/cleanup-2026-09-09.json) lists the removals and preservation results.

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
| B08 | Story planning and continuity | Input loader complete; pilot analysis and world model drafted | Read-only Effect loader verified on the real story and covered by the current root suite. Agent-authored analysis has 15 evidenced beats and a canonical-name source check. The world model defines 9 entities, 6 time layers, 7 rhymes, and 13 invariants with fact classes, and covers all 14 treatment sequences. Automated semantic generation/output contract remain open. |
| B09 | Visual timeline | Editable timeline implemented; final treatment in progress | B14 stores immutable generation records and editable decisions on the clip sample clock; B17 seeds the 14 treatment sequences and 15 study panels. Final image choices, precise pacing, and full-film render remain. |
| B10 | Moodboards over narration, then animation | Current editor previews study shots | B15/B16 provide the working preview and scene controls; B18–B21 add timing overlays and whole-clip pilot alignment. The old comparison player is retired. Full-film image production, rendering, budget, and quality criteria remain open. |
| B11 | Ambience and music | Backlog | Needs assembled movie and sound-design criteria. |
| B12 | Pipeline runner, recovery, and autonomy measurement | Develop through real visual runs | Record cost, retries, output checks, and interventions from the first run. Reuse completed work and support selective regeneration; establish quality criteria and repeat across stories before claiming the 95% target. Choose broader durable execution from actual module needs. |
| B14 | `visual-timeline` module: generation-record and decisions schemas, merge, validation, `add`/`show` CLI | Done 2026-09-08 | `src/modules/visual-timeline/`, `config/visual-timeline.json`, `node dist/visual-timeline.js`. Records are ULID directories under `shots/`; decisions overlay in `decisions.json`; both pinned to the clip identity from `loadStoryContext`. 12 tests. `Schema.Record` key checks are not enforced in rc.112, so decision keys are validated in the merge. |
| B15 | Editor server: Effect HTTP on loopback, clip audio with byte ranges, cached peaks, story folder watch with server-sent events, static client serving | Done 2026-09-08 | `src/modules/editor-server/`, `config/editor-server.json`, `node dist/editor-server.js --config config/editor-server.json --port 63620 --static packages/editor/dist`. Peaks cache is `peaks.json` in the planning directory (21,102 buckets of 1,024 samples for the pilot), not in the verified split folder. 13 tests plus a real run. |
| B16 | Editor client: `packages/editor` with pinned Vite 8.2.2 and React 19.2.8 | Done 2026-09-08 | Waveform, word lane with click-to-seek and follow, shot lane with drag and snapping, 16:9 letterboxed preview, candidate panel, hide/merge/new-shot/attach, loop, client-only working region, debounced decisions save, live refetch on server-sent events. The client mirrors the merge rule locally for instant feedback. 25 pure-module tests plus browser QA against a mock and the real server. |
| B17 | Seed import: prototype frames and treatment spans as labeled generation records | Done 2026-09-08 | `node dist/visual-timeline-seed.js`. 29 records: 14 image-less treatment spans and 15 panels cropped from the five study boards with FFmpeg; deterministic ULIDs make reruns no-ops. A suggested `decisions.json` selecting the prototype's proposed mix was written once. 9 tests. |
| B18 | `word-timing` module: overlay schemas, effective merge, speech-region detection, align algorithm, `align` CLI; shot anchors in the timeline merge | Done 2026-09-09 | A36, A37, A42, A45–A49, A51. Completion: pure-function tests for regions and align; CLI reports before/after on a range of the pilot. |
| B19 | Editor server: speech cache beside peaks, timing merge in the story payload, manual timing write route, ranged align route, anchor-aware timeline | Done 2026-09-09 | A46, A49. Completion: routes tested against the synthetic fixture and the real clip. |
| B20 | Editor client: speech shading, three timing tracks with toggles, contiguous selection, group drag with snapping and clamping, nudge, undo/redo, autosave, align-selection with report, shot anchoring and detaching | Done 2026-09-09 | Q21, Q22, A38–A41, A44, A50–A53. Completion: browser QA on the running dev server. |
| B21 | Excerpt runs on the pilot, then whole clip on the user's say-so | Whole clip aligned 2026-09-09 | Run 0–30 s: 69 words, 8 speech regions; boundary onset error median −210 ms → 0 ms (p10 −770 → −306, p90 −106 → 0); words inside speech 87% → 100%; all shifts between +140 and +302 ms. The user judged the first 30 s "very good" and asked for the whole clip. Whole-clip run with `--all`: 1,189 words, 149 regions, 162 boundaries; onset error median −140 ms → 0 (p10/p90 −379/+480 → 0/0); words inside speech 86% → 100%. Shifts: p10 +40 ms, median +147 ms, p90 +300 ms, extremes −260 ms (around 187 s, "astronomers used a SIBO") and +540 ms (around 338 s and 454 s). Those three spots are the places to eyeball on the Auto row. No manual entries exist yet. |
| B13 | Local input organization and source relocation | Done | Five input files moved with exact hashes retained; current paths/configs/docs updated. Real imports and all 20 Exhalation pairs reuse 97 unchanged artifacts. No loose root audio/transcript files or compatibility symlinks for those inputs remain. |

Current readiness assessment: all 17 stories have verified audio/transcript pairs and live under `data/stories/`, with notes and credits retained with their books. The Great Silence is selected. Its source analysis and world model are drafted, its editable timeline and study imports work in the browser editor, and the whole clip has an automatic timing overlay. The next product delivery is a complete moodboard film: consistent visual references and story images, final pacing, and a separate render command. Image provider, budget, output settings, and quality criteria remain open. Reusable autonomous discovery and semantic generation remain backlog work. The 95% autonomy target is not demonstrated; no complete movie has been rendered.

## Legacy health

The legacy project is a TypeScript/CommonJS CLI collection with local JSON and media outputs. Its current `tsc --noEmit --incremental false --pretty false` check fails. Examples include missing `gen-shots/types`, references to `FLAGS.chapter` where the shared flag is `FLAGS.chapters`, and calls to nonexistent `CliTimer.start()`.

The existing splitter at `animator/src/split-chapters/cli.ts` reads handwritten `chapters.config.json`; it does not discover boundaries. It emits `chapter.mp3`, while the video stage expects a differently named MP3. It also writes duration metadata before extraction succeeds and lacks source identity and output verification. These findings support A1; no legacy fixes are included in the first v2 module.
