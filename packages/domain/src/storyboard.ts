/**
 * The storyboard (A66): the story's skeleton of rough hand-drawn frames, one per declared shot (A65) on its own image track (A60), so a
 * later, coherent style can live on another track over the same shots. A frame's description is the newest description take of its shot
 * (A63); its drawing is the image the storyboard track shows there. Nothing here generates anything; the editor server drafts and draws.
 */
import { Schema } from "effect";
import { ModelId, type SceneDescriptionTake, takesForShot } from "./scene-descriptions.js";
import { IsoUtc, NonNegative, Text } from "./schema.js";
import { ShotId, type StitchedEntry } from "./shots.js";

/** The image track every storyboard frame lives on. */
export const STORYBOARD_TRACK = "storyboard";
/** The writer a description take names when the person at the editor wrote it, or edited a draft before saving it (A66). */
export const USER_WRITER = "user";
/** What draws a storyboard frame: ChatGPT's image tool through the Codex CLI under the ChatGPT login, else local Qwen Image 2.1 (A66). */
export const StoryboardRenderer = Schema.Literals(["codex-chatgpt", "qwen-image-2.1"]);
export type StoryboardRenderer = typeof StoryboardRenderer.Type;

type StitchedShot = Extract<StitchedEntry, { kind: "shot" }>;
/** One storyboard frame: a declared shot on the storyboard track, the shot the track shows there, and the newest description of it. */
export type StoryboardFrame = {
  readonly anchorWordId: string;
  readonly startSample: number;
  /** Where the track's next shot starts, or the clip's end. */
  readonly endSample: number;
  /** The selected storyboard shot: its image, when it has one, is the frame's drawing. A frame declared before any drawing has none. */
  readonly shot: StitchedShot;
  /** The newest description take of the shot, by any writer, or null before one is written. */
  readonly description: SceneDescriptionTake | null;
};

/**
 * Every frame of the storyboard in timeline order: each shot the storyboard track shows that is anchored to a word. An unanchored storyboard
 * shot (one dragged off its word) is a placement, not a frame, as A65 has it; it still ends the frame before it.
 */
export function storyboardFrames(stitched: ReadonlyArray<StitchedEntry>, takes: ReadonlyArray<SceneDescriptionTake>): ReadonlyArray<StoryboardFrame> {
  return stitched.flatMap(entry => entry.kind === "shot" && entry.trackId === STORYBOARD_TRACK && entry.anchorWordId !== undefined
    ? [{ anchorWordId: entry.anchorWordId, startSample: entry.startSample, endSample: entry.endSample, shot: entry, description: takesForShot(takes, entry.anchorWordId).at(-1) ?? null }]
    : []);
}

/** The frame the cursor is in: the last frame starting at or before `sample`, with the preview's tolerance for seeks that land a hair early; null before the first. */
export function frameAt(frames: ReadonlyArray<StoryboardFrame>, sample: number, toleranceSamples: number): StoryboardFrame | null {
  let current: StoryboardFrame | null = null;
  for (const frame of frames) {
    if (frame.startSample <= sample + toleranceSamples) current = frame;
    else break;
  }
  return current;
}

/**
 * The word a new shot at the cursor would be anchored to: the word being spoken at `sample`, else the next word to start after it (a shot
 * begins where speech resumes), else the last word. `words` are sorted by start; null only when there are none.
 */
export function cursorWord<W extends { readonly startSample: number; readonly endSample: number }>(words: ReadonlyArray<W>, sample: number): W | null {
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (words[mid]!.startSample <= sample) lo = mid + 1;
    else hi = mid;
  }
  const spoken = words[lo - 1];
  if (spoken !== undefined && sample < spoken.endSample) return spoken;
  return words[lo] ?? words[words.length - 1] ?? null;
}

/** `POST .../storyboard/draft`: ask a model to propose a description for the shot that would begin at this word. Nothing is recorded. */
export const StoryboardDraftRequest = Schema.Struct({ anchorWordId: Text });
export type StoryboardDraftRequest = typeof StoryboardDraftRequest.Type;
/** The proposal, with the model that wrote it and the exact prompt it answered, so a take saved from it can say so. */
export const StoryboardDraft = Schema.Struct({ anchorWordId: Text, text: Text, model: ModelId, prompt: Text, seconds: Schema.Number });
export type StoryboardDraft = typeof StoryboardDraft.Type;
/** `POST .../storyboard/draw`: draw the frame anchored at this word from its newest description, in the background. */
export const StoryboardDrawRequest = Schema.Struct({ anchorWordId: Text });
export type StoryboardDrawRequest = typeof StoryboardDrawRequest.Type;

/** One renderer's try at a drawing: it runs until `finishedAt`, and a failed try says why. */
export const StoryboardAttempt = Schema.Struct({ renderer: StoryboardRenderer, startedAt: IsoUtc, finishedAt: Schema.optionalKey(IsoUtc), error: Schema.optionalKey(Schema.String) });
export type StoryboardAttempt = typeof StoryboardAttempt.Type;
/**
 * A drawing in the background, kept by the server for its lifetime only. It is `queued` from `requestedAt` until a renderer is free (the
 * server draws a few frames at a time, A67), then `running`: the primary renderer's try, then the fallback's if the first failed. A finished
 * job names the record it wrote; a failed one says why the last try failed. A drawing a first pass asked for names that pass.
 */
export const StoryboardJob = Schema.Struct({
  id: ShotId, anchorWordId: Text, status: Schema.Literals(["queued", "running", "done", "failed"]), requestedAt: IsoUtc, finishedAt: Schema.optionalKey(IsoUtc),
  attempts: Schema.Array(StoryboardAttempt), recordId: Schema.optionalKey(ShotId), error: Schema.optionalKey(Schema.String), firstPassId: Schema.optionalKey(ShotId),
});
export type StoryboardJob = typeof StoryboardJob.Type;
/** A job that has not ended: queued or running. */
export const jobPending = (job: Pick<StoryboardJob, "status">): boolean => job.status === "queued" || job.status === "running";
/** `GET .../storyboard/jobs`, oldest first; also the reply to `POST .../storyboard/draw`, as the one job it started. */
export const StoryboardJobsResponse = Schema.Struct({ jobs: Schema.Array(StoryboardJob) });
export type StoryboardJobsResponse = typeof StoryboardJobsResponse.Type;

/** The newest job for each frame, keyed by its anchor word: what the Storyboard section reports for a frame. */
export const latestJobs = (jobs: ReadonlyArray<StoryboardJob>): ReadonlyMap<string, StoryboardJob> => {
  const latest = new Map<string, StoryboardJob>();
  for (const job of [...jobs].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.id.localeCompare(b.id))) latest.set(job.anchorWordId, job);
  return latest;
};

/** `POST .../storyboard/first-pass/plan`: propose the shots of one beat or scene of the story map (A67). Nothing is recorded. */
export const StoryboardFirstPassPlanRequest = Schema.Struct({ sectionId: Text });
export type StoryboardFirstPassPlanRequest = typeof StoryboardFirstPassPlanRequest.Type;
/**
 * One shot of a first pass (A67) and what the pass does there, judged against the storyboard as it stands; nothing that exists is
 * overwritten. `frame` is `new` when no storyboard frame starts at the word yet, so an image-less storyboard record declares one.
 * `description` is `new` when the shot has no description take yet and the model proposed one, `kept` when it has one, and `none` when it
 * has none and the model proposed none. `drawing` is `new` when the frame has no drawing and a description to draw from, `kept` when it has
 * a drawing, `busy` when one is already queued or running, and `none` when there is nothing to draw from.
 */
export const StoryboardFirstPassShot = Schema.Struct({
  anchorWordId: Text, startSample: NonNegative,
  /** The model's description of the shot, or null for a shot already declared in the section that the model left out. */
  text: Schema.NullOr(Text),
  frame: Schema.Literals(["new", "kept"]), description: Schema.Literals(["new", "kept", "none"]), drawing: Schema.Literals(["new", "kept", "busy", "none"]),
});
export type StoryboardFirstPassShot = typeof StoryboardFirstPassShot.Type;
/** A proposed shot whose opening words were not found in the section, after the shot before it, and so is left out. */
export const StoryboardFirstPassUnmatched = Schema.Struct({ opens: Schema.String, text: Schema.String, reason: Text });
export type StoryboardFirstPassUnmatched = typeof StoryboardFirstPassUnmatched.Type;
/** The proposal: the section, the shots in narration order, what could not be placed, and the model and exact prompt that proposed them. */
export const StoryboardFirstPassPlan = Schema.Struct({
  sectionId: Text, model: ModelId, prompt: Text, seconds: Schema.Number,
  shots: Schema.Array(StoryboardFirstPassShot), unmatched: Schema.Array(StoryboardFirstPassUnmatched),
});
export type StoryboardFirstPassPlan = typeof StoryboardFirstPassPlan.Type;
/** `POST .../storyboard/first-pass`: carry out a plan, as proposed or trimmed. Each shot is judged again against the storyboard as it stands then. */
export const StoryboardFirstPassApply = Schema.Struct({
  sectionId: Text, model: ModelId, prompt: Text,
  shots: Schema.Array(Schema.Struct({ anchorWordId: Text, text: Schema.NullOr(Text) })),
});
export type StoryboardFirstPassApply = typeof StoryboardFirstPassApply.Type;
/** What a first pass did: each shot as judged when it ran, and the drawings it queued, all named by its id. */
export const StoryboardFirstPassResult = Schema.Struct({ firstPassId: ShotId, sectionId: Text, shots: Schema.Array(StoryboardFirstPassShot), jobs: Schema.Array(StoryboardJob) });
export type StoryboardFirstPassResult = typeof StoryboardFirstPassResult.Type;
