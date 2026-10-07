/**
 * The storyboard (A66): the story's skeleton of rough hand-drawn frames, one per declared shot (A65) on its own image track (A60), so a
 * later, coherent style can live on another track over the same shots. A frame's description is the newest description take of its shot
 * (A63); its drawing is the image the storyboard track shows there. Nothing here generates anything; the editor server drafts and draws.
 */
import { Schema } from "effect";
import { ClipIdentity, Producer } from "./identity.js";
import { ModelId, SceneDescriptionTake, takesForShot } from "./scene-descriptions.js";
import { IsoUtc, NonNegative, Text } from "./schema.js";
import { ImagePath, ServedShotRecord, ShotId, type StitchedEntry } from "./shots.js";

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

/**
 * `POST .../storyboard/draft`: ask a model to propose a description for the shot that begins at `anchorWordId`. In the drafting space
 * (A68) the request also names the last word the shot covers, the shot's current description to revise, and what the person asked for.
 * Nothing is recorded.
 */
export const StoryboardDraftRequest = Schema.Struct({ anchorWordId: Text, endWordId: Schema.optionalKey(Text), current: Schema.optionalKey(Text), request: Schema.optionalKey(Text) });
export type StoryboardDraftRequest = typeof StoryboardDraftRequest.Type;
/** The proposal, with the model that wrote it and the exact prompt it answered, so a take saved from it can say so. */
export const StoryboardDraft = Schema.Struct({ anchorWordId: Text, text: Text, model: ModelId, prompt: Text, seconds: Schema.Number });
export type StoryboardDraft = typeof StoryboardDraft.Type;
/**
 * `POST .../storyboard/draw`: draw a draft drawing in the background (A68) from a drafted description, for the shot drafted at
 * `anchorWordId` (a frame's word, or the word a new shot is drafted at); the narration excerpt starts at `startWordId`. The drawing lands
 * as the shot's draft drawing, never on the storyboard, until it is saved.
 */
export const StoryboardDrawRequest = Schema.Struct({ anchorWordId: Text, startWordId: Text, text: Text });
export type StoryboardDrawRequest = typeof StoryboardDrawRequest.Type;

/** One renderer's try at a drawing: it runs until `finishedAt`, and a failed try says why. */
export const StoryboardAttempt = Schema.Struct({ renderer: StoryboardRenderer, startedAt: IsoUtc, finishedAt: Schema.optionalKey(IsoUtc), error: Schema.optionalKey(Schema.String) });
export type StoryboardAttempt = typeof StoryboardAttempt.Type;
/**
 * A drawing in the background, kept by the server for its lifetime only. It is `queued` from `requestedAt` until a renderer is free (the
 * server draws a few frames at a time, A67), then `running`: the primary renderer's try, then the fallback's if the first failed. A `frame`
 * drawing publishes a storyboard record and names it when done; a `draft` drawing (A68) writes the shot's draft drawing and names that. A
 * failed job says why the last try failed. A drawing a first pass asked for names that pass.
 */
export const StoryboardJob = Schema.Struct({
  id: ShotId, kind: Schema.Literals(["frame", "draft"]), anchorWordId: Text, status: Schema.Literals(["queued", "running", "done", "failed"]), requestedAt: IsoUtc, finishedAt: Schema.optionalKey(IsoUtc),
  attempts: Schema.Array(StoryboardAttempt), recordId: Schema.optionalKey(ShotId), draftId: Schema.optionalKey(ShotId), error: Schema.optionalKey(Schema.String), firstPassId: Schema.optionalKey(ShotId),
});
export type StoryboardJob = typeof StoryboardJob.Type;
/** A job that has not ended: queued or running. */
export const jobPending = (job: Pick<StoryboardJob, "status">): boolean => job.status === "queued" || job.status === "running";
/** `GET .../storyboard/jobs`, oldest first; also the reply to `POST .../storyboard/draw`, as the one job it started. */
export const StoryboardJobsResponse = Schema.Struct({ jobs: Schema.Array(StoryboardJob) });
export type StoryboardJobsResponse = typeof StoryboardJobsResponse.Type;

/** The newest job of one kind for each shot, keyed by its anchor word: what the Storyboard section reports for a frame or for its draft. */
export const latestJobs = (jobs: ReadonlyArray<StoryboardJob>, kind: StoryboardJob["kind"]): ReadonlyMap<string, StoryboardJob> => {
  const latest = new Map<string, StoryboardJob>();
  for (const job of [...jobs].filter(j => j.kind === kind).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.id.localeCompare(b.id))) latest.set(job.anchorWordId, job);
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

/**
 * A draft drawing (A68): a drawing made in the drafting space and not yet saved, at `<story>/storyboard-drafts/<id>/draft.json` with its
 * image beside it. It belongs to the shot drafted at `anchorWordId` and is never shown as the shot's drawing; saving copies its image into
 * a new storyboard record, and saving or discarding removes it. A shot has at most one: a newer drawing replaces the one before.
 */
export const StoryboardDraftDrawing = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("storyboard-draft-drawing"), clip: ClipIdentity, id: ShotId, anchorWordId: Text,
  /** The description it was drawn from, and the word the narration excerpt began at. */
  description: Text, startWordId: Text,
  renderer: StoryboardRenderer, prompt: Text, notes: Text, imagePath: ImagePath, createdAt: IsoUtc, producer: Producer,
});
export type StoryboardDraftDrawing = typeof StoryboardDraftDrawing.Type;
/** A draft drawing as the editor server serves it, with the URL of its image. */
export const ServedStoryboardDraftDrawing = Schema.Struct({ ...StoryboardDraftDrawing.fields, imageUrl: Text });
export type ServedStoryboardDraftDrawing = typeof ServedStoryboardDraftDrawing.Type;
/** `GET .../storyboard/drafts`: every draft drawing of the story, oldest first. */
export const StoryboardDraftsResponse = Schema.Struct({ drafts: Schema.Array(ServedStoryboardDraftDrawing) });
export type StoryboardDraftsResponse = typeof StoryboardDraftsResponse.Type;
/** `POST .../storyboard/drafts/discard`: drop the draft drawing of the shot drafted at this word. */
export const StoryboardDiscardRequest = Schema.Struct({ anchorWordId: Text });
export type StoryboardDiscardRequest = typeof StoryboardDiscardRequest.Type;

/**
 * Where a drafted shot may start and end (A68), as indexes into `words` sorted by start: from the first word after the storyboard shot
 * before it to the last word before the storyboard shot after it. `at` is the shot's start sample (a frame's, or a new shot's word) and
 * `trackStarts` the start samples of every shot the storyboard track shows. A shot may give words to its neighbours or take words from
 * them, but may not start at or before the shot before it, nor reach the shot after it: either would swallow that shot. `last` is also
 * where the shot ends when its end is left alone. Null when there are no words.
 */
export function spanBounds(words: ReadonlyArray<{ readonly startSample: number }>, trackStarts: ReadonlyArray<number>, at: number): { readonly first: number; readonly last: number } | null {
  if (words.length === 0) return null;
  const before = trackStarts.reduce<number | null>((best, s) => (s < at && (best === null || s > best) ? s : best), null);
  const after = trackStarts.reduce<number | null>((best, s) => (s > at && (best === null || s < best) ? s : best), null);
  const firstAfter = before === null ? 0 : words.findIndex(w => w.startSample > before);
  const lastBefore = after === null ? words.length - 1 : words.findLastIndex(w => w.startSample < after);
  return { first: firstAfter < 0 ? words.length : firstAfter, last: lastBefore };
}

export type SpanJudgement = { readonly ok: true; readonly moved: boolean; readonly splitAt: number | null } | { readonly ok: false; readonly reason: string };
/**
 * What saving a drafted span does (A68), as indexes into the words sorted by start. `start` and `end` are the drafted first and last words,
 * `current` the frame's own first word (null for a new shot). The span is refused when it starts before `bounds.first` or ends after
 * `bounds.last`, which would swallow a neighbouring shot, or ends before it starts. Otherwise `moved` says the shot begins at another word
 * than it does now (always, for a new shot), and `splitAt` is the word that begins a new, empty frame when the end is drawn in before
 * `bounds.last`, so the words after the shot's end are not silently handed to it.
 */
export function judgeSpan(bounds: { readonly first: number; readonly last: number }, current: number | null, start: number, end: number): SpanJudgement {
  if (end < start) return { ok: false, reason: "The shot would end before it starts." };
  if (start < bounds.first) return { ok: false, reason: "The shot would start at or before the shot before it and swallow it; start it later." };
  if (end > bounds.last) return { ok: false, reason: "The shot would run into the shot after it and swallow it; end it sooner, or move that shot's start." };
  return { ok: true, moved: current === null || start !== current, splitAt: end < bounds.last ? end + 1 : null };
}

/**
 * `POST .../storyboard/snapshot` (A68): save the drafting space as one snapshot of the shot. `frameWordId` is the frame being drafted, or
 * null for a new shot; `startWordId` and `endWordId` the narration it covers. `description` is a new description take, or null to keep the
 * current one; `draftId` the draft drawing to save, or null to keep the current drawing.
 */
export const StoryboardSnapshotRequest = Schema.Struct({
  frameWordId: Schema.NullOr(Text), startWordId: Text, endWordId: Text,
  description: Schema.NullOr(Schema.Struct({ model: ModelId, text: Text, prompt: Schema.optionalKey(Text), notes: Schema.optionalKey(Text) })),
  draftId: Schema.NullOr(ShotId),
});
export type StoryboardSnapshotRequest = typeof StoryboardSnapshotRequest.Type;
/**
 * What a snapshot wrote: the new storyboard record at the start word (when the drawing changed or the shot is new or moved), the new
 * description take there, the empty frame declared after a drawn-in end, and the shots of the old frame that the editor hides because the
 * shot moved off its word. The server writes no decisions; the editor owns them.
 */
export const StoryboardSnapshotResult = Schema.Struct({
  record: Schema.NullOr(ServedShotRecord), take: Schema.NullOr(SceneDescriptionTake), split: Schema.NullOr(ServedShotRecord), retire: Schema.Array(ShotId),
});
export type StoryboardSnapshotResult = typeof StoryboardSnapshotResult.Type;
