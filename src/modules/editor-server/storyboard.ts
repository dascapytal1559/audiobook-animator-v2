/**
 * The storyboard over an opened story (A66, A67, A68): drawing one frame in its turn, a section's first pass, which proposes the section's
 * shots, declares them, records their descriptions, and queues their drawings, and the drafting space's draft drawings and snapshots. The
 * editor's routes and the `storyboard` verbs share these.
 */
import { join } from "node:path";
import { Effect, FileSystem } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { declaredShots, judgeSpan, type SceneDescriptionTake, spanBounds, STORYBOARD_TRACK, type StoryboardDrawRequest, type StoryboardFirstPassApply, type StoryboardFirstPassPlan, type StoryboardFirstPassResult, type StoryboardFirstPassShot,
  type StoryboardFrame, type StoryboardJob, type StoryboardSnapshotRequest, storyboardFrames, subtitleSentences, subtitleText, takesForShot } from "@animator/domain";
import { AnimatorError } from "../../core/error.js";
import { addSceneDescriptionTake, isDescriptionsError, loadSceneDescriptions } from "../scene-descriptions/index.js";
import { loadStoryMap } from "../story-map/index.js";
import { codexPlan, type DraftTarget, draftImagePath, drawDraft, drawFrame, excerpt, placeShots, planPrompt, readDraftDrawing, removeDraftDrawings, sketchPrompt, storyboardError, type StoryboardJobBook, type StoryboardSettings } from "../storyboard/index.js";
import { addShot, loadVisualTimeline, mintUlid, type ShotRecord } from "../visual-timeline/index.js";
import type { EditorContext } from "./routes.js";
import { loadTiming } from "./timing.js";

const fail = (message: string) => Effect.fail(storyboardError({ code: "InvalidRequest", message }));
type Producer = { readonly name: string; readonly version: string };
/** What drawing and a first pass need beyond the story: the storyboard settings, who is writing, and the book the drawings are queued in. */
export type StoryboardRun = { readonly settings: StoryboardSettings; readonly producer: Producer; readonly jobs: StoryboardJobBook };

/** The storyboard as it stands on disk: effective word starts, the merged timeline, every description take, and the frames. */
export const storyboardNow = (ctx: EditorContext) => Effect.gen(function* () {
  const { wordStarts } = yield* loadTiming(ctx);
  const { stitched, candidates } = yield* loadVisualTimeline({ story: ctx.story, settings: ctx.settings.timeline, wordStarts });
  const takes = yield* loadSceneDescriptions({ story: ctx.story, maxBytes: ctx.settings.editor.limits.maxSceneDescriptionsBytes });
  return { wordStarts, stitched, candidates, takes, frames: storyboardFrames(stitched, takes) };
});

/** The frame at a word that can be drawn: one exists there and has a description. Fails naming which is missing. */
const drawableFrame = (frames: ReadonlyArray<StoryboardFrame>, anchorWordId: string) => {
  const frame = frames.find(f => f.anchorWordId === anchorWordId);
  if (frame === undefined) return fail(`No storyboard frame starts at ${anchorWordId}: describe a shot there first.`);
  if (frame.description === null) return fail(`The storyboard frame at ${anchorWordId} has no description to draw from.`);
  return Effect.succeed({ frame, description: frame.description });
};

/**
 * Queue a drawing of the frame at a word (A66). The frame and its newest description are read when the drawing's turn comes, not when it
 * is asked for, so a description edited while it waits is the one drawn; the record lands at the word's effective start when it is done.
 * The caller has checked that the frame can be drawn and that no drawing of it is pending, and forks `run` or waits for it.
 */
export function queueDraw(ctx: EditorContext, run: StoryboardRun, anchorWordId: string, firstPassId?: string) {
  return run.jobs.queue(ctx.clip.storyId, "frame", anchorWordId, report => Effect.gen(function* () {
    const { frames } = yield* storyboardNow(ctx);
    const { frame, description } = yield* drawableFrame(frames, anchorWordId);
    const sketch = sketchPrompt({ title: ctx.story.story.title, description: description.text, excerpt: excerpt(ctx.elements, anchorWordId, 0, run.settings.excerpt.drawWords, null) });
    const startSample = Effect.map(loadTiming(ctx), ({ wordStarts }) => wordStarts.get(anchorWordId) ?? frame.startSample);
    return yield* drawFrame({ settings: run.settings, story: ctx.story, timeline: ctx.settings.timeline, producer: run.producer, anchorWordId, sketch, startSample, report });
  }), firstPassId);
}

/** Where a story's draft drawings live, and the image limit a copied drawing must keep within. */
export const draftTarget = (ctx: EditorContext): DraftTarget => ({ storyDirectory: ctx.storyDirectory, clip: ctx.clip, maxImageBytes: ctx.settings.timeline.limits.maxImageBytes });
const isWord = (ctx: EditorContext, id: string) => ctx.words.some(w => w.id === id);

/**
 * Queue a draft drawing (A68) of the shot drafted at a word, from the drafted description in the request rather than a saved one, with the
 * narration from the drafted start word as context. The drawing becomes the shot's draft drawing and is never published on its own. A
 * second draft drawing of the same shot while one is pending is refused. The caller forks `run`.
 */
export function queueDraftDrawing(ctx: EditorContext, run: StoryboardRun, body: StoryboardDrawRequest) {
  return Effect.gen(function* () {
    for (const id of [body.anchorWordId, body.startWordId]) if (!isWord(ctx, id)) return yield* fail(`${id} is not a word of the transcript.`);
    if (run.jobs.pending(ctx.clip.storyId, body.anchorWordId, "draft")) return yield* Effect.fail(storyboardError({ code: "JobRunning", message: `A draft drawing of the shot at ${body.anchorWordId} is already being drawn.` }));
    return run.jobs.queue(ctx.clip.storyId, "draft", body.anchorWordId, report => {
      const sketch = sketchPrompt({ title: ctx.story.story.title, description: body.text, excerpt: excerpt(ctx.elements, body.startWordId, 0, run.settings.excerpt.drawWords, null) });
      return drawDraft({ settings: run.settings, target: draftTarget(ctx), producer: run.producer, anchorWordId: body.anchorWordId, startWordId: body.startWordId, description: body.text, sketch, report });
    });
  });
}

/** The transcript's words at their effective starts, sorted by start and then by transcript order: the order spans are counted in (A68). */
const wordsByStart = (ctx: EditorContext, wordStarts: ReadonlyMap<string, number>) =>
  ctx.words.map((w, i) => ({ id: w.id, startSample: wordStarts.get(w.id) ?? w.startSample, i })).sort((a, b) => a.startSample - b.startSample || a.i - b.i);

/**
 * Save the drafting space as one snapshot of a shot (A68), judged against the storyboard as it stands. Nothing is overwritten:
 * - A new storyboard record at the start word, when the drawing changed or the shot is new or moved. It carries the draft drawing's image,
 *   or a copy of the frame's current drawing when only the span moved, or no image at all; the draft drawing is then removed.
 * - A description take at the start word: the drafted one, or, when the shot moved, the frame's current description carried over, since
 *   takes belong to a word (A65). A repeat of a take the word already has is no take.
 * - When the end is drawn in, an empty frame (an image-less storyboard record) at the word after the end, so those words keep a shot of
 *   their own instead of going to this one; when that word is the frame's own old start, the old frame is kept as that shot instead.
 * - When the shot moved off its word, the shots of its old frame are named in `retire` for the editor to hide; the server writes no
 *   decisions, since the editor owns `decisions.json` (A66).
 * A span that would swallow a neighbouring shot is refused, as is moving a frame while a drawing of it is queued or running, or a save
 * that changes nothing. The caller holds the story's take lock.
 */
export function saveSnapshot(ctx: EditorContext, run: StoryboardRun, body: StoryboardSnapshotRequest) {
  return Effect.gen(function* () {
    const now = yield* storyboardNow(ctx);
    const words = wordsByStart(ctx, now.wordStarts);
    const index = new Map(words.map((w, i) => [w.id, i] as const));
    const start = index.get(body.startWordId);
    const end = index.get(body.endWordId);
    if (start === undefined || end === undefined) return yield* fail(`${start === undefined ? body.startWordId : body.endWordId} is not a word of the transcript.`);
    const frame = body.frameWordId === null ? null : now.frames.find(f => f.anchorWordId === body.frameWordId);
    if (frame === undefined) return yield* fail(`No storyboard frame starts at ${body.frameWordId}; it may have moved since it was drafted.`);
    if (frame === null && now.frames.some(f => f.anchorWordId === body.startWordId)) return yield* fail(`A storyboard frame already starts at ${body.startWordId}; draft that frame instead of a new shot.`);
    const trackStarts = now.stitched.flatMap(e => (e.kind === "shot" && e.trackId === STORYBOARD_TRACK ? [e.startSample] : []));
    const bounds = spanBounds(words, trackStarts, frame?.startSample ?? words[start]!.startSample)!;
    const judged = judgeSpan(bounds, frame === null ? null : index.get(frame.anchorWordId) ?? null, start, end);
    if (!judged.ok) return yield* fail(judged.reason);
    const storyId = ctx.clip.storyId;
    if (judged.moved && frame !== null && run.jobs.pending(storyId, frame.anchorWordId, "frame")) return yield* Effect.fail(storyboardError({ code: "JobRunning", message: `The storyboard frame at ${frame.anchorWordId} is being drawn; wait for it before moving the shot.` }));
    const draft = body.draftId === null ? null : yield* readDraftDrawing(draftTarget(ctx), body.draftId);
    if (!judged.moved && draft === null && body.description === null && judged.splitAt === null) return yield* fail("Nothing to save: the draft is the same as the shot.");
    const startWord = words[start]!;
    const timeline = { story: ctx.story, settings: ctx.settings.timeline, producer: run.producer, mode: "graphic-illustration" as const, trackId: STORYBOARD_TRACK, label: "Storyboard frame" };
    const moved = frame !== null && judged.moved ? ` Moved from ${frame.anchorWordId} to ${body.startWordId}.` : "";

    let record: ShotRecord | null = null;
    if (judged.moved || draft !== null) {
      const shown = frame?.shot.imagePath !== undefined ? frame.shot : null;
      const source = draft !== null
        ? { imageSourcePath: draftImagePath(ctx.storyDirectory, draft), renderer: draft.renderer, prompt: draft.prompt, notes: `Saved from the drafting space (A68).${moved} ${draft.notes}` }
        : shown !== null
          ? { imageSourcePath: join(ctx.storyDirectory, "shots", shown.id, shown.imagePath!), ...(shown.renderer !== undefined ? { renderer: shown.renderer } : {}), ...(shown.prompt !== undefined ? { prompt: shown.prompt } : {}),
            notes: `Saved from the drafting space (A68).${moved} The drawing is a copy of record ${shown.id}'s.` }
          : { notes: `Saved from the drafting space (A68).${moved || " Declared the shot."} No drawing yet.` };
      record = yield* addShot({ ...timeline, ...source, startSample: startWord.startSample, anchorWordId: body.startWordId });
    }

    const carried = frame !== null && judged.moved && frame.description !== null
      ? { model: frame.description.model, text: frame.description.text, ...(frame.description.prompt !== undefined ? { prompt: frame.description.prompt } : {}), notes: `Carried from ${frame.anchorWordId} when the shot's start moved to ${body.startWordId} (A68).` }
      : null;
    const description = body.description ?? carried;
    let take: SceneDescriptionTake | null = null;
    if (description !== null) {
      take = yield* addSceneDescriptionTake({ story: ctx.story, maxBytes: ctx.settings.editor.limits.maxSceneDescriptionsBytes, shots: declaredShots((yield* storyboardNow(ctx)).stitched), producer: run.producer,
        take: { anchorWordId: body.startWordId, ...description } }).pipe(Effect.catchIf(e => isDescriptionsError(e) && e.code === "TakeExists", () => Effect.succeed(null)));
    }

    const splitWord = judged.splitAt === null ? null : words[judged.splitAt]!;
    const keepsOld = frame !== null && judged.moved && splitWord?.id === frame.anchorWordId;
    const split = splitWord === null || keepsOld ? null : yield* addShot({ ...timeline, startSample: splitWord.startSample, anchorWordId: splitWord.id,
      notes: `Declared by a drafting-space snapshot (A68) of the shot at ${body.startWordId}, whose end was drawn in to ${body.endWordId}.` });
    const retire = frame === null || !judged.moved || keepsOld ? [] : now.candidates
      .filter(group => group.trackId === STORYBOARD_TRACK && group.startSample === frame.startSample)
      .flatMap(group => group.shots.filter(shot => shot.anchorWordId === frame.anchorWordId && !shot.hidden).map(shot => shot.id));
    if (draft !== null) yield* removeDraftDrawings(draftTarget(ctx), draft.anchorWordId);
    return { record, take, split, retire };
  });
}

/** A section a first pass may plan: a beat or a scene of the story map, the smallest units it names, with its word indexes in the transcript. */
const firstPassSection = (ctx: EditorContext, sectionId: string) => Effect.gen(function* () {
  const { map } = yield* loadStoryMap({ story: ctx.story, wordIds: ctx.words.map(w => w.id), maxBytes: ctx.settings.editor.limits.maxStoryMapBytes });
  const section = map.sections.find(s => s.id === sectionId);
  if (section === undefined) return yield* fail(`The story map has no section ${sectionId}.`);
  if (section.kind !== "beat" && section.kind !== "scene") return yield* fail(`Section ${sectionId} is ${section.kind === "act" ? "an act" : `a ${section.kind}`}; a first pass plans one beat or scene.`);
  const from = ctx.words.findIndex(w => w.id === section.startWordId);
  const to = ctx.words.findIndex(w => w.id === section.endWordId);
  return { section, from, to };
});

/**
 * One shot judged against the storyboard as it stands (A67): a frame, description, or drawing that exists is kept, never replaced, and a
 * frame with no description gets nothing to draw from.
 */
export function judgeShot(shot: { readonly anchorWordId: string; readonly text: string | null }, startSample: number, frames: ReadonlyArray<StoryboardFrame>, takes: ReadonlyArray<SceneDescriptionTake>, pending: boolean): StoryboardFirstPassShot {
  const frame = frames.find(f => f.anchorWordId === shot.anchorWordId);
  const description = takesForShot(takes, shot.anchorWordId).length > 0 ? "kept" : shot.text !== null ? "new" : "none";
  const drawing = frame?.shot.imagePath !== undefined ? "kept" : pending ? "busy" : description === "none" ? "none" : "new";
  return { anchorWordId: shot.anchorWordId, startSample, text: shot.text, frame: frame === undefined ? "new" : "kept", description, drawing };
}

/** The first `count` words from a word on, as written, for quoting a shot to the model. */
const OPENING_WORDS = 6;

/**
 * Propose the shots of one beat or scene (A67): one Codex text turn reads the section sentence by sentence, with the narration just before
 * it as context, and answers each shot's opening words and description; each is placed on the word its quote begins at. Shots already
 * declared in the section are named to the model to keep, and stay in the plan with no new text if it leaves them out. Nothing is written.
 */
export function planFirstPass(ctx: EditorContext, run: StoryboardRun, sectionId: string): Effect.Effect<StoryboardFirstPassPlan, AnimatorError, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function* () {
    const { section, from, to } = yield* firstPassSection(ctx, sectionId);
    const now = yield* storyboardNow(ctx);
    const index = new Map(ctx.words.map((w, i) => [w.id, i] as const));
    const existing = declaredShots(now.stitched).flatMap(shot => { const at = index.get(shot.anchorWordId); return at !== undefined && from <= at && at <= to ? [{ anchorWordId: shot.anchorWordId, index: at }] : []; });
    const first = ctx.elements.findIndex(e => e.kind === "word" && e.id === section.startWordId);
    let last = ctx.elements.findIndex(e => e.kind === "word" && e.id === section.endWordId);
    while (ctx.elements[last + 1]?.kind === "punctuation") last++;
    const sentences = subtitleSentences(ctx.elements.slice(first, last + 1), ctx.words).map(s => subtitleText(s.tokens));
    const before = excerpt(ctx.elements, section.startWordId, run.settings.excerpt.planWordsBefore, 0, null);
    const prompt = planPrompt({ title: ctx.story.story.title, section, before: before === "" ? null : before, sentences,
      kept: existing.map(shot => excerpt(ctx.elements, shot.anchorWordId, 0, OPENING_WORDS, null) ?? shot.anchorWordId) });
    const answer = yield* codexPlan(run.settings, prompt);
    const { placed, unmatched } = placeShots(ctx.words, from, to, answer.shots);
    const shots = [...placed, ...existing.filter(e => !placed.some(p => p.anchorWordId === e.anchorWordId)).map(e => ({ ...e, text: null }))].sort((a, b) => a.index - b.index);
    return {
      sectionId, model: answer.model, prompt, seconds: answer.seconds, unmatched,
      shots: shots.map(shot => judgeShot(shot, now.wordStarts.get(shot.anchorWordId) ?? 0, now.frames, now.takes, run.jobs.pending(ctx.clip.storyId, shot.anchorWordId, "frame"))),
    };
  });
}

/**
 * Carry out a first pass (A67), judging each shot again against the storyboard as it stands: declare each new frame with an image-less
 * storyboard record at its word, record each new description as the planning model's take with the prompt it answered, then queue a
 * drawing of every frame that has a description and no drawing. Nothing that exists is overwritten. The caller holds the story's take lock,
 * and forks the returned runs or waits for them; they draw `concurrentDraws` at a time.
 */
export function applyFirstPass(ctx: EditorContext, run: StoryboardRun, body: StoryboardFirstPassApply) {
  return Effect.gen(function* () {
    const { section, from, to } = yield* firstPassSection(ctx, body.sectionId);
    const index = new Map(ctx.words.map((w, i) => [w.id, i] as const));
    const seen = new Set<string>();
    for (const shot of body.shots) {
      const at = index.get(shot.anchorWordId);
      if (at === undefined || at < from || at > to) return yield* fail(`Shot ${shot.anchorWordId} does not begin inside section ${section.id}.`);
      if (seen.has(shot.anchorWordId)) return yield* fail(`Shot ${shot.anchorWordId} appears twice in the first pass.`);
      seen.add(shot.anchorWordId);
    }
    const storyId = ctx.clip.storyId;
    const firstPassId = mintUlid();
    const before = yield* storyboardNow(ctx);
    const shots = [...body.shots].sort((a, b) => index.get(a.anchorWordId)! - index.get(b.anchorWordId)!)
      .map(shot => judgeShot(shot, before.wordStarts.get(shot.anchorWordId) ?? 0, before.frames, before.takes, run.jobs.pending(storyId, shot.anchorWordId, "frame")));
    const note = `First pass ${firstPassId} of ${section.kind} ${section.id} ("${section.title}")`;
    for (const shot of shots.filter(s => s.frame === "new")) {
      yield* addShot({ story: ctx.story, settings: ctx.settings.timeline, producer: run.producer, mode: "graphic-illustration", trackId: STORYBOARD_TRACK,
        startSample: shot.startSample, anchorWordId: shot.anchorWordId, label: "Storyboard frame", notes: `${note}: declared the frame.` });
    }
    const declared = declaredShots((yield* storyboardNow(ctx)).stitched);
    for (const [i, shot] of shots.entries()) {
      if (shot.description !== "new" || shot.text === null) continue;
      yield* addSceneDescriptionTake({ story: ctx.story, maxBytes: ctx.settings.editor.limits.maxSceneDescriptionsBytes, shots: declared, producer: run.producer,
        take: { anchorWordId: shot.anchorWordId, model: body.model, text: shot.text, prompt: body.prompt, notes: `${note}: shot ${i + 1} of ${shots.length}.` } });
    }
    const queued = shots.filter(s => s.drawing === "new").map(shot => queueDraw(ctx, run, shot.anchorWordId, firstPassId));
    const jobs: ReadonlyArray<StoryboardJob> = queued.map(q => q.job);
    return { result: { firstPassId, sectionId: section.id, shots, jobs } satisfies StoryboardFirstPassResult, runs: queued.map(q => q.run) };
  });
}
