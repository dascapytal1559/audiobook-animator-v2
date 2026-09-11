import { extname, join, resolve } from "node:path";
import { Effect, FileSystem, type Schema } from "effect";
import { type DecisionsBody as MergeBody, mergeTimeline, sameClip, type ServedShotRecord } from "@animator/domain";
import { decodeJson, encodeJson as encode, readBounded, writeAtomic as writeAtomicBytes } from "../../core/io.js";
import { clipOf, type StoryContext } from "../story/index.js";
import { DEFAULT_SETTINGS, Decisions, type DecisionsBody, type ShotMode, ShotRecord, type VisualTimelineSettings, timelineError, isTimelineError, type TimelineCode, visualTimelineDefaults } from "./contracts.js";
import { isUlid, mintUlid } from "./ulid.js";
export { ClipIdentity, Decisions, DEFAULT_SETTINGS, type DecisionsBody, IsoUtc, Producer, ShotDecision, ShotMode, ShotRecord, TimelineSettings, timelineError, isTimelineError, type TimelineCode, VisualTimelineSettings, visualTimelineDefaults } from "./contracts.js";
export { type CandidateGroup, type EffectiveShot, mergeTimeline, type MergedTimeline, type StitchedEntry } from "@animator/domain";
export { isUlid, mintUlid, ULID_PATTERN } from "./ulid.js";
type Code = TimelineCode;
const fail = (code: Code, message: string) => Effect.fail(timelineError({ code, message }));
/** Core readers and decoders keep their messages; this module owns the error type and code. */
const read = (path: string, limit: number) => readBounded(path, limit).pipe(Effect.mapError(e => timelineError({ code: "IoFailed", message: e.message })));
const io = <A>(effect: Effect.Effect<A, unknown>, message: string) => effect.pipe(Effect.mapError(e => isTimelineError(e) ? e : timelineError({ code: "IoFailed", message })));
const decode = <S extends Schema.Top>(schema: S, bytes: Uint8Array, code: Code, path: string) => decodeJson(schema, bytes, path, true).pipe(Effect.mapError(e => timelineError({ code, message: e.message })));
/** The domain merge, with any broken rule turned into InvalidDecisions naming the file or body it came from. */
const checkedMerge = (records: ReadonlyArray<ServedShotRecord>, decisions: MergeBody, sampleCount: number, path: string, wordStarts: ReadonlyMap<string, number>) => {
  const merged = mergeTimeline(records, decisions, sampleCount, wordStarts);
  return merged.problems.length > 0 ? fail("InvalidDecisions", `${merged.problems[0]} in ${path}.`) : Effect.succeed(merged);
};
const writeAtomic = (path: string, bytes: Uint8Array) => writeAtomicBytes(path, bytes).pipe(Effect.mapError(() => timelineError({ code: "IoFailed", message: `Cannot write ${path}.` })));

/** Where one story's timeline files live: the verified clip identity from the story context, and the settings (defaults unless a run overrides them). */
export type TimelineTarget = { readonly story: StoryContext; readonly settings?: VisualTimelineSettings };
function context(target: TimelineTarget) {
  const settings = target.settings ?? visualTimelineDefaults;
  const storyDirectory = target.story.storyDirectory;
  return { settings, clip: clipOf(target.story), storyDirectory, shotsDirectory: join(storyDirectory, "shots"), decisionsPath: join(storyDirectory, "decisions.json") };
}
type Context = ReturnType<typeof context>;

/** Every `shots/<id>/record.json`, each checked against its directory name, the clip identity, the clip length, and its image on disk. Dot entries are ignored. */
function loadRecords(ctx: Context) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* io(fs.exists(ctx.shotsDirectory), `Cannot inspect ${ctx.shotsDirectory}.`))) return [] as ReadonlyArray<ShotRecord>;
    const entries = (yield* io(fs.readDirectory(ctx.shotsDirectory), `Cannot list ${ctx.shotsDirectory}.`)).filter(e => !e.startsWith(".")).sort();
    if (entries.length > ctx.settings.limits.maxRecords) return yield* fail("InvalidRecord", `${ctx.shotsDirectory} holds ${entries.length} entries, above the configured limit of ${ctx.settings.limits.maxRecords}.`);
    const records: ShotRecord[] = [];
    for (const entry of entries) {
      const directory = join(ctx.shotsDirectory, entry);
      const path = join(directory, "record.json");
      if (!isUlid(entry) || (yield* io(fs.stat(directory), `Cannot inspect ${directory}.`)).type !== "Directory") return yield* fail("InvalidRecord", `Unexpected entry in the shots directory; every entry must be a ULID-named directory: ${directory}.`);
      const record = yield* decode(ShotRecord, yield* read(path, ctx.settings.limits.maxRecordBytes), "InvalidRecord", path);
      if (record.id !== entry) return yield* fail("InvalidRecord", `Record id ${record.id} does not match its directory name in ${path}.`);
      if (!sameClip(record.clip, ctx.clip)) return yield* fail("IdentityMismatch", `Record is pinned to a different clip than the verified story: ${path}.`);
      if (record.startSample >= ctx.clip.sampleCount) return yield* fail("InvalidRecord", `startSample ${record.startSample} is outside the clip's ${ctx.clip.sampleCount} samples in ${path}.`);
      if (Number.isNaN(Date.parse(record.createdAt))) return yield* fail("InvalidRecord", `createdAt is not a real instant in ${path}.`);
      if (record.imagePath !== undefined) {
        const image = join(directory, record.imagePath);
        const info = yield* fs.stat(image).pipe(Effect.mapError(() => timelineError({ code: "InvalidRecord", message: `Image referenced by ${path} does not exist: ${image}.` })));
        if (info.type !== "File") return yield* fail("InvalidRecord", `Image referenced by ${path} is not a regular file: ${image}.`);
      }
      records.push(record);
    }
    return records as ReadonlyArray<ShotRecord>;
  });
}
function loadDecisions(ctx: Context) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* io(fs.exists(ctx.decisionsPath), `Cannot inspect ${ctx.decisionsPath}.`))) {
      return { schemaVersion: 1, kind: "visual-timeline-decisions", clip: ctx.clip, updatedAt: new Date(0).toISOString(), settings: DEFAULT_SETTINGS, shots: {} } as Decisions;
    }
    const decisions = yield* decode(Decisions, yield* read(ctx.decisionsPath, ctx.settings.limits.maxDecisionsBytes), "InvalidDecisions", ctx.decisionsPath);
    if (!sameClip(decisions.clip, ctx.clip)) return yield* fail("IdentityMismatch", `Decisions are pinned to a different clip than the verified story: ${ctx.decisionsPath}.`);
    return decisions;
  });
}
const wrap = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.mapError(e => isTimelineError(e) ? e : timelineError({ code: "IoFailed", message: "Cannot read the visual timeline." })));

const NO_WORDS: ReadonlyMap<string, number> = new Map();
/**
 * Records plus decisions, merged into candidate groups and a stitched timeline covering the whole clip. Read-only.
 * `wordStarts` (word id to effective start sample) resolves shot anchors; without it every anchor is unresolved and falls back to its override or record.
 */
export function loadVisualTimeline(options: TimelineTarget & { readonly wordStarts?: ReadonlyMap<string, number> }) {
  return wrap(Effect.gen(function* () {
    const ctx = context(options);
    const records = yield* loadRecords(ctx);
    const decisions = yield* loadDecisions(ctx);
    const { candidates, stitched, unresolvedAnchors } = yield* checkedMerge(records, decisions, ctx.clip.sampleCount, ctx.decisionsPath, options.wordStarts ?? NO_WORDS);
    return { clip: ctx.clip, storyDirectory: ctx.storyDirectory, records, decisions, candidates, stitched, unresolvedAnchors };
  }));
}
export type VisualTimeline = Effect.Success<ReturnType<typeof loadVisualTimeline>>;

export type AddShotRequest = TimelineTarget & {
  readonly startSample?: number; readonly startSeconds?: number; readonly mode: ShotMode;
  /** Explicit ULID for reproducible imports; a fresh one is minted when absent. */
  readonly id?: string;
  /** Explicit ISO-8601 UTC instant for reproducible imports; the current time when absent. */
  readonly createdAt?: string;
  readonly label?: string; readonly prompt?: string; readonly imageSourcePath?: string; readonly notes?: string;
  readonly producer: { readonly name: string; readonly version: string };
};
/** Mint or take an id, create `shots/<id>/`, copy the image beside the record, and write `record.json` atomically. Never overwrites. */
export function addShot(request: AddShotRequest) {
  return wrap(Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const ctx = context(request);
    if ((request.startSample === undefined) === (request.startSeconds === undefined)) return yield* fail("InvalidRequest", "Supply exactly one of startSample or startSeconds.");
    if (request.startSeconds !== undefined && !Number.isFinite(request.startSeconds)) return yield* fail("InvalidRequest", "startSeconds must be a finite number.");
    const startSample = request.startSample ?? Math.round(request.startSeconds! * ctx.clip.sampleRateHz);
    if (!Number.isSafeInteger(startSample) || startSample < 0 || startSample >= ctx.clip.sampleCount) return yield* fail("InvalidRequest", `Start ${startSample} is outside the clip's ${ctx.clip.sampleCount} samples.`);
    let image: { readonly name: string; readonly bytes: Uint8Array } | undefined;
    if (request.imageSourcePath !== undefined) {
      const source = resolve(request.imageSourcePath);
      const bytes = yield* read(source, ctx.settings.limits.maxImageBytes);
      image = { name: `image${extname(source).toLowerCase()}`, bytes };
    }
    if (request.id !== undefined && !isUlid(request.id)) return yield* fail("InvalidRequest", `Explicit id is not a ULID: ${request.id}.`);
    if (request.createdAt !== undefined && Number.isNaN(Date.parse(request.createdAt))) return yield* fail("InvalidRequest", `Explicit createdAt is not a real instant: ${request.createdAt}.`);
    const id = request.id ?? mintUlid();
    const directory = join(ctx.shotsDirectory, id);
    if (yield* io(fs.exists(directory), `Cannot inspect ${directory}.`)) return yield* fail("RecordExists", `A record directory already exists: ${directory}.`);
    const record = { schemaVersion: 1, kind: "visual-shot-generation", id, clip: ctx.clip, startSample, mode: request.mode,
      ...(request.label !== undefined ? { label: request.label } : {}), ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
      ...(image ? { imagePath: image.name } : {}), ...(request.notes !== undefined ? { notes: request.notes } : {}),
      createdAt: request.createdAt ?? new Date().toISOString(), producer: request.producer };
    const bytes = encode(record);
    const decoded = yield* decode(ShotRecord, bytes, "InvalidRequest", `the new record ${id}`);
    if (bytes.byteLength > ctx.settings.limits.maxRecordBytes) return yield* fail("InvalidRequest", `The new record would exceed maxRecordBytes (${ctx.settings.limits.maxRecordBytes}).`);
    yield* io(fs.makeDirectory(ctx.shotsDirectory, { recursive: true }), `Cannot create ${ctx.shotsDirectory}.`);
    yield* fs.makeDirectory(directory).pipe(Effect.mapError(() => timelineError({ code: "RecordExists", message: `Cannot create a fresh record directory: ${directory}.` })));
    if (image) yield* io(fs.writeFile(join(directory, image.name), image.bytes, { flag: "wx" }), `Cannot copy the image into ${directory}.`);
    yield* writeAtomic(join(directory, "record.json"), bytes);
    return decoded;
  }));
}

/** Validate the overlay against the current records (and anchors against `wordStarts` when given), then replace `decisions.json` atomically with a fresh `updatedAt`. */
export function writeDecisions(options: TimelineTarget & { readonly decisions: DecisionsBody; readonly wordStarts?: ReadonlyMap<string, number> }) {
  return wrap(Effect.gen(function* () {
    const ctx = context(options);
    const records = yield* loadRecords(ctx);
    const bytes = encode({ schemaVersion: 1, kind: "visual-timeline-decisions", clip: ctx.clip, updatedAt: new Date().toISOString(), settings: options.decisions.settings, shots: options.decisions.shots });
    const decisions = yield* decode(Decisions, bytes, "InvalidDecisions", "the supplied decisions");
    if (bytes.byteLength > ctx.settings.limits.maxDecisionsBytes) return yield* fail("InvalidDecisions", `The decisions would exceed maxDecisionsBytes (${ctx.settings.limits.maxDecisionsBytes}).`);
    yield* checkedMerge(records, decisions, ctx.clip.sampleCount, "the supplied decisions", options.wordStarts ?? NO_WORDS);
    yield* writeAtomic(ctx.decisionsPath, bytes);
    return decisions;
  }));
}
