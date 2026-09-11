# Project evidence and round responses

Archived from `PIPELINE.md` on 2026-09-09 during the approved cleanup. These sections record decisions as they were made and facts as they were measured; paths and commands reflect the layout at the time. The live decision record is [CONTEXT.md](../../CONTEXT.md).

## Relocations and cleanups

On 2026-09-06 the original MP3s and raw Rev exports moved from the project root into `data/books/<book>/input/`, with hashes verified before and after and the checks recorded in relocation files that have since been removed. On 2026-09-09 every story moved from `data/books/<book>/split/segments/<story>/` into `data/stories/<story>/` with a `story.json` manifest (`data/story-relocation.json`), the demo transcription code and comparison player were retired (`data/cleanup-2026-09-09.json`), and intermediate scan logs, the demo material, and the relocation bookkeeping were purged with the user's approval (`data/cleanup-2026-09-09b.json`). The generalised acceptance script now lives at `scripts/verify-paired-output.py`.

## Round responses and current frontier

**Q9 — Pilot story, confirmed:** the user selected **The Great Silence (8:10)** for the first complete moodboard film. Its verified audio and paired transcript are under `data/stories/the-great-silence/`.

**Q10/Q11 — Visual modes, confirmed from prototypes:** the user wants both **graphic illustration** and **poetic abstraction** at their disposal, choosing one for some scenes and the other elsewhere. Retain the looks actually shown: the `graphic-literal` study and the `painterly-abstract` study. This permits both scene presets within one film; it does not select a single global treatment or silently convert the abstract option to graphic rendering.

Per-scene recommendations remain editable under A15. The initial mixed-excerpt proposal is graphic telescope, graphic neighboring parrots, then poetic abstraction for the listening passage. Those assignments are a demonstration of the control, not the user's choices for those scenes. The [full-story proposed treatment](../../data/stories/the-great-silence/visual-treatment.md) now covers the complete 489.9856689342404-second audio in 14 adjacent visual sequences, with mode suggestions, evidence IDs, and continuity notes. The sequence spans are approximate planning boundaries, not final edit points or an image count. Scene timing, image count, production provider/budget/output settings, and quality criteria remain open.

The story is a reflective first-person parrot address. Its plan needs to support ideas and reported examples as well as physical settings. The narrator and Alex, the African gray parrot in the reported research example, must remain distinct. Recognition errors in names and terms need evidenced interpretation under A13; raw provider output stays unchanged.

B08's read-only planning input loader and the pilot's [source-grounded analysis](../../data/stories/the-great-silence/story-analysis.md) are complete. The analysis contains 15 semantic beats with 46 checked evidence IDs; these beats do not prescribe an image count. A [primary-source check](../../docs/research/great-silence-source-check.md) verifies canonical names while preserving raw ASR. The real CLI returns all 1,189 words and 2,512 elements exactly as they appear in the paired transcript. The planning-input checks pass in the current root suite. Automated semantic generation and its persisted output contract remain open.

**Visual studies and current interface:** five imagegen boards supplied 15 frames for the user to compare. The user selected graphic illustration and poetic abstraction as available scene modes. The boards, prompts, and identities are retained in [the study archive](../../data/stories/the-great-silence/visual-prototype/README.md) and imported into the editor under B17. The old comparison player and the Rev timestamp demo entry points were retired on 2026-09-09. Original narration, provider exports, and completed evidence remain intact. Production image generation, budget, and full-film quality criteria remain open.

**Q12–Q20 — Story editor, confirmed 2026-09-08:** the user asked for a new editor centred on an audio clip, discarding the old one. Exploration found no editor in the legacy project at all; the "old editor" is the prototype comparison player, which is discarded under A17. Confirmed: **Q12** the editor is first a visual layer over script-generated storyboard shots, with finer-detail generation features added to the frontend over time; **Q13** Vite plus React in its own workspace package; **Q14** the first version has waveform and transcript words with seek, scene span create/move/split/merge/delete with snapping, per-shot mode, attaching existing images with synced preview, loop, and seeding from the treatment; **Q15** assign existing images only, with a prompt field and asset list on each shot from day one; **Q16** the whole clip always, with an unsaved working region; **Q17** two layers, immutable generation records plus a decisions overlay; **Q18** a shot is a start point that holds until the next shot, so coverage is automatic and spans are never stored; **Q19** the JSON schema is the contract and a repo CLI is a validating convenience; **Q20** a 16:9 letterboxed preview stored as a per-story setting. Assumptions A17–A35 record the resulting engineering calls.

**Editor delivered, 2026-09-08:** B14–B17 are implemented and verified together: typecheck clean, 117 root tests and 25 client tests passing, and a browser session against the real server on The Great Silence. Clicking a word seeked and played with the telescope study frame in the preview; selecting a different candidate wrote `decisions.json` within the debounce, and the CLI `show` command read the same selection back; restoring the file externally refreshed the browser through server-sent events. Known rough edges: pressing Space while a word button has focus re-triggers that word instead of pausing; treatment span 02 at 20.0 s precedes the abstract listening panel at 20.32 s, so a placeholder card shows for a third of a second until one of them is moved or hidden. The old prototype player and `HANDOFF.md` are discarded; the prototype's files remain as evidence.

**Q21–Q25 — Word timing alignment, confirmed 2026-09-09:** the user wants to select several words or sentences with Shift and move their timestamps as a group, because the provider timings do not match the waveform, plus a scripted first pass. Measurement on The Great Silence (10 ms RMS envelope, -50 dBFS threshold) found a constant lead of about 150 ms at phrase onsets and offsets, jitter with a spread of about 140 ms, no drift, 63% of word ends butt-joined to the next start, and 86% of words fully inside detected speech. A global shift plus per-phrase snap with interior scaling raises that to 94%. No model-based aligner is installed locally; Rev offers forced alignment by public URL at about US$0.18 per audio hour; a local CTC aligner would need a pinned Python sidecar. Confirmed: **Q21** translate only, start time matters most; **Q22** shots follow their word by default and detach when moved, with the audio clock as ground truth; **Q23** the script writes directly and the user spot-checks excerpts before the whole clip; **Q24** the energy-only pass in this repo is the first pass; **Q25** phrase-accurate timing is enough for now, with a CTC aligner as the upgrade path. Assumptions A36–A53 record the design.

Earlier transcription, splitting, relocation, and inventory progress is retained in [the early-run history](../../docs/history/early-pipeline-runs.md). Those entries describe the implementation at the time; the current backlog below records what remains active.


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


## Legacy health

The legacy project is a TypeScript/CommonJS CLI collection with local JSON and media outputs. Its current `tsc --noEmit --incremental false --pretty false` check fails. Examples include missing `gen-shots/types`, references to `FLAGS.chapter` where the shared flag is `FLAGS.chapters`, and calls to nonexistent `CliTimer.start()`.

The existing splitter at `animator/src/split-chapters/cli.ts` reads handwritten `chapters.config.json`; it does not discover boundaries. It emits `chapter.mp3`, while the video stage expects a differently named MP3. It also writes duration metadata before extraction succeeds and lacks source identity and output verification. These findings support A1; no legacy fixes are included in the first v2 module.

## Stack evidence at foundation time


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

**Cleanup, 2026-09-09 — approved:** retired the old timestamp viewer, demo-only Rev submission/import scaffolding, and comparison player; retained shared whole-book normalization/import and all accepted source evidence. Removed scratch media and empty logs. The client now consumes configured chunking thresholds, and dev-server shutdown is scoped to this checkout. Historical MP3 blobs were removed from local Git storage without changing the current committed tree or index. Verification passed: 121 root tests, 45 editor tests, and the client build. All 300 protected data files (4,354,476,081 bytes) retained their hashes. Live checks covered the story/timeline APIs, waveform and speech caches, audio byte ranges, change events, browser word seeking, narration playback, and study images. The detached dev launcher keeps the servers running after its command exits. The [cleanup record](../../data/cleanup-2026-09-09.json) lists the removals and preservation results.

