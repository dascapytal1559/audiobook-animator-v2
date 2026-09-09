import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { Effect, FileSystem, Fiber, Option, Schema, Stream } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/unstable/process";
import { readBounded } from "../story-planning/io.js";
import { EditorServerError, PeaksFile } from "./contracts.js";
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

/** Decode with ffmpeg to mono s16le on stdout and reduce it as it streams; nothing but the peaks and a bounded stderr tail is held in memory. */
export function computePeaks(options: { readonly ffmpegPath: string; readonly audioPath: string; readonly identity: PeaksIdentity }): Effect.Effect<PeaksFile, EditorServerError, ChildProcessSpawner.ChildProcessSpawner> {
  const { identity } = options;
  return Effect.scoped(Effect.gen(function* () {
    const args = ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", options.audioPath, "-f", "s16le", "-ac", "1", "-"];
    const handle = yield* ChildProcess.make(options.ffmpegPath, args).pipe(Effect.mapError(e => new EditorServerError({ code: "PeaksFailed", message: `Cannot start ${options.ffmpegPath}: ${e.message}` })));
    const stderr = yield* handle.stderr.pipe(
      Stream.runFold(() => Buffer.alloc(0), (tail, chunk) => Buffer.concat([tail, chunk]).subarray(-STDERR_TAIL_BYTES)),
      Effect.orElseSucceed(() => Buffer.from("(stderr unavailable)")), Effect.forkScoped);
    const accumulator = new PeakAccumulator(identity.samplesPerBucket);
    yield* handle.stdout.pipe(Stream.runForEach(chunk => Effect.sync(() => accumulator.push(chunk))),
      Effect.mapError(e => new EditorServerError({ code: "PeaksFailed", message: `Cannot read decoded audio from ffmpeg: ${e.message}` })));
    const exitCode = yield* handle.exitCode.pipe(Effect.mapError(e => new EditorServerError({ code: "PeaksFailed", message: `ffmpeg did not report an exit code: ${e.message}` })));
    const errorText = (yield* Fiber.join(stderr)).toString("utf8").trim();
    if (exitCode !== 0) return yield* fail("PeaksFailed", `ffmpeg exited with code ${exitCode} while decoding ${options.audioPath}. ${errorText}`);
    const reduced = yield* Effect.try({ try: () => accumulator.finish(), catch: e => new EditorServerError({ code: "PeaksFailed", message: (e as Error).message }) });
    if (reduced.sampleCount !== identity.sampleCount) return yield* fail("PeaksFailed", `ffmpeg decoded ${reduced.sampleCount} samples but the verified clip has ${identity.sampleCount}: ${options.audioPath}.`);
    return { schemaVersion: 1, audioSha256: identity.audioSha256, sampleRateHz: identity.sampleRateHz, sampleCount: identity.sampleCount,
      samplesPerBucket: identity.samplesPerBucket, min: reduced.min, max: reduced.max } satisfies PeaksFile;
  }));
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
export function writePeaksCache(path: string, peaks: PeaksFile): Effect.Effect<void, EditorServerError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
    yield* fs.writeFile(temp, Buffer.from(`${JSON.stringify(peaks)}\n`), { flag: "wx" });
    yield* fs.rename(temp, path).pipe(Effect.onError(() => fs.remove(temp).pipe(Effect.ignore)));
  }).pipe(Effect.mapError(e => new EditorServerError({ code: "IoFailed", message: `Cannot write ${path}: ${e.message}` })));
}
