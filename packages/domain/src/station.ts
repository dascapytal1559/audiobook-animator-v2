/**
 * The shot station (A69): the Storyboard section's loop for making one shot by voice. The director listens to the narration a shot covers
 * and describes the picture they imagine; a model answers several *directions*, each a short description, an image prompt, and motion,
 * and each is drawn. The director picks one, mixes several, edits one by a spoken change, or chooses its motion, and every step is a new
 * *version* that keeps its inputs, its parent, its directions, and their images. Nothing is overwritten, so an earlier version reopens as
 * it was. A version with one drawn direction can be saved as the shot's storyboard frame (A66, A68).
 */
import { Schema } from "effect";
import { ClipIdentity, Producer } from "./identity.js";
import { ModelId } from "./scene-descriptions.js";
import { IsoUtc, NonNegative, Positive, Text } from "./schema.js";
import { ImagePath, ShotId } from "./shots.js";
import { StoryboardJob, StoryboardRenderer } from "./storyboard.js";

/** Where a version's direction came from unchanged, text and image, as a version id and a direction index. */
export const StationOrigin = Schema.Struct({ versionId: ShotId, direction: NonNegative });
export type StationOrigin = typeof StationOrigin.Type;

/**
 * One direction for a shot: a few words naming the idea, a short description of what the camera sees, the image prompt it is drawn from,
 * the motion chosen for it (null for none: a still frame), and a few motion options a model suggested to choose from. `carried` names the
 * version and direction it was carried from unchanged, when a pick or a motion choice copied it, so its image is that one's.
 */
export const StationDirection = Schema.Struct({
  title: Text, description: Text, prompt: Text, motion: Schema.NullOr(Text), motionOptions: Schema.Array(Text), carried: Schema.optionalKey(StationOrigin),
});
export type StationDirection = typeof StationDirection.Type;

/**
 * What made a version, and so how it reads in the history:
 * - `describe`: the director's description, as typed or dictated, and how many directions were asked for;
 * - `pick`: one direction of the parent chosen as it is;
 * - `mix`: several directions of the parent combined as the director's instruction says;
 * - `edit`: one direction of the parent changed by the director's instruction, such as "make the sky red";
 * - `motion`: the motion chosen for the parent's one direction, null for none.
 */
export const StationAction = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("describe"), director: Text, count: Positive }),
  Schema.Struct({ kind: Schema.Literal("pick"), direction: NonNegative }),
  Schema.Struct({ kind: Schema.Literal("mix"), directions: Schema.Array(NonNegative), instruction: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("edit"), direction: NonNegative, instruction: Text }),
  Schema.Struct({ kind: Schema.Literal("motion"), motion: Schema.NullOr(Text) }),
]);
export type StationAction = typeof StationAction.Type;

/** The model turn that wrote a version's directions: the model, the exact prompt it answered, and how long it took. */
export const StationWriter = Schema.Struct({ model: ModelId, prompt: Text, seconds: Schema.Number });
export type StationWriter = typeof StationWriter.Type;

/**
 * One version, immutable once written, at `<story>/shot-station/versions/<id>/version.json`. `shotWordId` is the shot it was made for:
 * a storyboard frame's word, or the word a new shot was begun at. `span` is the narration it was made for, from its first word through
 * its last. `writer` is null when no model wrote anything (a pick, a motion choice). Its directions' images are image records of their own.
 */
export const StationVersion = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("shot-station-version"), clip: ClipIdentity, id: ShotId,
  shotWordId: Text, span: Schema.Struct({ startWordId: Text, endWordId: Text }), parentId: Schema.NullOr(ShotId),
  action: StationAction, writer: Schema.NullOr(StationWriter), directions: Schema.Array(StationDirection),
  createdAt: IsoUtc, producer: Producer,
});
export type StationVersion = typeof StationVersion.Type;

/**
 * One try at drawing a version's direction with the storyboard's renderers (A66), immutable once written, at `<story>/shot-station/images/<id>/image.json`, with the image
 * beside it when the try drew one; a try that failed says why instead, so a failure stays visible after a restart. `prompt` is the exact
 * prompt the renderer was given; for a failed try, the prompt it was to be given.
 */
export const StationImage = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("shot-station-image"), clip: ClipIdentity, id: ShotId, versionId: ShotId, direction: NonNegative,
  prompt: Text, renderer: Schema.optionalKey(StoryboardRenderer), notes: Schema.optionalKey(Text), imagePath: Schema.optionalKey(ImagePath), error: Schema.optionalKey(Text),
  createdAt: IsoUtc, producer: Producer,
});
export type StationImage = typeof StationImage.Type;
/** An image record as the editor server serves it, with the URL of its image when it has one. */
export const ServedStationImage = Schema.Struct({ ...StationImage.fields, imageUrl: Schema.optionalKey(Text) });
export type ServedStationImage = typeof ServedStationImage.Type;

/** `GET .../storyboard/station`: every version and every image try of the story, oldest first. */
export const StationResponse = Schema.Struct({ versions: Schema.Array(StationVersion), images: Schema.Array(ServedStationImage) });
export type StationResponse = typeof StationResponse.Type;

/**
 * `POST .../storyboard/station/versions`: make a version for the shot at `shotWordId`, over the narration from `startWordId` through
 * `endWordId`, from `parentId` (null only for a description with no version before it) by `action`. A describe, mix, or edit asks the
 * writer model and draws each new direction in the background; a pick or a motion choice writes at once and draws nothing.
 */
export const StationVersionRequest = Schema.Struct({ shotWordId: Text, startWordId: Text, endWordId: Text, parentId: Schema.NullOr(ShotId), action: StationAction });
export type StationVersionRequest = typeof StationVersionRequest.Type;
/** The answer to `POST .../storyboard/station/versions`: the version written and the drawings it started. */
export const StationVersionResult = Schema.Struct({ version: StationVersion, jobs: Schema.Array(StoryboardJob) });
export type StationVersionResult = typeof StationVersionResult.Type;
/** `POST .../storyboard/station/draw`: draw a version's direction that has no image, after a failed or interrupted try. */
export const StationDrawRequest = Schema.Struct({ versionId: ShotId, direction: NonNegative });
export type StationDrawRequest = typeof StationDrawRequest.Type;

/** The direction a carried direction came from, followed back to the one that was drawn; the direction itself when it was not carried. */
export function stationOrigin(versions: ReadonlyArray<Pick<StationVersion, "id" | "directions">>, versionId: string, direction: number): StationOrigin {
  const byId = new Map(versions.map(v => [v.id, v] as const));
  let at: StationOrigin = { versionId, direction };
  for (let hops = 0; hops <= versions.length; hops++) {
    const carried = byId.get(at.versionId)?.directions[at.direction]?.carried;
    if (carried === undefined) return at;
    at = carried;
  }
  return at;
}

/**
 * The image a version's direction shows, and how it stands: `drawn` with the newest try that drew one, else `failed` with the newest try
 * when every try failed, else `none` when nothing has been tried, such as while it is being drawn or after a restart lost the drawing. A
 * carried direction shows its origin's image.
 */
export type StationImageState<I> = { readonly status: "drawn"; readonly image: I } | { readonly status: "failed"; readonly image: I } | { readonly status: "none" };
export function stationImage<I extends Pick<StationImage, "versionId" | "direction" | "imagePath" | "createdAt" | "id">>(
  versions: ReadonlyArray<Pick<StationVersion, "id" | "directions">>, images: ReadonlyArray<I>, versionId: string, direction: number): StationImageState<I> {
  const origin = stationOrigin(versions, versionId, direction);
  const tries = images.filter(i => i.versionId === origin.versionId && i.direction === origin.direction)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const drawn = tries.filter(i => i.imagePath !== undefined).at(-1);
  if (drawn !== undefined) return { status: "drawn", image: drawn };
  const failed = tries.at(-1);
  return failed !== undefined ? { status: "failed", image: failed } : { status: "none" };
}

/** The model that wrote a direction: the writer of the version it was first written in, or null when none is known. */
export function stationWriterOf(versions: ReadonlyArray<StationVersion>, versionId: string, direction: number): StationWriter | null {
  const origin = stationOrigin(versions, versionId, direction);
  return versions.find(v => v.id === origin.versionId)?.writer ?? null;
}

/**
 * The versions of one shot, oldest first: those made for the shot at `shotWordId`, those whose narration begins at it (a version saved
 * at a moved start belongs to the frame it made), and every version they descend from, so the whole history behind a shot stays at hand.
 */
export function versionsForShot<V extends Pick<StationVersion, "id" | "shotWordId" | "span" | "parentId" | "createdAt">>(versions: ReadonlyArray<V>, shotWordId: string): ReadonlyArray<V> {
  const byId = new Map(versions.map(v => [v.id, v] as const));
  const kept = new Set<string>();
  for (const version of versions) {
    if (version.shotWordId !== shotWordId && version.span.startWordId !== shotWordId) continue;
    for (let at: V | undefined = version; at !== undefined && !kept.has(at.id); at = at.parentId === null ? undefined : byId.get(at.parentId)) kept.add(at.id);
  }
  return versions.filter(v => kept.has(v.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * Whether an action may follow a parent with this many directions, or why not: a pick, an edit, and a motion choice need a direction that
 * is there; a mix needs two or more distinct ones; a motion choice needs a parent of one direction; a describe takes any parent or none.
 */
export function judgeStationAction(action: StationAction, parentDirections: number | null, maxDirections: number): string | null {
  const has = (i: number) => parentDirections !== null && i < parentDirections;
  switch (action.kind) {
    case "describe": return action.count > maxDirections ? `A description asks for at most ${maxDirections} directions, not ${action.count}.` : null;
    case "pick": case "edit": return has(action.direction) ? null : `The version has no direction ${action.direction + 1} to ${action.kind}.`;
    case "mix": {
      if (new Set(action.directions).size !== action.directions.length) return "A mix names each direction once.";
      if (action.directions.length < 2) return "A mix needs two directions or more.";
      return action.directions.every(has) ? null : "A mix names a direction the version does not have.";
    }
    case "motion": return parentDirections === 1 ? null : "Motion is chosen for a version of one direction; pick one first.";
  }
}
