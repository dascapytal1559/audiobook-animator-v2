/**
 * The storyboard over an opened story (A66, A67): drawing one frame in its turn, and a section's first pass, which proposes the section's
 * shots, declares them, records their descriptions, and queues their drawings. The editor's routes and the `storyboard` verbs share these.
 */
import { Effect, FileSystem } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { declaredShots, type SceneDescriptionTake, STORYBOARD_TRACK, type StoryboardFirstPassApply, type StoryboardFirstPassPlan, type StoryboardFirstPassResult, type StoryboardFirstPassShot,
  type StoryboardFrame, type StoryboardJob, storyboardFrames, subtitleSentences, subtitleText, takesForShot } from "@animator/domain";
import { AnimatorError } from "../../core/error.js";
import { addSceneDescriptionTake, loadSceneDescriptions } from "../scene-descriptions/index.js";
import { loadStoryMap } from "../story-map/index.js";
import { codexPlan, drawFrame, excerpt, placeShots, planPrompt, sketchPrompt, storyboardError, type StoryboardJobBook, type StoryboardSettings } from "../storyboard/index.js";
import { addShot, loadVisualTimeline, mintUlid } from "../visual-timeline/index.js";
import type { EditorContext } from "./routes.js";
import { loadTiming } from "./timing.js";

const fail = (message: string) => Effect.fail(storyboardError({ code: "InvalidRequest", message }));
type Producer = { readonly name: string; readonly version: string };
/** What drawing and a first pass need beyond the story: the storyboard settings, who is writing, and the book the drawings are queued in. */
export type StoryboardRun = { readonly settings: StoryboardSettings; readonly producer: Producer; readonly jobs: StoryboardJobBook };

/** The storyboard as it stands on disk: effective word starts, the merged timeline, every description take, and the frames. */
export const storyboardNow = (ctx: EditorContext) => Effect.gen(function* () {
  const { wordStarts } = yield* loadTiming(ctx);
  const { stitched } = yield* loadVisualTimeline({ story: ctx.story, settings: ctx.settings.timeline, wordStarts });
  const takes = yield* loadSceneDescriptions({ story: ctx.story, maxBytes: ctx.settings.editor.limits.maxSceneDescriptionsBytes });
  return { wordStarts, stitched, takes, frames: storyboardFrames(stitched, takes) };
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
  return run.jobs.queue(ctx.clip.storyId, anchorWordId, report => Effect.gen(function* () {
    const { frames } = yield* storyboardNow(ctx);
    const { frame, description } = yield* drawableFrame(frames, anchorWordId);
    const sketch = sketchPrompt({ title: ctx.story.story.title, description: description.text, excerpt: excerpt(ctx.elements, anchorWordId, 0, run.settings.excerpt.drawWords, false) });
    const startSample = Effect.map(loadTiming(ctx), ({ wordStarts }) => wordStarts.get(anchorWordId) ?? frame.startSample);
    return yield* drawFrame({ settings: run.settings, story: ctx.story, timeline: ctx.settings.timeline, producer: run.producer, anchorWordId, sketch, startSample, report });
  }), firstPassId);
}

/** Check that a drawing can start now (A66): the frame exists with a description, and is not already being drawn. */
export function checkDrawable(ctx: EditorContext, jobs: StoryboardJobBook, anchorWordId: string) {
  return Effect.gen(function* () {
    yield* drawableFrame((yield* storyboardNow(ctx)).frames, anchorWordId);
    if (jobs.pending(ctx.clip.storyId, anchorWordId)) return yield* Effect.fail(storyboardError({ code: "JobRunning", message: `The storyboard frame at ${anchorWordId} is already being drawn.` }));
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
    const before = excerpt(ctx.elements, section.startWordId, run.settings.excerpt.planWordsBefore, 0, false);
    const prompt = planPrompt({ title: ctx.story.story.title, section, before: before === "" ? null : before, sentences,
      kept: existing.map(shot => excerpt(ctx.elements, shot.anchorWordId, 0, OPENING_WORDS, false) ?? shot.anchorWordId) });
    const answer = yield* codexPlan(run.settings, prompt);
    const { placed, unmatched } = placeShots(ctx.words, from, to, answer.shots);
    const shots = [...placed, ...existing.filter(e => !placed.some(p => p.anchorWordId === e.anchorWordId)).map(e => ({ ...e, text: null }))].sort((a, b) => a.index - b.index);
    return {
      sectionId, model: answer.model, prompt, seconds: answer.seconds, unmatched,
      shots: shots.map(shot => judgeShot(shot, now.wordStarts.get(shot.anchorWordId) ?? 0, now.frames, now.takes, run.jobs.pending(ctx.clip.storyId, shot.anchorWordId))),
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
      .map(shot => judgeShot(shot, before.wordStarts.get(shot.anchorWordId) ?? 0, before.frames, before.takes, run.jobs.pending(storyId, shot.anchorWordId)));
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
