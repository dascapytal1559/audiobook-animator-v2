# Animator pipeline

Shared working document for the user and lead agent. This records the product, decisions, evidence, and implementation backlog. Agent workflow instructions live in `AGENTS.md`.

Updated: 2026-09-08, Australia/Melbourne. Alignment is ongoing; an open question is not an approved requirement. Implementation can proceed on settled modules while other branches are discussed.

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
│           └── Old prototype player discarded [A17]; behaviours from demo viewer carried [A24]
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
| A19 | A `visual-timeline` module owns two schemas per story: immutable generation records under `data/books/<book>/planning/<story>/shots/` and a `decisions.json` overlay beside them. Both pin the clip's audio and transcript hashes. The editor is a client of this module, not the owner of the format. | Separates immutable evidence from editable choices, matching A12, and lets any script produce records. |
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
| A36 | Each story gets a world model beside its analysis and treatment: stable entity IDs with canonical prompt descriptions, time layers, structural rhymes, shared visual language, and numbered invariants. Every fact is classed as stated (with evidence IDs), canonical name, cited external reference, or revisable design decision. | Separately generated images must agree with each other, and invented design details must never become story canon. The entity and invariant IDs are the fields a later B08 output contract formalizes. |

## Round responses and current frontier

**Q9 — Pilot story, confirmed:** the user selected **The Great Silence (8:10)** for the first complete moodboard film. Its verified audio and paired transcript are under `data/books/exhalation/split/segments/the-great-silence/`.

**Q10/Q11 — Visual modes, confirmed from prototypes:** the user wants both **graphic illustration** and **poetic abstraction** at their disposal, choosing one for some scenes and the other elsewhere. Retain the looks actually shown: the `graphic-literal` study and the `painterly-abstract` study. This permits both scene presets within one film; it does not select a single global treatment or silently convert the abstract option to graphic rendering.

Per-scene recommendations remain editable under A15. The initial mixed-excerpt proposal is graphic telescope, graphic neighboring parrots, then poetic abstraction for the listening passage. Those assignments are a demonstration of the control, not the user's choices for those scenes. The [full-story proposed treatment](data/books/exhalation/planning/the-great-silence/visual-treatment.md) now covers the complete 489.9856689342404-second audio in 14 adjacent visual sequences, with mode suggestions, evidence IDs, and continuity notes. The sequence spans are approximate planning boundaries, not final edit points or an image count. Scene timing, image count, production provider/budget/output settings, and quality criteria remain open.

The story is a reflective first-person parrot address. Its plan needs to support ideas and reported examples as well as physical settings. The narrator and Alex, the African gray parrot in the reported research example, must remain distinct. Recognition errors in names and terms need evidenced interpretation under A13; raw provider output stays unchanged.

A [world model](data/books/exhalation/planning/the-great-silence/world-model.md) now records the story's entities, time layers, structural rhymes, shared visual language, and thirteen numbered invariants, with every fact classed as stated, canonical, external reference, or design decision under A36. It supplies the reusable subject descriptions the treatment listed as a prerequisite for consistent reference generation; the six design defaults it chooses, such as a non-identifying Pepperberg figure, are listed for the user to change.

B08's read-only planning input loader and the pilot's [source-grounded analysis](data/books/exhalation/planning/the-great-silence/story-analysis.md) are complete. The analysis contains 15 semantic beats with 46 checked evidence IDs; these beats do not prescribe an image count. A [primary-source check](docs/research/great-silence-source-check.md) verifies canonical names while preserving raw ASR. The real CLI returns all 1,189 words and 2,512 elements exactly as they appear in the paired transcript. Build and all 83 tests pass. Automated semantic generation and its persisted output contract remain open.

**Visual prototype follow-up, authorized:** the user explicitly requested imagegen examples and a view of the proposed pipeline. Five comparison boards have been generated with the built-in image tool, each containing three frames. Three boards compare styles with concrete imagery; two additional boards compare metaphor and abstraction against the same painterly concrete baseline. The [local comparison player](http://127.0.0.1:63619/) uses the same 25.110-second narration excerpt for every option, with frame changes at source-relative times 4.9503968, 17.0103968, and 20.3203968 seconds, ending at 30.0603968 seconds. The full original story audio stays unchanged. Generated imagery remains prototype material. The later user response selects two available modes, without approving these individual frames as final assets or documentary references. Production generation provider, budget, output configuration, and acceptance criteria remain open.

The [prototype files and instructions](data/books/exhalation/planning/the-great-silence/visual-prototype/README.md) retain all five generated assets and exact prompts. Three scenes per style provide nine style examples; the interpretation view reuses the painterly concrete board and adds six metaphor/abstract examples, for 15 unique frames overall. One board has wider panels and is letterboxed rather than distorted. The player now opens in **Scene mix**, with one preview and independent selectors for all three scenes. Suggested assignments and user overrides are visible, and a reset button restores the proposal. Browser verification confirmed changes during uninterrupted playback, assignments surviving comparison-view changes, and reset behavior. Earlier checks confirmed frame seeking, narrated playback, and automatic pause at the excerpt's end. Choices remain in page memory only and clear on reload. The prototype also displays the proposed pipeline.

**Q12–Q20 — Story editor, confirmed 2026-09-08:** the user asked for a new editor centred on an audio clip, discarding the old one. Exploration found no editor in the legacy project at all; the "old editor" is the prototype comparison player, which is discarded under A17. Confirmed: **Q12** the editor is first a visual layer over script-generated storyboard shots, with finer-detail generation features added to the frontend over time; **Q13** Vite plus React in its own workspace package; **Q14** the first version has waveform and transcript words with seek, scene span create/move/split/merge/delete with snapping, per-shot mode, attaching existing images with synced preview, loop, and seeding from the treatment; **Q15** assign existing images only, with a prompt field and asset list on each shot from day one; **Q16** the whole clip always, with an unsaved working region; **Q17** two layers, immutable generation records plus a decisions overlay; **Q18** a shot is a start point that holds until the next shot, so coverage is automatic and spans are never stored; **Q19** the JSON schema is the contract and a repo CLI is a validating convenience; **Q20** a 16:9 letterboxed preview stored as a per-story setting. Assumptions A17–A35 record the resulting engineering calls.

**Editor delivered, 2026-09-08:** B14–B17 are implemented and verified together: typecheck clean, 117 root tests and 25 client tests passing, and a browser session against the real server on The Great Silence. Clicking a word seeked and played with the telescope study frame in the preview; selecting a different candidate wrote `decisions.json` within the debounce, and the CLI `show` command read the same selection back; restoring the file externally refreshed the browser through server-sent events. Known rough edges: pressing Space while a word button has focus re-triggers that word instead of pausing; treatment span 02 at 20.0 s precedes the abstract listening panel at 20.32 s, so a placeholder card shows for a third of a second until one of them is moved or hidden. The old prototype player and `HANDOFF.md` are discarded; the prototype's files remain as evidence.

**Q4 — Finished cut:** the user wants mostly narration eventually, with detailed trimming and possible pacing changes later. Getting stories split and selectable is the immediate priority. The previous whole-track metadata recommendation was not adopted as a finished-cut contract.

Implementation consequence: source inspection is useful now; do not build detailed silence/music/title trimming into the first splitter without further need.

**Q5 — First-release coverage and order:** the user says the metadata is not good enough and requests facts about whether likely transcription models can take a whole book. If feasible, timed transcription may move before splitting.

Research is complete in [whole-book-transcription.md](docs/research/whole-book-transcription.md), using the matts-research skill. Rev AI documents 17-hour/2-GB multipart submissions with timed words and retrievable jobs, so both originals fit. The note compares current alternatives, costs, duration/byte limits, timestamp support, and recovery behavior. This establishes documented feasibility, not measured recognition accuracy or complete coverage. Metadata remains optional supporting evidence.

**Q6 — Movie result:** moodboards over the story's narration are a good milestone. The final product should be animated. This replaces the earlier recommendation to make generated motion shots the first visual result.

Questions Q1-Q3 are answered in the target section. Q4-Q6 responses are captured above; no previous recommendation should be treated as accepted merely because it was recommended.

**Q7 — First transcription implementation:** the user requested a small Rev AI demo and asked whether it returns timestamps. Rev supplies timed words. That request authorized the small demo. The later full-book authorization is recorded below.

The prepared demo is 120 seconds near the opening of What's Expected of Us. It starts at 6450 seconds on FFmpeg's decoded-audio clock and is encoded as 24-bit FLAC, mono, 44.1 kHz. Exact source/clip hashes, sample counts, timestamps, and extraction commands are in `data/demo/rev-ai/input-provenance.json`. The metadata position is only a sample locator, not an approved story boundary.

The user signed into Rev AI. Account billing showed US$1 in free credit and no attached card; the dashboard showed 300 trial minutes. One two-minute sample was submitted through the dashboard, with 298 minutes shown as the resulting allowance. For that demo, no API token was created and no billing method was added. The user initially saved the dashboard JSON as root `input.json`; its unchanged bytes are now retained at `data/demo/rev-ai/input/rev-export.json` and excluded from Git. No full-book submission had been made at that point; the later authorized run is recorded below.

The completed [Rev job](https://www.rev.ai/jobs/speech-to-text/znnDmVYYcvkBwgit/results) is `znnDmVYYcvkBwgit`. The module imported its exact JSON without a network request and produced **344 timed words**, preserving punctuation and confidence values. All returned word times passed range and ordering checks. This is a live successful timestamp demo, not a measured recognition-error rate or whole-book coverage result.

| Sample event | Clip time | Original decoded-audio time |
| --- | --- | --- |
| Spoken title starts: What's Expected of Us | 00:11.345 | 01:47:41.345 |
| Story narration starts: This is a warning | 00:14.555 | 01:47:44.555 |
| Last returned word ends | 01:58.855 | 01:49:28.855 |

The excerpt also contains speech from the preceding piece. The title and narration are distinguishable in the returned transcript, providing useful evidence for later story-boundary detection. These observations are not yet an implemented automatic boundary detector.

Demo artifacts are under `data/demo/rev-ai/`: verified `input.flac`, source provenance, exact raw transcript, normalized transcript/text, and a clickable-word HTML viewer. Original-book timestamps use the decoded-audio clock; raw MP3/container/chapter clocks are not silently assumed equivalent. The local preview server supports byte-range requests for audio seeking. Browser verification confirmed that clicking the title word seeks to its timestamp and starts playback; the viewer is left paused for review.

Final demo verification on 2026-09-06: build and all 30 tests passed, and `git diff --check` was clean. The viewer is at `data/demo/rev-ai/demo.html`; the running local preview is [http://127.0.0.1:63618/demo.html](http://127.0.0.1:63618/demo.html). See `README.md` for restarting the preview.

Rev's documented 17-hour/2-GB multipart limits fit both full original files, and the published English Reverb price implies about US$4.35 total before credits or tax. These are possible next steps after evaluating the demo. [Limits](https://docs.rev.ai/faq), [pricing](https://www.rev.ai/pricing).

**Full-book follow-up:** the user asks whether adding US$10 lets us transcribe a whole book in one go and clarifies that inaccurate metadata is the reason for this order. Yes: the planned first run is one original MP3 submitted as one asynchronous Rev job, returning one timed book transcript. Rev may divide the audio internally; that does not define our story boundaries. Exhalation was selected as the first complete-book validation before processing the second collection. The subsequent funding and submission are recorded below.

Rechecked on 2026-09-06: English Reverb remains US$0.20 per audio hour. Exhalation is approximately US$2.27 and Stories of Your Life and Others US$2.08, about US$4.35 together before credits or tax. Before funding, the signed-in billing page showed US$0.99 free credit and no purchased balance. The credit form accepts an amount of minutes: 3,000 minutes displayed US$9.99. The published price and exact book durations support the transcription estimates; the displayed checkout total is the credit purchase amount. [Rev pricing](https://www.rev.ai/pricing), [credit purchase page](https://www.rev.ai/billing/credits).

**Full-book run authorized:** the user completed the credit purchase and said, "ok done. u take over?" Before submission, the account showed US$9.99 purchased credit plus US$0.99 free credit, US$10.98 total, with auto reload disabled. The final post-job debit has not been checked. Proceed with one whole original Exhalation MP3 as the first full-book Rev job. No additional funding or repeated approval is needed for that run. The agent has not entered payment details or purchased credit.

Source inspection was refreshed before upload: SHA-256 `e4a985adb7d41a201c07f016c2ffb8e66c4f1dd13e509a3dbc169bf1e0acf08c`, 287,915,850 bytes, 40,928.885261 seconds, audio stream 0. Local preparation and dashboard evidence live in `data/books/exhalation/`. The user enabled Chrome file access, the complete original file uploaded, and Rev accepted job **`eekQ2vQNJp3XjfF6`**, created on 2026-09-06 at 02:42:27 Melbourne time. It completed at 02:49:53 Melbourne time. English was selected; no custom vocabulary was added. The completed job is [available in Rev](https://www.rev.ai/jobs/speech-to-text/eekQ2vQNJp3XjfF6/results); it must not be submitted again.

The exact dashboard JSON was downloaded locally (now `data/books/exhalation/input/rev-export.json`) and imported into `data/books/exhalation/artifacts/`. It contains **100,593 timed words** across 616 provider monologues; normalization retains all 211,349 word and punctuation elements. The raw export is 11,561,435 bytes with SHA-256 `4604beb371cc9094b6c31a08b3ad9dad33aed2b54c76058ba770c6731ef62dcf`. Source identity, job identity, raw bytes, timestamp ranges, and ordering passed import checks. The JSON itself does not authenticate which dashboard job supplied it; that association is recorded explicitly.

Rev's final duration is 11:22:09, matching the rounded local duration. Its earlier upload estimate of 40,935 seconds is retained separately. Original provider word times remain unchanged. Comparing 343 matched words with the source-mapped demo near 6450 seconds gives a median start-time difference of -0.020 seconds, with the 5th–95th percentiles at -0.100 to +0.070 seconds. This supports a nominal zero offset for approximate word playback; it does not establish exact alignment throughout the book.

Two independent transcript passes agree on nine stories, nine author notes, opening credits, and closing credits. All 100,593 returned words are assigned exactly once: 97,870 to stories, 2,650 to notes, and 73 to credits. The title **Omphalos** was misrecognized as “Ias”; its canonical title is recorded separately, preserving the raw transcript. The published contents provide the expected story names and order, not cut times. [Publisher contents](https://subterraneanpress.com/exhalation/).

Each of the 19 internal audio boundaries falls at the midpoint of a separately measured quiet gap on FFmpeg's decoded-audio clock, with at least 1.022 seconds to either quiet edge. The Omphalos cut precedes the full audible title onset despite its incomplete token timing. Exact decoding gives **1,804,963,840 samples at 44,100 Hz**. The 20 planned audio intervals partition sample 0 through that endpoint without gaps or overlaps. Evidence and hashes are recorded in `data/books/exhalation/split-plan.json` and `cut-boundary-validation.json`; no chapter metadata or legacy trim supplied a boundary. These checks establish the first book's split evidence, not a recognition-error rate or a reusable autonomous discovery service.

The whole-book importer preserves source identity and provider-relative timestamps. The extraction module verifies lossless FLAC encoding, output identity, and exact decoded sample counts before declaring completion. A separate recovery fix refuses a fresh paid API submission when artifacts remain but submission/job records are missing; regression tests cover completed-job remnants and partial files.

An early real export exposed a FLAC framing edge case: an exact cut left a seven-sample first frame, which the encoder rejected. Explicit encoder framing (`-frame_size 4608`) fixes it without moving cuts or padding audio. Regression tests cover that MP3 frame boundary and exact 1/7/15-sample outputs. The isolated real cut now matches a direct source PCM extraction; existing verified manifests remain unchanged. The build and all 68 combined tests pass, and the resumed export completed all 20 pairs.

The local [Exhalation inventory](data/books/exhalation/split/inventory.md) links nine stories and eleven extras, each with verified audio, timed JSON, and plain text.

Independent acceptance passed: ordered decoding of the 20 FLAC files exactly reconstructs the original book converted to 24-bit PCM, and recombining transcript elements exactly reproduces all 211,349 original elements, 100,593 words, and the complete original text. The PCM comparison covers 5,414,891,520 bytes / 1,804,963,840 mono samples at 44.1 kHz, with SHA-256 `2dd94586dc7cc9d607da7ce73c74af751d7703c73498dab9324ae53ab41bb1bb`. All input, evidence, and output hashes remained unchanged. The verification script and results are local at `data/books/exhalation/verify-paired-output.py` and `paired-output-verification.json`. This verifies preservation across the split; provider word alignment and recognition accuracy remain separate concerns.

**Q8 — Selection order:** the user does not want to choose a story before splitting. Once the book transcript returns, discover all of its stories, split the transcript and corresponding original audio together, then provide an inventory of every story with its duration. The user will inspect that inventory and choose based on duration. The earlier recommendation to start with What's Expected of Us was not adopted. Credits and notes remain separately classified under A6.

**Second collection authorized:** after reviewing the Exhalation inventory, the user said, “ok spawn an agent to split the other book also.” The initial agent prepared and submitted the original **Stories of Your Life and Others** MP3 once. Rev job **`gbuckIu5tGOf8MiK`** was created at 04:02:31 and completed at 04:10:44 Melbourne time on 2026-09-06. The recorded balance fell by US$2.08 to US$6.63, with auto reload still disabled. No new purchase was made.

The user later saved the requested JSON export as root `book_Stories.json`, resolving the native export-save interruption. Import completed successfully with **91,213 timed words** and 192,026 transcript elements. Its exact raw bytes are now under `data/books/stories-of-your-life-and-others/input/rev-export.json`; original source bytes are under `input/book.mp3`. The explicit importer config is `config/rev-stories-book.json`. Current source identity remains SHA-256 `cb7b97dd6bda3c1fd45237b65b6181d93f8fb9182fb27ac3c1b4513fd11ed3e6`, 209,581,343 bytes, 37,406.139501 seconds.

Agent `second_book_resume` completed the remaining split and acceptance. Primary discovery and an independent audit agree on eight stories, eight separately titled notes, and opening/closing credits. All returned words and elements are assigned once; all 17 transitions have independently measured quiet gaps. The plan partitions exactly 824,805,376 decoded samples at 22,050 Hz, with at least 1.276 seconds of quiet audio on each side of every internal cut. All 18 paired outputs are now complete. Independent acceptance exactly reconstructed 192,026 transcript elements and 91,213 words, plus 2,474,416,128 bytes of decoded 24-bit PCM (824,805,376 mono samples at 22,050 Hz). PCM SHA-256: `ed2cee91590b5d56e2bede72ab6004290667a3425106b4e6ed26eed5badf9462`. All pinned hashes, displayed durations, and 54 inventory links passed. The [second-book inventory](data/books/stories-of-your-life-and-others/split/inventory.md) and its `paired-output-verification.json` are ready. Metadata cannot supply or override boundaries, and no additional transcription request is needed. The Exhalation inventory remains available for selection.

**Input organization — confirmed by cleanup request:** originals and raw Rev exports now live under `data/books/<book>/input/`; imported artifacts and paired outputs keep their existing book folders. The demo export is under `data/demo/rev-ai/input/`. New user downloads can be saved to `data/inbox/`. Both MP3s and all three moved exports retained their exact byte counts and SHA-256 values; `data/input-relocation.json` records the old and current locations. Historical run evidence is retained unchanged. Source locations are now separate from content identity for import and split reuse. The importer reports `currentSourcePath` separately from historical source evidence; the splitter accepts explicit `--source` without changing the old plan or cached outputs. All 73 tests pass. Real reruns through the new locations preserved all 97 pre-existing import and Exhalation split artifacts byte-for-byte, and all five moved inputs retain matching hashes. Checks are in `data/input-relocation-verification.json`. Output-directory relocation remains outside this change.

**Inventory synopses — user follow-up:** the user requested a synopsis for each story. Agents wrote original, premise-only descriptions for all 17 stories and checked them against the paired transcripts. Each book's editable `synopses.json` records its story IDs, canonical titles, and transcript hashes. The focused `story-inventory` module now publishes the [combined Markdown inventory](data/books/inventory.md), its JSON counterpart, and readable inventories for [Exhalation](data/books/exhalation/inventory.md) and [Stories of Your Life and Others](data/books/stories-of-your-life-and-others/inventory.md). Descriptions, durations, and file links appear together, shortest story first. Existing split inventories remain unchanged acceptance artifacts.

Verification on 2026-09-07: strict typechecking and all 79 tests passed, including six inventory tests covering invalid associations, stale evidence, output collisions, file limits, and repeated description edits. The real render produced all 17 entries with the original exact duration/sample/hash records preserved in JSON; all 108 Markdown links resolve. The 123 non-audio split files retained identical hashes, and all 38 audio files retained their size and modification time. No audio decoding, extraction, or provider request was needed.

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
| B07 | Book-level timed transcription | Both books imported | Exhalation job `eekQ2vQNJp3XjfF6`: 100,593 timed words. Stories job `gbuckIu5tGOf8MiK`: 91,213 timed words. Exact exports retained. Production API submission remains unimplemented; existing API mode is demo-capped with missing-state resubmission protection. |
| B07a | Playable timestamp demo | Done | Live 120s Rev result imported: 344 timed words. Raw JSON retained exactly; clickable viewer generated and browser seeking/playback verified. |
| B07b | Story inventory and selection | Complete; user selection next | The [17-story inventory](data/books/inventory.md) and both per-book reading views contain verified durations, premise-only synopses, and audio/transcript links. The reusable renderer checks all synopsis associations and publishes Markdown/JSON without changing split evidence. |
| B08 | Story planning and continuity | Input loader complete; pilot analysis and world model drafted | Read-only Effect loader verified on the real story; all 83 tests pass. Agent-authored analysis has 15 evidenced beats and a canonical-name source check. The world model defines 9 entities, 6 time layers, 7 rhymes, and 13 invariants with fact classes, and covers all 14 treatment sequences. Automated semantic generation/output contract remain open. |
| B09 | Visual timeline | Full-story treatment draft ready | Fourteen proposed visual sequences cover the full narration with graphic/poetic mode suggestions, evidence IDs, and continuity notes. The user can override individual scenes. Executable timeline, final timing, and image count remain open. |
| B10 | Moodboards over narration, then animation | Per-scene mixing prototype ready | Graphic illustration and poetic abstraction are accepted as available modes. The player supports independent scene assignments, suggested/user override state, and reset while retaining comparisons. Browser checks passed. The full moodboard film, production settings/budget, and quality criteria remain open. |
| B11 | Ambience and music | Backlog | Needs assembled movie and sound-design criteria. |
| B12 | Pipeline runner, recovery, and autonomy measurement | Develop through real visual runs | Record cost, retries, output checks, and interventions from the first run. Reuse completed work and support selective regeneration; establish quality criteria and repeat across stories before claiming the 95% target. Choose broader durable execution from actual module needs. |
| B14 | `visual-timeline` module: generation-record and decisions schemas, merge, validation, `add`/`show` CLI | Done 2026-09-08 | `src/modules/visual-timeline/`, `config/visual-timeline.json`, `node dist/visual-timeline.js`. Records are ULID directories under `shots/`; decisions overlay in `decisions.json`; both pinned to the clip identity from `loadStoryContext`. 12 tests. `Schema.Record` key checks are not enforced in rc.112, so decision keys are validated in the merge. |
| B15 | Editor server: Effect HTTP on loopback, clip audio with byte ranges, cached peaks, story folder watch with server-sent events, static client serving | Done 2026-09-08 | `src/modules/editor-server/`, `config/editor-server.json`, `node dist/editor-server.js --config config/editor-server.json --port 63620 --static packages/editor/dist`. Peaks cache is `peaks.json` in the planning directory (21,102 buckets of 1,024 samples for the pilot), not in the verified split folder. 13 tests plus a real run. |
| B16 | Editor client: `packages/editor` with pinned Vite 8.2.2 and React 19.2.8 | Done 2026-09-08 | Waveform, word lane with click-to-seek and follow, shot lane with drag and snapping, 16:9 letterboxed preview, candidate panel, hide/merge/new-shot/attach, loop, client-only working region, debounced decisions save, live refetch on server-sent events. The client mirrors the merge rule locally for instant feedback. 25 pure-module tests plus browser QA against a mock and the real server. |
| B17 | Seed import: prototype frames and treatment spans as labeled generation records | Done 2026-09-08 | `node dist/visual-timeline-seed.js`. 29 records: 14 image-less treatment spans and 15 panels cropped from the five study boards with FFmpeg; deterministic ULIDs make reruns no-ops. A suggested `decisions.json` selecting the prototype's proposed mix was written once. 9 tests. |
| B13 | Local input organization and source relocation | Done | Five input files moved with exact hashes retained; current paths/configs/docs updated. Real imports and all 20 Exhalation pairs reuse 97 unchanged artifacts. No loose root audio/transcript files or compatibility symlinks for those inputs remain. |

Current readiness assessment: both original books are transcribed and all 17 stories have verified audio/transcript pairs, with notes and credits kept separately. Both whole-book reconstruction checks passed, and the [combined inventory](data/books/inventory.md) is ready for selection by duration and synopsis. B07b is complete. The Great Silence is selected under Q9. B08's verified input loader is implemented and its agent-authored source analysis is ready. The next delivery is its complete moodboard film through B08/B09/B10. Q10/Q11 establish two visual modes available per scene. The editable mixed-excerpt prototype and proposed full-story treatment are ready for creative iteration. The treatment can inform the reusable timeline contract; production provider, cost, output settings, and quality criteria remain open. Reusable autonomous discovery, automated semantic planning, and movie generation remain outstanding; the 95% autonomy target is not yet demonstrated. No movie has been produced.

## Legacy health

The legacy project is a TypeScript/CommonJS CLI collection with local JSON and media outputs. Its current `tsc --noEmit --incremental false --pretty false` check fails. Examples include missing `gen-shots/types`, references to `FLAGS.chapter` where the shared flag is `FLAGS.chapters`, and calls to nonexistent `CliTimer.start()`.

The existing splitter at `animator/src/split-chapters/cli.ts` reads handwritten `chapters.config.json`; it does not discover boundaries. It emits `chapter.mp3`, while the video stage expects a differently named MP3. It also writes duration metadata before extraction succeeds and lacks source identity and output verification. These findings support A1; no legacy fixes are included in the first v2 module.
