/**
 * The shot station (A69): what the writer model is asked for and how its answers are read, and the versions and image tries kept under
 * `<story>/shot-station/`. A version is published by one rename like a shot record and never changed; each try at drawing one of its
 * directions is a record of its own, with the image when one was drawn and the reason when none was, so nothing is overwritten and an
 * earlier version reopens as it was.
 */
import { extname, join } from "node:path";
import { Effect, FileSystem, type Schema } from "effect";
import { type ClipIdentity, sameClip, type StationAction, StationImage, type StationDirection, StationVersion, type StationWriter, type StoryboardRenderer } from "@animator/domain";
import { decodeJson, encodeJson, readBounded, writeAtomic } from "../../core/io.js";
import { mintUlid } from "../visual-timeline/index.js";
import { storyboardError } from "./contracts.js";

/** One direction as a model wrote it, before it is kept in a version. */
export type WrittenDirection = Omit<StationDirection, "carried">;
const MOTION_OPTIONS = 3;

/** The director's words, quoted as they were typed or dictated, so a model reads them as the director's and not as its instructions. */
const quoted = (text: string) => `"""\n${text.trim()}\n"""`;
/** What every station turn is told about one direction's fields, so a describe, a mix, and an edit answer in the same shape. */
const DIRECTION_FIELDS = [
  "- \"title\": two to five words naming the idea;",
  "- \"description\": one or two plain present-tense sentences, at most 40 words, of what the camera sees;",
  "- \"prompt\": a self-contained prompt of 40 to 90 words for an image model that sees nothing else: subject and action, setting, framing and camera angle, light, colour palette, and mood, describing anyone it shows by how they look rather than by name; no text, captions, or lettering in the picture;",
  "- \"motion\": the camera or subject movement the director asked for, in a short phrase, or \"\" when they asked for none (a still frame);",
  `- "motionOptions": ${MOTION_OPTIONS} short camera or movement options that would suit the shot, such as "slow push in on her face", "held still", or "pull back to reveal the room".`,
];
const directionJson = `{"title": "...", "description": "...", "prompt": "...", "motion": "...", "motionOptions": ["...", "...", "..."]}`;
const passage = (title: string, excerpt: string) => ["", `Story: ${title}`, "Passage:", excerpt];
const directionText = (d: WrittenDirection, label: string) =>
  [`${label}: ${d.title}`, `  Description: ${d.description}`, `  Image prompt: ${d.prompt}`, `  Motion: ${d.motion ?? "none, a still frame"}`].join("\n");

/**
 * What a description asks for (A69): `count` different directions for the shot covering the narration marked in the excerpt, each keeping
 * everything the director asked for and varying what they left open. The director's words are quoted as given; dictation may ramble.
 */
export function describePrompt(options: { readonly title: string; readonly excerpt: string; readonly director: string; readonly count: number }): string {
  return [
    "You are helping a director storyboard an animated film made from an audiobook's narration.",
    "The director listened to the narration marked [[like this]] in the passage below and described the shot they imagine, in their own words. It was typed or dictated, so it may ramble or repeat itself; read it for what they want:",
    quoted(options.director),
    `Propose ${options.count} different directions for this shot, each one still frame of a wide 16:9 film. Every direction keeps everything the director asked for; vary what they left open, such as framing, camera angle and distance, composition, the moment shown, light, and palette.`,
    "For each direction write:",
    ...DIRECTION_FIELDS,
    "Stay faithful to the director and to the passage; do not invent names or events that neither supports.",
    `Reply with only a JSON object, the directions in order: {"directions": [${directionJson}]}. Do not run commands or read files.`,
    ...passage(options.title, options.excerpt),
  ].join("\n");
}

/** What a mix asks for (A69): one direction combining the chosen ones as the director's instruction says, or as best serves the shot without one. */
export function mixPrompt(options: { readonly title: string; readonly excerpt: string; readonly director: string | null; readonly chosen: ReadonlyArray<{ readonly number: number; readonly direction: WrittenDirection }>; readonly instruction: string }): string {
  const instruction = options.instruction.trim();
  return [
    "You are helping a director storyboard an animated film made from an audiobook's narration.",
    ...(options.director === null ? [] : ["The director described the shot covering the narration marked [[like this]] in the passage below as:", quoted(options.director)]),
    "They chose these directions for the shot and want one that combines them:",
    ...options.chosen.map(c => directionText(c.direction, `Direction ${c.number}`)),
    instruction === "" ? "Combine what is strongest in each into one coherent frame." : `How to combine them, in the director's words (typed or dictated): ${quoted(instruction)}`,
    "Write the combined direction:",
    ...DIRECTION_FIELDS,
    `Reply with only a JSON object: ${directionJson}. Do not run commands or read files.`,
    ...passage(options.title, options.excerpt),
  ].join("\n");
}

/**
 * What an edit asks for (A69): the direction changed as the director's instruction says, such as "make the sky red", and nothing else, so
 * the director never has to describe the shot again from the start.
 */
export function editPrompt(options: { readonly title: string; readonly excerpt: string; readonly director: string | null; readonly direction: WrittenDirection; readonly instruction: string }): string {
  return [
    "You are helping a director storyboard an animated film made from an audiobook's narration.",
    ...(options.director === null ? [] : ["The director described the shot covering the narration marked [[like this]] in the passage below as:", quoted(options.director)]),
    "This is the shot's direction now:",
    directionText(options.direction, "Direction"),
    `The director asks for this change, in their own words (typed or dictated): ${quoted(options.instruction)}`,
    "Revise the direction: change what the director asks for, and keep everything else as it is, including the prompt's wording wherever the change does not touch it. If the change is about movement, change the motion.",
    "Write the revised direction:",
    ...DIRECTION_FIELDS,
    `Reply with only a JSON object: ${directionJson}. Do not run commands or read files.`,
    ...passage(options.title, options.excerpt),
  ].join("\n");
}

/**
 * The picture a renderer is asked for from a station direction (A69): the image prompt as written, as one frame of a wide 16:9 film with no
 * lettering. Unlike a first pass's line drawings (A67), it keeps the colour, light, and style the prompt names, since the director shapes
 * them here ("make the sky red").
 */
export function framePrompt(prompt: string): string {
  return [
    "One still frame from an animated film, wide 16:9 landscape, drawn exactly as the prompt describes. No text, captions, speech bubbles, borders, or watermarks.",
    "",
    `Prompt: ${prompt.trim()}`,
  ].join("\n");
}

const clean = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.replace(/\s+/g, " ").trim() : null);
/** One direction from a reply's JSON, or null when a field it needs is missing; a motion of "" or "none" is a still frame. */
function readDirection(value: unknown): WrittenDirection | null {
  if (typeof value !== "object" || value === null) return null;
  const fields = value as Record<string, unknown>;
  const [title, description, prompt] = [clean(fields["title"]), clean(fields["description"]), clean(fields["prompt"])];
  if (title === null || description === null || prompt === null) return null;
  const motion = clean(fields["motion"]);
  const options = Array.isArray(fields["motionOptions"]) ? fields["motionOptions"].map(clean).filter((o): o is string => o !== null) : [];
  return { title, description, prompt, motion: motion === null || /^(none|no motion|still|static)\.?$/i.test(motion) ? null : motion, motionOptions: [...new Set(options)].slice(0, MOTION_OPTIONS) };
}
/** The JSON object in a reply, found between its first `{` and last `}` so a fence or a stray line around it does no harm; null when there is none. */
function replyObject(reply: string): Record<string, unknown> | null {
  const from = reply.indexOf("{");
  const to = reply.lastIndexOf("}");
  if (from < 0 || to < from) return null;
  try { const parsed: unknown = JSON.parse(reply.slice(from, to + 1)); return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; }
  catch { return null; }
}
/** The directions in a describe's reply, in order; entries missing a field are dropped, and a reply with none is null. */
export function readDirectionsReply(reply: string): ReadonlyArray<WrittenDirection> | null {
  const object = replyObject(reply);
  const directions = object !== null && Array.isArray(object["directions"]) ? object["directions"].map(readDirection).filter((d): d is WrittenDirection => d !== null) : [];
  return directions.length === 0 ? null : directions;
}
/** The one direction in a mix's or an edit's reply, or null when it is missing a field. */
export const readDirectionReply = (reply: string): WrittenDirection | null => readDirection(replyObject(reply));

/** Where a story's shot station lives, and the image limit a copied drawing must keep within. */
export type StationTarget = { readonly storyDirectory: string; readonly clip: ClipIdentity; readonly maxImageBytes: number };
const stationDirectory = (target: StationTarget) => join(target.storyDirectory, "shot-station");
const MAX_FILE_BYTES = 262_144;
const io = <A>(effect: Effect.Effect<A, unknown>, message: string) => effect.pipe(Effect.mapError(() => storyboardError({ code: "IoFailed", message })));
const invalid = (message: string) => storyboardError({ code: "InvalidStation", message });

/**
 * Every record of one kind under the station, oldest first. A file that is malformed, named for another directory, or pinned to another
 * clip fails the listing naming it, since it would otherwise be shown, and saved, as this story's.
 */
function listRecords<S extends typeof StationVersion | typeof StationImage>(target: StationTarget, folder: "versions" | "images", file: string, schema: S): Effect.Effect<ReadonlyArray<Schema.Schema.Type<S>>, ReturnType<typeof storyboardError>, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = join(stationDirectory(target), folder);
    if (!(yield* io(fs.exists(directory), `Cannot inspect ${directory}.`))) return [];
    const names = (yield* io(fs.readDirectory(directory), `Cannot list ${directory}.`)).filter(name => !name.startsWith(".")).sort();
    const records = yield* Effect.forEach(names, name => readRecord(target, folder, file, schema, name));
    return [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  });
}
/** One record by its directory, checked like a listing's: decoded strictly, named for its directory, and pinned to the story's clip. */
function readRecord<S extends typeof StationVersion | typeof StationImage>(target: StationTarget, folder: "versions" | "images", file: string, schema: S, name: string) {
  return Effect.gen(function* () {
    const path = join(stationDirectory(target), folder, name, file);
    const bytes = yield* readBounded(path, MAX_FILE_BYTES).pipe(Effect.mapError(e => invalid(e.message)));
    const record = (yield* decodeJson(schema, bytes, path, true).pipe(Effect.mapError(e => invalid(e.message)))) as Schema.Schema.Type<S>;
    if (record.id !== name) return yield* Effect.fail(invalid(`${path} names ${record.id}, not its directory's ${name}.`));
    if (!sameClip(record.clip, target.clip)) return yield* Effect.fail(invalid(`${path} belongs to another clip than ${target.clip.storyId}'s.`));
    return record;
  });
}
export const listStationVersions = (target: StationTarget) => listRecords(target, "versions", "version.json", StationVersion);
export const listStationImages = (target: StationTarget) => listRecords(target, "images", "image.json", StationImage);
/** One image try by id, so serving an image reads its own record only; the caller has checked the id is a ULID. */
export const readStationImage = (target: StationTarget, id: string) => readRecord(target, "images", "image.json", StationImage, id);
/** The image file of a station image try that drew one. */
export const stationImagePath = (target: Pick<StationTarget, "storyDirectory">, image: Pick<StationImage, "id" | "imagePath">): string | null =>
  image.imagePath === undefined ? null : join(target.storyDirectory, "shot-station", "images", image.id, image.imagePath);

/** Publish one record directory by a single rename, with its files written first, so a reader never meets half of it. */
function publish(target: StationTarget, folder: "versions" | "images", id: string, files: ReadonlyArray<readonly [string, Uint8Array]>) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const parent = join(stationDirectory(target), folder);
    yield* io(fs.makeDirectory(parent, { recursive: true }), `Cannot create ${parent}.`);
    yield* Effect.acquireUseRelease(
      io(fs.makeTempDirectory({ directory: parent, prefix: `.${id}.` }), `Cannot stage ${join(parent, id)}.`),
      staging => Effect.gen(function* () {
        for (const [name, bytes] of files) yield* writeAtomic(join(staging, name), bytes).pipe(Effect.mapError(e => storyboardError({ code: "IoFailed", message: e.message })));
        yield* io(fs.rename(staging, join(parent, id)), `Cannot publish ${join(parent, id)}.`);
      }),
      staging => fs.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore));
  });
}

type Producer = { readonly name: string; readonly version: string };
export type NewStationVersion = {
  readonly shotWordId: string; readonly span: { readonly startWordId: string; readonly endWordId: string }; readonly parentId: string | null;
  readonly action: StationAction; readonly writer: StationWriter | null; readonly directions: ReadonlyArray<StationDirection>; readonly producer: Producer;
};
/** Write a new version, checked against its schema before it lands. */
export function writeStationVersion(target: StationTarget, fields: NewStationVersion): Effect.Effect<StationVersion, ReturnType<typeof storyboardError>, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const id = mintUlid();
    const version: StationVersion = { schemaVersion: 1, kind: "shot-station-version", clip: target.clip, id, ...fields, createdAt: new Date().toISOString() };
    const bytes = encodeJson(version);
    yield* decodeJson(StationVersion, bytes, `the new version ${id}`, true).pipe(Effect.mapError(e => storyboardError({ code: "InvalidRequest", message: e.message })));
    yield* publish(target, "versions", id, [["version.json", bytes]]);
    return version;
  });
}

export type NewStationImage = {
  readonly versionId: string; readonly direction: number; readonly prompt: string; readonly producer: Producer;
  readonly drawn: { readonly renderer: StoryboardRenderer; readonly notes: string; readonly imageSourcePath: string } | { readonly error: string };
};
/** Record one try at drawing a direction: the image with its renderer and notes when it drew one, else why it failed. */
export function writeStationImage(target: StationTarget, fields: NewStationImage): Effect.Effect<StationImage, ReturnType<typeof storyboardError>, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const id = mintUlid();
    const { drawn, ...rest } = fields;
    const imagePath = "imageSourcePath" in drawn ? `image${extname(drawn.imageSourcePath).toLowerCase() || ".png"}` : null;
    const image = "imageSourcePath" in drawn ? yield* readBounded(drawn.imageSourcePath, target.maxImageBytes).pipe(Effect.mapError(e => storyboardError({ code: "IoFailed", message: e.message }))) : null;
    const record: StationImage = { schemaVersion: 1, kind: "shot-station-image", clip: target.clip, id, ...rest,
      ...("imageSourcePath" in drawn ? { renderer: drawn.renderer, notes: drawn.notes, imagePath: imagePath! } : { error: drawn.error }), createdAt: new Date().toISOString() };
    const bytes = encodeJson(record);
    yield* decodeJson(StationImage, bytes, `the new image ${id}`, true).pipe(Effect.mapError(e => storyboardError({ code: "InvalidRequest", message: e.message })));
    yield* publish(target, "images", id, [...(image !== null ? [[imagePath!, image] as const] : []), ["image.json", bytes] as const]);
    return record;
  });
}
