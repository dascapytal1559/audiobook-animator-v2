import { Console, Effect, Option, Semaphore } from "effect";
import { type AlignReport, alignRange, autoPath, effectiveTiming, loadOverlays, manualPath, type OverlayContext, type TimingEntries, writeAutoRun, WordTimingError, writeManual } from "../word-timing/index.js";
import { computeChunks, listSentenceBreaks } from "./chunks.js";
import { EditorServerError, type PeaksFile, type SpeechFile } from "./contracts.js";
import { computePeaksAndSpeech, readPeaksCache, readSpeechCache, writeCache } from "./peaks.js";
import type { EditorContext } from "./routes.js";
const fail = (code: EditorServerError["code"], message: string) => Effect.fail(new EditorServerError({ code, message }));

/** Peaks and speech regions from one shared decode (A46). Each is read from its cache when pinned; a miss on either decodes once and writes both files. One decode at a time. */
export function makeCaches(ctx: EditorContext) {
  const lock = Semaphore.makeUnsafe(1);
  let peaks: PeaksFile | undefined;
  let speech: SpeechFile | undefined;
  const decode = Effect.gen(function* () {
    yield* Console.error(`Computing waveform peaks and speech regions for ${ctx.clip.bookId}/${ctx.clip.storyId} with ${ctx.config.ffmpegPath}.`);
    const computed = yield* computePeaksAndSpeech({ ffmpegPath: ctx.config.ffmpegPath, audioPath: ctx.story.paths.audioPath, identity: ctx.peaksIdentity, speech: ctx.speechIdentity });
    yield* writeCache(ctx.peaksPath, computed.peaks);
    yield* writeCache(ctx.speechPath, computed.speech);
    peaks = computed.peaks; speech = computed.speech;
  });
  return {
    peaks: lock.withPermits(1)(Effect.gen(function* () {
      if (peaks === undefined) peaks = Option.getOrUndefined(yield* readPeaksCache(ctx.peaksPath, ctx.config.peaks.maxCacheBytes, ctx.peaksIdentity));
      if (peaks === undefined) yield* decode;
      return peaks!;
    })),
    speech: lock.withPermits(1)(Effect.gen(function* () {
      if (speech === undefined) speech = Option.getOrUndefined(yield* readSpeechCache(ctx.speechPath, ctx.config.peaks.maxCacheBytes, ctx.speechIdentity));
      if (speech === undefined) yield* decode;
      return speech!;
    })),
  };
}
export type Caches = ReturnType<typeof makeCaches>;

const overlayContext = (ctx: EditorContext): OverlayContext => ({ storyDirectory: ctx.storyDirectory, clip: ctx.clip, wordIds: new Set(ctx.words.map(w => w.id)), maxBytes: ctx.timelineConfig.limits.maxDecisionsBytes });
export const timingPaths = (ctx: EditorContext) => { const o = overlayContext(ctx); return { auto: autoPath(o), manual: manualPath(o) }; };

/** The overlays merged over the transcript (A37): effective words, chunks recomputed on effective times, and the map shot anchors resolve against. */
export function loadTiming(ctx: EditorContext) {
  return Effect.gen(function* () {
    const { auto, manual } = yield* loadOverlays(overlayContext(ctx));
    const effective = effectiveTiming(ctx.words, auto?.words, manual?.words);
    const byId = new Map(effective.words.map(w => [w.id, w] as const));
    const elements = ctx.elements.map(e => e.kind === "word" ? { ...e, startSample: byId.get(e.id)!.startSample, endSample: byId.get(e.id)!.endSample } : e);
    const toSamples = (ms: number) => Math.round((ms / 1000) * ctx.clip.sampleRateHz);
    const minSentenceBreakSamples = toSamples(ctx.config.chunking.minSentenceBreakMs);
    const chunks = computeChunks(elements, toSamples(ctx.config.chunking.pauseBreakMs), minSentenceBreakSamples);
    const mergedSentenceBreaks = listSentenceBreaks(elements).filter(b => b.gapSamples < minSentenceBreakSamples)
      .map(b => ({ ...b, gapMs: Math.round((b.gapSamples / ctx.clip.sampleRateHz) * 1000) }));
    const wordStarts: ReadonlyMap<string, number> = new Map(effective.words.map(w => [w.id, w.startSample] as const));
    return { auto, manual, effective, chunks, wordStarts, chunking: { minSentenceBreakMs: ctx.config.chunking.minSentenceBreakMs, pauseBreakMs: ctx.config.chunking.pauseBreakMs, mergedSentenceBreaks } };
  });
}
/** `GET /api/story`: identity, titles, effective words with their layers, chunks on effective times, and the timing summary. */
export function storyPayload(ctx: EditorContext) {
  return Effect.map(loadTiming(ctx), t => ({
    clip: ctx.clip, story: { title: ctx.story.story.title, bookTitle: ctx.story.bookTitle }, sourceStartSample: ctx.story.transcript.segment.startSample,
    words: t.effective.words, chunks: t.chunks, chunking: t.chunking,
    timing: { inversions: t.effective.inversions, autoRuns: t.auto?.runs ?? [], manualCount: t.effective.manualCount, autoCount: t.effective.autoCount },
  }));
}
export type StoryPayload = Effect.Success<ReturnType<typeof storyPayload>>;

/** `PUT /api/word-timing`: replace the manual overlay wholesale. */
export const writeManualTiming = (ctx: EditorContext, words: TimingEntries) => writeManual(overlayContext(ctx), words);

export type AlignOptions = {
  readonly range: { readonly startSample: number; readonly endSample: number };
  /** Required to align a range covering the whole clip (A43). */
  readonly wholeClip: boolean;
  /** Report only; write nothing. */
  readonly dryRun: boolean;
  readonly producer: { readonly name: string; readonly version: string };
};
/** The align pass over one range (A47): speech regions from the cache, original transcript timings in, entries merged into the auto overlay, report out. */
export function alignTiming(ctx: EditorContext, caches: Caches, options: AlignOptions): Effect.Effect<AlignReport, EditorServerError | WordTimingError, Effect.Services<Caches["speech"]> | Effect.Services<ReturnType<typeof writeAutoRun>>> {
  return Effect.gen(function* () {
    const { range } = options;
    if (!Number.isSafeInteger(range.startSample) || !Number.isSafeInteger(range.endSample) || range.startSample < 0 || range.startSample >= range.endSample || range.endSample > ctx.clip.sampleCount) {
      return yield* fail("InvalidRequest", `Range must satisfy 0 <= startSample < endSample <= ${ctx.clip.sampleCount}, got ${range.startSample}..${range.endSample}.`);
    }
    if (range.startSample === 0 && range.endSample === ctx.clip.sampleCount && !options.wholeClip) return yield* fail("InvalidRequest", "The range covers the whole clip; pass wholeClip to align everything at once (A43).");
    const speech = yield* caches.speech;
    const { entries, report } = alignRange({ words: ctx.words, regions: speech.regions, range, sampleRateHz: ctx.clip.sampleRateHz, leadMs: ctx.config.alignment.leadMs, boundaryPauseMs: ctx.config.alignment.boundaryPauseMs });
    if (options.dryRun) return report;
    yield* writeAutoRun(overlayContext(ctx), { range, entries, report, originalStarts: new Map(ctx.words.map(w => [w.id, w.startSample] as const)), ranAt: new Date().toISOString(), producer: options.producer,
      parameters: { leadMs: ctx.config.alignment.leadMs, thresholdDbfs: ctx.config.speech.thresholdDbfs, minSilenceMs: ctx.config.speech.minSilenceMs, minSpeechMs: ctx.config.speech.minSpeechMs } });
    return report;
  });
}
