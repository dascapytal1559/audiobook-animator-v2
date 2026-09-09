import { dirname } from "node:path";
import { Effect, FileSystem, Fiber, Option, Schema, Stream } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/unstable/process";
import { readBounded, writeAtomic } from "../story-planning/io.js";
import { detectRegions, SpeechAccumulator } from "../word-timing/speech.js";
import { EditorServerError, PeaksFile, SpeechFile } from "./contracts.js";
const fail = (code: EditorServerError["code"], message: string) => Effect.fail(new EditorServerError({ code, message }));
const STDERR_TAIL_BYTES = 8192;

/** Streaming int16 min/max reduction over little-endian s16 bytes. Chunks may split a sample; the last partial bucket is kept. */
export class PeakAccumulator {
  readonly min: number[] = [];
  readonly max: number[] = [];
  sampleCount = 0;
  private pendingLowByte: number | null = null;
  private bucketMin = 32767;
  private bucketMax = -32768;
  private bucketFill = 0;
  constructor(readonly samplesPerBucket: number) {
    if (!Number.isSafeInteger(samplesPerBucket) || samplesPerBucket < 1) throw new RangeError("samplesPerBucket must be a positive integer.");
  }
  push(chunk: Uint8Array): void {
    let i = 0;
    if (this.pendingLowByte !== null && chunk.length > 0) {
      this.sample(this.pendingLowByte | (chunk[0]! << 8));
      this.pendingLowByte = null;
      i = 1;
    }
    for (; i + 1 < chunk.length; i += 2) this.sample(chunk[i]! | (chunk[i + 1]! << 8));
    if (i < chunk.length) this.pendingLowByte = chunk[i]!;
  }
  /** Close the open bucket. Calling twice is a defect; a dangling half sample is one too. */
  finish(): { readonly min: ReadonlyArray<number>; readonly max: ReadonlyArray<number>; readonly sampleCount: number } {
    if (this.pendingLowByte !== null) throw new RangeError("The s16le byte stream ended halfway through a sample.");
    if (this.bucketFill > 0) { this.min.push(this.bucketMin); this.max.push(this.bucketMax); this.bucketFill = 0; }
    return { min: this.min, max: this.max, sampleCount: this.sampleCount };
  }
  private sample(unsigned16: number): void {
    const value = (unsigned16 << 16) >> 16;
    if (value < this.bucketMin) this.bucketMin = value;
    if (value > this.bucketMax) this.bucketMax = value;
    this.sampleCount++;
    if (++this.bucketFill === this.samplesPerBucket) {
      this.min.push(this.bucketMin); this.max.push(this.bucketMax);
      this.bucketMin = 32767; this.bucketMax = -32768; this.bucketFill = 0;
    }
  }
}

export type PeaksIdentity = { readonly audioSha256: string; readonly sampleRateHz: number; readonly sampleCount: number; readonly samplesPerBucket: number };
export type SpeechIdentity = { readonly audioSha256: string; readonly sampleRateHz: number; readonly sampleCount: number; readonly frameSamples: number; readonly thresholdDbfs: number; readonly minSilenceMs: number; readonly minSpeechMs: number };
export type DecodeOptions = { readonly ffmpegPath: string; readonly audioPath: string; readonly identity: PeaksIdentity; readonly speech: SpeechIdentity };

/**
 * Decode with ffmpeg to mono s16le on stdout and reduce it as it streams into both the peaks and the speech accumulators (A46: one pass, two
 * artifacts); nothing but the reductions and a bounded stderr tail is held in memory. Both identities must name the same clip.
 */
export function computePeaksAndSpeech(options: DecodeOptions): Effect.Effect<{ readonly peaks: PeaksFile; readonly speech: SpeechFile }, EditorServerError, ChildProcessSpawner.ChildProcessSpawner> {
  const { identity, speech } = options;
  return Effect.scoped(Effect.gen(function* () {
    if (speech.audioSha256 !== identity.audioSha256 || speech.sampleRateHz !== identity.sampleRateHz || speech.sampleCount !== identity.sampleCount) return yield* fail("PeaksFailed", "Peaks and speech identities name different clips.");
    const args = ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", options.audioPath, "-f", "s16le", "-ac", "1", "-"];
    const handle = yield* ChildProcess.make(options.ffmpegPath, args).pipe(Effect.mapError(e => new EditorServerError({ code: "PeaksFailed", message: `Cannot start ${options.ffmpegPath}: ${e.message}` })));
    const stderr = yield* handle.stderr.pipe(
      Stream.runFold(() => Buffer.alloc(0), (tail, chunk) => Buffer.concat([tail, chunk]).subarray(-STDERR_TAIL_BYTES)),
      Effect.orElseSucceed(() => Buffer.from("(stderr unavailable)")), Effect.forkScoped);
    const peaksAccumulator = new PeakAccumulator(identity.samplesPerBucket);
    const speechAccumulator = new SpeechAccumulator(speech.frameSamples);
    yield* handle.stdout.pipe(Stream.runForEach(chunk => Effect.sync(() => { peaksAccumulator.push(chunk); speechAccumulator.push(chunk); })),
      Effect.mapError(e => new EditorServerError({ code: "PeaksFailed", message: `Cannot read decoded audio from ffmpeg: ${e.message}` })));
    const exitCode = yield* handle.exitCode.pipe(Effect.mapError(e => new EditorServerError({ code: "PeaksFailed", message: `ffmpeg did not report an exit code: ${e.message}` })));
    const errorText = (yield* Fiber.join(stderr)).toString("utf8").trim();
    if (exitCode !== 0) return yield* fail("PeaksFailed", `ffmpeg exited with code ${exitCode} while decoding ${options.audioPath}. ${errorText}`);
    const reduced = yield* Effect.try({ try: () => ({ peaks: peaksAccumulator.finish(), frames: speechAccumulator.finish() }), catch: e => new EditorServerError({ code: "PeaksFailed", message: (e as Error).message }) });
    if (reduced.peaks.sampleCount !== identity.sampleCount) return yield* fail("PeaksFailed", `ffmpeg decoded ${reduced.peaks.sampleCount} samples but the verified clip has ${identity.sampleCount}: ${options.audioPath}.`);
    const frameMs = (speech.frameSamples / speech.sampleRateHz) * 1000;
    const regions = detectRegions(reduced.frames.framesDbfs, { frameSamples: speech.frameSamples, thresholdDbfs: speech.thresholdDbfs,
      minSilenceFrames: Math.round(speech.minSilenceMs / frameMs), minSpeechFrames: Math.round(speech.minSpeechMs / frameMs) }, identity.sampleCount);
    return {
      peaks: { schemaVersion: 1, audioSha256: identity.audioSha256, sampleRateHz: identity.sampleRateHz, sampleCount: identity.sampleCount, samplesPerBucket: identity.samplesPerBucket, min: reduced.peaks.min, max: reduced.peaks.max } satisfies PeaksFile,
      speech: { schemaVersion: 1, kind: "speech-regions", audioSha256: speech.audioSha256, sampleRateHz: speech.sampleRateHz, sampleCount: speech.sampleCount, frameSamples: speech.frameSamples,
        thresholdDbfs: speech.thresholdDbfs, minSilenceMs: speech.minSilenceMs, minSpeechMs: speech.minSpeechMs, regions } satisfies SpeechFile,
    };
  }));
}

/** A cached speech file, only when it parses and every pin (audio hash, clock, frame size, and the three detection parameters) matches; anything else means recompute. */
export function readSpeechCache(path: string, maxBytes: number, identity: SpeechIdentity): Effect.Effect<Option.Option<SpeechFile>, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(path))) return Option.none();
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(yield* readBounded(path, maxBytes))) as unknown;
    const speech = yield* Schema.decodeUnknownEffect(SpeechFile, { onExcessProperty: "error" })(raw);
    const pinned = (Object.keys(identity) as Array<keyof SpeechIdentity>).every(k => speech[k] === identity[k])
      && speech.regions.every((r, i) => r.startSample < r.endSample && r.endSample <= speech.sampleCount && (i === 0 || r.startSample >= speech.regions[i - 1]!.endSample));
    return pinned ? Option.some(speech) : Option.none<SpeechFile>();
  }).pipe(Effect.catch(() => Effect.succeed(Option.none<SpeechFile>())), Effect.catchDefect(() => Effect.succeed(Option.none<SpeechFile>())));
}

/** A cached peaks file, only when it parses and every pin matches the expected identity; anything else means recompute. */
export function readPeaksCache(path: string, maxBytes: number, identity: PeaksIdentity): Effect.Effect<Option.Option<PeaksFile>, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(path))) return Option.none();
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(yield* readBounded(path, maxBytes))) as unknown;
    const peaks = yield* Schema.decodeUnknownEffect(PeaksFile, { onExcessProperty: "error" })(raw);
    const buckets = Math.ceil(identity.sampleCount / identity.samplesPerBucket);
    const pinned = peaks.audioSha256 === identity.audioSha256 && peaks.sampleRateHz === identity.sampleRateHz && peaks.sampleCount === identity.sampleCount
      && peaks.samplesPerBucket === identity.samplesPerBucket && peaks.min.length === buckets && peaks.max.length === buckets;
    return pinned ? Option.some(peaks) : Option.none<PeaksFile>();
  }).pipe(Effect.catch(() => Effect.succeed(Option.none<PeaksFile>())), Effect.catchDefect(() => Effect.succeed(Option.none<PeaksFile>())));
}

/** Compact JSON through a sibling temp file and rename; a reader never sees a partial cache. */
export function writeCache(path: string, value: PeaksFile | SpeechFile): Effect.Effect<void, EditorServerError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(dirname(path), { recursive: true });
    yield* writeAtomic(path, Buffer.from(`${JSON.stringify(value)}\n`));
  }).pipe(Effect.mapError(e => new EditorServerError({ code: "IoFailed", message: e.message })));
}
