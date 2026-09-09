import { join } from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { readBounded, writeAtomic } from "../story-planning/io.js";
import { ClipIdentity } from "../visual-timeline/contracts.js";
import { type AlignParameters, type AlignReport, type TimingEntries, WordTimingAuto, WordTimingError, WordTimingManual } from "./contracts.js";
import { validateEntries } from "./effective.js";
export { alignRange, type AlignInput, measureRange, type MeasureInput, type SampleRange, type TimedWord } from "./align.js";
export { AlignParameters, AlignReport, AlignRun, TimingEntries, TimingEntry, TimingMeasure, WordTimingAuto, WordTimingError, WordTimingManual } from "./contracts.js";
export { type EffectiveTiming, type EffectiveWord, effectiveTiming, type SourceWord, validateEntries } from "./effective.js";
export { detectRegions, type DetectOptions, SpeechAccumulator, type SpeechRegion } from "./speech.js";
type Code = WordTimingError["code"];
const fail = (code: Code, message: string) => Effect.fail(new WordTimingError({ code, message }));
const encode = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const sameClip = (a: ClipIdentity, b: ClipIdentity) => (Object.keys(ClipIdentity.fields) as Array<keyof ClipIdentity>).every(k => a[k] === b[k]);
const read = (path: string, limit: number) => readBounded(path, limit).pipe(Effect.mapError(e => new WordTimingError({ code: "IoFailed", message: e.message })));
const write = (path: string, bytes: Uint8Array) => writeAtomic(path, bytes).pipe(Effect.mapError(e => new WordTimingError({ code: "IoFailed", message: e.message })));

/** Where the overlays live and what they must agree with: the clip identity and the transcript's word ids. */
export type OverlayContext = {
  readonly storyDirectory: string; readonly clip: ClipIdentity; readonly wordIds: ReadonlySet<string>;
  /** Byte ceiling for reading either overlay. */
  readonly maxBytes: number;
};
export const autoPath = (ctx: OverlayContext) => join(ctx.storyDirectory, "word-timing.auto.json");
export const manualPath = (ctx: OverlayContext) => join(ctx.storyDirectory, "word-timing.json");

function decode<S extends Schema.Top>(schema: S, bytes: Uint8Array, path: string) {
  return Effect.gen(function* () {
    const raw = yield* Effect.try({ try: () => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown, catch: () => new WordTimingError({ code: "InvalidTiming", message: `Input is not valid UTF-8 JSON: ${path}.` }) });
    return yield* Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(raw).pipe(
      Effect.mapError(e => new WordTimingError({ code: "InvalidTiming", message: `Input does not match the required schema: ${path}. ${e.message.replace(/\s+/g, " ")}` })));
  });
}
/** Decode one overlay if it exists, then pin it to the clip and validate its entries against the transcript. */
function loadOverlay<S extends Schema.Top & { readonly Type: { readonly clip: ClipIdentity; readonly words: TimingEntries } }>(ctx: OverlayContext, schema: S, path: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(path).pipe(Effect.mapError(() => new WordTimingError({ code: "IoFailed", message: `Cannot inspect ${path}.` }))))) return undefined;
    const overlay = (yield* decode(schema, yield* read(path, ctx.maxBytes), path)) as S["Type"];
    if (!sameClip(overlay.clip, ctx.clip)) return yield* fail("IdentityMismatch", `Word timing is pinned to a different clip than the verified story: ${path}.`);
    const problem = validateEntries(overlay.words, ctx.wordIds, ctx.clip.sampleCount, path);
    if (problem !== null) return yield* fail("InvalidTiming", problem);
    return overlay;
  });
}
/** Both overlays, each undefined when its file is absent. Every entry is validated; a bad file is an error naming it, never silently ignored. */
export function loadOverlays(ctx: OverlayContext) {
  return Effect.gen(function* () {
    const auto = yield* loadOverlay(ctx, WordTimingAuto, autoPath(ctx));
    const manual = yield* loadOverlay(ctx, WordTimingManual, manualPath(ctx));
    return { auto, manual };
  });
}

/** Replace `word-timing.json` wholesale with the editor's entries (A42): validated, sized, then written atomically with a fresh `updatedAt`. */
export function writeManual(ctx: OverlayContext, words: TimingEntries) {
  return Effect.gen(function* () {
    const path = manualPath(ctx);
    const bytes = encode({ schemaVersion: 1, kind: "word-timing-manual", clip: ctx.clip, updatedAt: new Date().toISOString(), words });
    const manual = yield* decode(WordTimingManual, bytes, "the supplied word timing").pipe(Effect.mapError(e => new WordTimingError({ code: "InvalidRequest", message: e.message })));
    const problem = validateEntries(manual.words, ctx.wordIds, ctx.clip.sampleCount, "the supplied word timing");
    if (problem !== null) return yield* fail("InvalidRequest", problem);
    if (bytes.byteLength > ctx.maxBytes) return yield* fail("InvalidRequest", `The word timing would exceed the ${ctx.maxBytes}-byte limit.`);
    yield* write(path, bytes);
    return manual;
  });
}

export type AutoRunInput = {
  readonly range: { readonly startSample: number; readonly endSample: number };
  /** New entries for words in the range only; every previous auto entry for a word starting in the range is dropped first. */
  readonly entries: TimingEntries; readonly report: AlignReport;
  /** Original starts of every transcript word, used to find which previous auto entries belong to the range. */
  readonly originalStarts: ReadonlyMap<string, number>;
  readonly parameters: AlignParameters; readonly producer: { readonly name: string; readonly version: string }; readonly ranAt: string;
};
/** Merge one align run into `word-timing.auto.json` (A42): replace the range's entries, append the run, refresh parameters and producer. `word-timing.json` is never touched. */
export function writeAutoRun(ctx: OverlayContext, input: AutoRunInput) {
  return Effect.gen(function* () {
    const path = autoPath(ctx);
    const previous = yield* loadOverlay(ctx, WordTimingAuto, path);
    const inRange = (id: string) => { const start = input.originalStarts.get(id); return start !== undefined && start >= input.range.startSample && start < input.range.endSample; };
    for (const id of Object.keys(input.entries)) if (!inRange(id)) return yield* fail("InvalidRequest", `Align produced an entry for a word outside its range: ${id}.`);
    const kept = Object.fromEntries(Object.entries(previous?.words ?? {}).filter(([id]) => !inRange(id)));
    const words = Object.fromEntries([...Object.entries(kept), ...Object.entries(input.entries)].sort(([a], [b]) => (input.originalStarts.get(a) ?? 0) - (input.originalStarts.get(b) ?? 0)));
    const runs = [...(previous?.runs ?? []), { startSample: input.range.startSample, endSample: input.range.endSample, ranAt: input.ranAt, report: input.report }];
    const bytes = encode({ schemaVersion: 1, kind: "word-timing-auto", clip: ctx.clip, updatedAt: input.ranAt, producer: input.producer, parameters: input.parameters, runs, words });
    const auto = yield* decode(WordTimingAuto, bytes, "the new auto word timing");
    const problem = validateEntries(auto.words, ctx.wordIds, ctx.clip.sampleCount, "the new auto word timing");
    if (problem !== null) return yield* fail("InvalidTiming", problem);
    if (bytes.byteLength > ctx.maxBytes) return yield* fail("InvalidTiming", `The auto word timing would exceed the ${ctx.maxBytes}-byte limit.`);
    yield* write(path, bytes);
    return auto;
  });
}
