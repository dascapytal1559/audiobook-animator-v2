# The Great Silence: first-pass gauntlet

Status: workshop draft, 2026-09-17. The user has settled the objective, creative freedom, GPT retranscription, and spending limits. The execution assumptions below remain visible for the closing alignment review. Writing or reading this document does not start the production run.

This is a task brief, not a replacement for repository `AGENTS.md`. The method draws on [Matt Shumer's Gauntlet Loop](https://somethingbig.ai/gauntlet-loop) and [his published prompt](https://github.com/mshumer/Claude-of-Duty/blob/main/prompt.md).

## Agreed brief

- Produce a good first pass of the entire **The Great Silence**, story id `the-great-silence`, around its original audiobook narration, approximately 8 minutes 10 seconds.
- The desired response is **wow and coherence**. Recurring characters and objects must remain recognizable across shots.
- Completely disregard the existing treatment. Its scene divisions, pacing, palette, motifs, and shot choices impose no constraints on this run.
- The visual style also starts fresh. Audition visual directions and choose autonomously.
- Retranscribe the story with GPT before building the new visual timeline.
- The run may consume **20 percentage points of the total Codex weekly allowance**, measured from a fresh baseline at execution start. This is not 20% of the remaining allowance and not a token count.
- Separately, up to **US$5 total** is authorized for GPT transcription and its retries. Image generation must use the included Codex allowance, not separately billed image APIs.

## Execution assumptions for final alignment review

1. Deliver a complete moodboard film: an editable image track in the existing editor and a playable video export. Generated animation comes later.
2. Preserve the original narration and its timing, including the ending and quiet intervals. Use narration alone for this pass; music and added sound design remain later work.
3. Keep a 16:9 frame. Export a 1920×1080 MP4 using ordinary playback-compatible codecs; record the actual render settings. Favor deliberate composition, cuts, and holds for this pass.
4. Archive the old pilot timeline intact before transcript promotion, then start a fresh timeline. This supersedes the earlier proposal to retain old and new work as simultaneous image tracks, because their transcript identities will differ.
5. Establish reusable visual references before producing the full sequence. Review actual artifacts with fresh critics, including both sequence-level coherence and character/object continuity.
6. Build only the tooling needed to deliver this film. Preserve existing user work; do not turn this run into a general pipeline redesign.
7. Once the brief is confirmed, make routine creative and implementation decisions autonomously and report material decisions. Routine stage approvals are not part of the run.
8. Establish full-story coverage before extensive refinement. Reserve allowance for assembly, checks, and handoff, and retain the best complete cut during subsequent iterations.

## Runnable prompt

You are directing and producing the first complete moodboard film of **The Great Silence** in this repository. Your job is to deliver a film that creates a sense of wow and feels coherent from beginning to end. Recurring characters, objects, and locations must remain recognizable as composition, viewpoint, and lighting change.

Apply the agreed brief and execution assumptions above. Read and follow the applicable `AGENTS.md`. Treat the existing treatment and old visual studies as archived experiments, with no creative authority over this run. Build your interpretation from the new GPT working transcript and the original narration. Verify any reused factual research against those inputs; do not inherit the old visual plan through its story analysis.

Work through the following stages without routine approval stops. Keep the user informed about material creative and technical decisions. If a real blocker prevents authorized work, preserve a useful checkpoint and name the exact blocker.

### 1. Establish the run and its limits

Run the repository's session checks and inspect current work before making changes. Record the verified story identity, execution settings, prompt version, output locations, and starting quota measurement beside the run artifacts. Every story artifact must carry its applicable clip identity and the parameters or provenance that produced it.

Read quota through the authenticated local Codex app-server interface, `account/rateLimits/read`, or an equivalent verified account meter. Record the relevant bucket identifiers, weekly window, used percentage, and reset time. Confirm which meter applies to the executing session and its built-in image generation; do not silently substitute an unrelated bucket. The historical reading of 13% used from the alignment conversation is not the execution baseline.

The maximum authorized increase is 20 percentage points of the total weekly allowance. Check usage before and after costly work and after each critique wave. Treat concurrent account usage conservatively as consumption of this envelope when attribution is unavailable. A quota reset must not grant this run another 20 points: keep cumulative consumption across windows. Do not convert the allowance to a guessed token budget.

Budget observations can be rounded and work can remain in flight. Initially reserve at least 2 percentage points of the envelope for completion and handoff; adjust conservatively using observed costs. Keep expensive batches small, and issue image-generation calls sequentially until their quota impact is understood. Stop launching improvements early enough to complete the best cut within the limit. If telemetry disappears or its applicable bucket cannot be established, pause new expensive work and report the uncertainty; do not claim an enforceable limit without evidence.

Track the transcription API budget separately. Verify the requested transcription model and current official pricing before submitting, estimate each request conservatively, retain available usage evidence, and bound retries within US$5. The authorization does not include API image generation. Use the built-in image-generation tool and its applicable skill; do not silently switch to an API fallback if it is unavailable.

### 2. Establish the GPT working transcript

Inspect the existing transcription commands and scripts, then use that supported path. Record a story-specific run file. Retain raw GPT responses and joining evidence; reuse completed matching requests where supported. Verify joins, text coverage, proper names, and timing inputs against the narration evidence available to you. Clearly distinguish automated timing checks from any actual listening review.

Prepare and validate the new transcript before disturbing the active pilot. Current promotion refuses stories containing shots or nonempty shot decisions. Preserve the old shot records, images, decisions, and enough of their old clip context to recover the previous pilot as a coherent archive. Record and verify the archive's contents before removing anything from the active location. Never rewrite the immutable shot records to impersonate the new transcript identity.

Manage the editor only through `scripts/editor-dev.sh`. Stop it for the archive/promotion transition. Promote exclusively through `animator transcription promote`; do not hand-edit the working transcript or manifest identity. Preserve a recovery path if the transition fails. Run waveform alignment for the complete newly promoted story as part of this authorized preparation, then restart the editor and verify that it loads the new identity.

Build all new word anchors and story artifacts against the GPT identity. Do not carry retired word ids into the new timeline. Be explicit if initial timestamps use the existing Rev seed before waveform alignment.

### 3. Choose a visual direction that can sustain a film

Read the complete GPT transcript and develop a fresh account of the story's progression, perspective, and visual opportunities. Preserve the narration's meaning and reveal order. Distinguish what the story states from visual invention. In particular, keep distinct narrative individuals distinct, and preserve the difference between speculation and events that occur.

Audition two or three substantially different visual directions within the budget. Compare them on the same small set of story moments. Include a recurring character and an important recurring object in different viewpoints or circumstances, plus a moment that tests expressive range. The audition must demonstrate repeatable identity and visual storytelling as well as an attractive frame.

Select a small, inspectable reference set for composition, visual craft, and pacing. Record what each reference is useful for; treat it as a quality target rather than a demand for literal imitation. Keep reference expectations compatible with a moodboard film.

Have a fresh critic inspect the auditions against the brief and references, using neutral candidate labels where useful. Choose the direction with the strongest combined visual impact, identity consistency, and capacity to carry the entire story. Record the decision and its evidence. Do not ask the user to choose routine candidates.

### 4. Establish continuity and the fresh shot plan

Create a compact set of canonical images for recurring characters, objects, and locations actually needed by the film. Give each a stable identity, reference image paths, recognizable features, and a short list of features that must persist. Keep this practical: include only information exercised by the shots.

Use the actual reference images in subsequent generation and editing, rather than relying on repeated text descriptions alone. Inspect local reference images before editing them, following the image tool's requirements. Label the roles of identity references, style references, and edit targets explicitly. Copy project assets into the workspace and retain their prompts, reference relationships, and generation provenance.

Plan the complete visual sequence against the GPT narration using integer clip samples and current word ids. Each shot should have a narrative purpose, its intended composition, relevant recurring identities, and a reason for its timing. Choose shot count and duration from meaning and pacing, not a fixed cadence or the previous treatment's sequence count. Cover the beginning, ending, and quiet intervals deliberately.

### 5. Build a complete first cut

Generate and inspect the required images. Use the current timeline contracts and supported writers to publish new immutable shot records and editable selections. Mint new ids for revisions. Keep prompt, reference, and parameter provenance with the run outputs.

Assemble a complete image track in the editor and a playable MP4. Verify that selections and shot timing agree between the editor and the export. Preserve the original narration's sequence, timing, and full tail; document codec and muxing tolerances rather than claiming encoded audio is byte-identical to the source.

Reach a complete, inspectable cut before spending heavily on local polishing. Keep versions so a weaker revision cannot destroy the best complete result.

### 6. Run the gauntlet on the actual result

Use fresh-context critics separate from the agent defending or building a shot. Give them the brief, relevant source evidence, references, and actual artifacts. Do not feed them the builder's self-assessment as a conclusion to adopt. Delegate bounded independent work only where it helps the film and fits the shared budget.

Review through three lenses:

- **Visual impact:** compositions, lighting, scale, texture, and memorable moments; whether the images reward looking.
- **Continuity:** recognizable recurring characters, objects, and locations across the whole sequence; consistent design and meaningful changes in state.
- **Film coherence:** relationship to the narration, shot order, transitions, pacing, development of motifs, and the ending's effect.

Critics must inspect actual image outputs, cross-shot comparisons, and the assembled sequence through available playback or video-inspection tools. A contact sheet helps continuity review but cannot establish audiovisual pacing by itself. State exactly what was inspected; never claim to have watched or listened when only still frames or transcript text were available. Carry any unreviewed dimension into the handoff as an explicit limitation.

Each critique should identify a small ranked set of consequential problems. For each, name the shot ids or time range, describe observable evidence, explain its effect on the film, and propose a concrete change. Avoid unsupported numeric quality scores and broad praise. Technical validity is necessary but does not establish visual quality.

The lead selects the largest meaningful gap, revises the affected artifacts, and requests a fresh comparison. Recheck continuity neighbors after a local change and the complete sequence after a substantial wave. Prefer an improvement only when the evidence supports it; preserve or restore the stronger version when a revision regresses.

Continue while meaningful improvement remains and the budget can support it. An arbitrary round count is not a completion criterion. Stop on satisfactory results, diminishing useful returns, the protected completion reserve, or a concrete blocker. Report which condition actually stopped the run.

### 7. Verify and hand off

Verify all selected images exist and decode, the visual track covers the entire clip, sample positions and word anchors are valid for the GPT identity, and the export plays with the full narration and intended final frame. Check resolution, duration, audio presence, and agreement with the editor. Run checks appropriate to any code changes, including `pnpm check` before claiming those changes are validated.

Deliver:

- An editor link opening the new story track at the start.
- A playable 16:9 MP4 and its exact render settings.
- Canonical continuity references, final shot assets, and the editable timeline.
- The run's parameters and provenance, including GPT transcription evidence and the preserved previous pilot.
- Concise critique/revision evidence, actual quota observations, API costs or clearly labeled conservative estimates, the stopping reason, and any remaining weaknesses or inspection limits.

Describe the result honestly as a first pass. Name specific unresolved problems when present. Deliver the strongest complete cut achieved within the authorized envelope.
