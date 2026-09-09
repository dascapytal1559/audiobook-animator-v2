import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readdir, rm, rmdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Effect, FileSystem, Schema, Stream } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { inspectSourceMedia, type SourceMediaError, type SourceMediaInspection } from "../source-media/index.js";
import { encoding, StoryAudioError, StoryAudioManifest, StoryAudioRequest, type ExtractionIdentity, type StoryAudioResult } from "./contracts.js";

export { StoryAudioError, StoryAudioManifest, StoryAudioRequest, DecodedSampleInterval } from "./contracts.js";
export type { StoryAudioResult } from "./contracts.js";

type Services = FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner;
type ExtractionError = StoryAudioError | SourceMediaError;
const hasCode = (error: unknown, code: string): boolean => typeof error === "object" && error !== null && "code" in error && error.code === code;
const json = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const executablePath = (path: string): string => !isAbsolute(path) && path.includes("/") ? resolve(path) : path;
const io = <A>(operation: () => Promise<A>, message: string) => Effect.tryPromise({
  try: operation,
  catch: (error) => error instanceof StoryAudioError ? error : new StoryAudioError({ code: "ArtifactIoFailed", message }),
});

function consume(stream: Stream.Stream<Uint8Array, PlatformError>, maxBytes: bigint, capture: boolean, channel: string) {
  return Stream.runFoldEffect(stream, () => ({ parts: [] as Buffer[], byteLength: 0n, hash: createHash("sha256") }), (state, part) => {
    state.byteLength += BigInt(part.byteLength);
    if (state.byteLength > maxBytes) return Effect.fail(new StoryAudioError({ code: "ProcessOutputLimit", message: `FFmpeg ${channel} exceeded its configured byte limit.` }));
    state.hash.update(part);
    if (capture) state.parts.push(Buffer.from(part));
    return Effect.succeed(state);
  }).pipe(
    Effect.map((state) => ({ text: capture ? Buffer.concat(state.parts).toString("utf8") : "", byteLength: state.byteLength, sha256: state.hash.digest("hex") })),
    Effect.mapError((error) => error instanceof StoryAudioError ? error : new StoryAudioError({ code: "ProcessFailed", message: error.message })),
  );
}

function runFfmpeg(request: StoryAudioRequest, args: ReadonlyArray<string>, timeoutMs: number, maxStdoutBytes: bigint, captureStdout: boolean) {
  return Effect.scoped(Effect.gen(function* () {
    const process = yield* ChildProcess.make(request.ffmpegPath, args, {
      shell: false, detached: false, windowsHide: true, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { LC_ALL: "C" }, extendEnv: true, killSignal: "SIGTERM", forceKillAfter: 1_000,
    }).pipe(Effect.mapError((error) => new StoryAudioError({ code: error.reason._tag === "NotFound" ? "ProcessUnavailable" : "ProcessFailed", message: error.message })));
    const result = yield* Effect.all({
      stdout: consume(process.stdout, maxStdoutBytes, captureStdout, "stdout"),
      stderr: consume(process.stderr, BigInt(request.maxProcessErrorBytes), true, "stderr"),
      exitCode: process.exitCode.pipe(Effect.mapError((error) => new StoryAudioError({ code: "ProcessFailed", message: error.message }))),
    }, { concurrency: 3 });
    if (result.exitCode !== 0) return yield* Effect.fail(new StoryAudioError({ code: "ProcessFailed", message: `FFmpeg exited with status ${result.exitCode}.`, details: { stderr: result.stderr.text } }));
    return result.stdout;
  })).pipe(Effect.timeoutOrElse({ duration: timeoutMs, orElse: () => Effect.fail(new StoryAudioError({ code: "ProcessTimedOut", message: "FFmpeg exceeded its configured timeout." })) }));
}

function inspectionRequest(request: StoryAudioRequest, sourcePath: string, audioStreamIndex: number) {
  return { ...request.inspection, sourcePath, audioStreamIndex };
}

function extractionContent(identity: ExtractionIdentity) {
  const { sourcePath: _sourcePath, ...request } = identity.request;
  const { realPath: _realPath, ...source } = identity.source;
  return { ...identity, request, source };
}

function checkSource(request: StoryAudioRequest, inspection: SourceMediaInspection) {
  if (inspection.source.sha256 !== request.expectedSource.sha256 || inspection.source.stat.byteLength !== String(request.expectedSource.byteLength)) {
    return Effect.fail(new StoryAudioError({ code: "SourceMismatch", message: "The source does not match the pinned SHA-256 and byte length." }));
  }
  const { sampleRateHz, channels } = inspection.audio;
  if (sampleRateHz === null || channels === null || !Number.isSafeInteger(sampleRateHz) || sampleRateHz <= 0 || !Number.isSafeInteger(channels) || channels <= 0) {
    return Effect.fail(new StoryAudioError({ code: "UnsupportedSource", message: "The selected audio stream must have a known positive integer sample rate and channel count." }));
  }
  return Effect.succeed({ realPath: inspection.source.realPath, sha256: inspection.source.sha256, byteLength: request.expectedSource.byteLength, audioStreamIndex: request.audioStreamIndex, sampleRateHz, channels });
}

/** One bounded handle read avoids trusting a stale size check on a growing manifest. */
function readManifest(path: string, maxBytes: number) {
  return io(async () => {
    const handle = await open(path, "r");
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > maxBytes) throw new StoryAudioError({ code: "ArtifactMismatch", message: "The existing manifest is not a bounded regular file." });
      const buffer = Buffer.alloc(maxBytes + 1);
      let total = 0;
      while (total <= maxBytes) {
        const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
        if (bytesRead === 0) break;
        total += bytesRead;
      }
      const after = await handle.stat();
      if (total > maxBytes || before.size !== total || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new StoryAudioError({ code: "ArtifactMismatch", message: "The existing manifest changed or exceeds its byte limit." });
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, total))) as unknown;
    } finally { await handle.close(); }
  }, "Cannot read the existing extraction manifest. Preserve the directory and reconcile its incomplete or corrupted artifacts.");
}

function verificationArguments(path: string): ReadonlyArray<string> {
  return ["-hide_banner", "-nostdin", "-nostats", "-v", "error", "-xerror", "-protocol_whitelist", "file", "-i", path,
    "-map", "0:0", "-vn", "-sn", "-dn", "-c:a", "pcm_s24le", "-f", "s24le", "pipe:1"];
}

function verifyOutput(request: StoryAudioRequest, identity: ExtractionIdentity, path: string) {
  return Effect.gen(function* () {
    const info = yield* io(() => stat(path), "Cannot inspect the extracted audio file.");
    if (!info.isFile() || info.size <= 0 || info.size > request.maxOutputBytes) return yield* Effect.fail(new StoryAudioError({ code: "InvalidOutput", message: "The output must be a nonempty regular file within the configured byte limit." }));
    const inspection = yield* inspectSourceMedia(inspectionRequest(request, path, 0)).pipe(
      Effect.mapError((error) => new StoryAudioError({ code: "InvalidOutput", message: `Cannot verify extracted audio: ${error.code}.` })),
    );
    const { sampleRateHz, channels } = identity.source;
    if (inspection.audio.codec !== "flac" || inspection.audioStreamIndices.length !== 1 || inspection.audio.sampleRateHz !== sampleRateHz
      || inspection.audio.channels !== channels || String(inspection.audio.raw["bits_per_raw_sample"]) !== "24") {
      return yield* Effect.fail(new StoryAudioError({ code: "InvalidOutput", message: "The output is not FLAC24 at the selected source stream's sample rate and channel count." }));
    }
    const sampleCount = request.interval.endSample - request.interval.startSample;
    const expectedBytes = BigInt(sampleCount) * BigInt(channels) * 3n;
    const decoded = yield* runFfmpeg(request, verificationArguments(path), request.verificationTimeoutMs, expectedBytes, false);
    if (decoded.byteLength !== expectedBytes) return yield* Effect.fail(new StoryAudioError({ code: "InvalidOutput", message: "Decoded output has the wrong sample count; the requested interval may extend beyond the source." }));
    const after = yield* io(() => stat(path), "Cannot recheck the verified audio file.");
    if (info.size !== after.size || info.ino !== after.ino || info.mtimeMs !== after.mtimeMs || info.ctimeMs !== after.ctimeMs) return yield* Effect.fail(new StoryAudioError({ code: "InvalidOutput", message: "Extracted audio changed during verification." }));
    return { filename: "audio.flac" as const, sha256: inspection.source.sha256, byteLength: Number(inspection.source.stat.byteLength),
      codec: "flac" as const, bitsPerSample: 24 as const, sampleRateHz, channels, sampleCount, decodedPcmSha256: decoded.sha256 };
  });
}

/** Extract a caller-validated interval; this module neither discovers nor approves story boundaries. */
export function extractStoryAudio(rawRequest: StoryAudioRequest): Effect.Effect<StoryAudioResult, ExtractionError, Services> {
  return Effect.scoped(Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(StoryAudioRequest, { onExcessProperty: "error" })(rawRequest).pipe(
      Effect.mapError(() => new StoryAudioError({ code: "InvalidRequest", message: "Supply the pinned source, explicit tools and limits, and safe integer sample bounds." })),
    );
    if (decoded.interval.endSample <= decoded.interval.startSample) return yield* Effect.fail(new StoryAudioError({ code: "InvalidRequest", message: "The end-exclusive sample bound must be greater than the inclusive start sample." }));
    const request: StoryAudioRequest = { ...decoded, sourcePath: resolve(decoded.sourcePath), artifactDirectory: resolve(decoded.artifactDirectory),
      ffmpegPath: executablePath(decoded.ffmpegPath), inspection: { ...decoded.inspection, ffprobePath: executablePath(decoded.inspection.ffprobePath) } };
    const sourceInfo = yield* io(() => stat(request.sourcePath), "Cannot inspect the pinned source file.");
    if (!sourceInfo.isFile() || sourceInfo.size !== request.expectedSource.byteLength) return yield* Effect.fail(new StoryAudioError({ code: "SourceMismatch", message: "The source is not a regular file with the pinned byte length." }));
    const sourceInspection = yield* inspectSourceMedia(inspectionRequest(request, request.sourcePath, request.audioStreamIndex));
    const source = yield* checkSource(request, sourceInspection);
    const version = yield* runFfmpeg(request, ["-version"], request.verificationTimeoutMs, BigInt(request.maxProcessOutputBytes), true);
    if (!version.text.trim()) return yield* Effect.fail(new StoryAudioError({ code: "ProcessFailed", message: "FFmpeg returned no version information for the extraction record." }));
    const identity: ExtractionIdentity = { request, source, encoding, ffmpegVersion: version.text };
    const identitySha256 = hash(json(identity));
    const audioPath = join(request.artifactDirectory, "audio.flac");
    const manifestPath = join(request.artifactDirectory, "manifest.json");
    const exists = yield* io(async () => {
      try { await readdir(request.artifactDirectory); return true; } catch (error) { if (hasCode(error, "ENOENT")) return false; throw error; }
    }, "Cannot inspect the extraction artifact directory.");
    if (exists) {
      const raw = yield* readManifest(manifestPath, request.maxManifestBytes);
      const manifest = yield* Schema.decodeUnknownEffect(StoryAudioManifest, { onExcessProperty: "error" })(raw).pipe(
        Effect.mapError(() => new StoryAudioError({ code: "ArtifactMismatch", message: "The existing extraction manifest is invalid. Preserve its artifacts for reconciliation." })),
      );
      const { manifestSha256, ...savedRecord } = manifest;
      if (manifestSha256 !== hash(json(savedRecord))) return yield* Effect.fail(new StoryAudioError({ code: "ArtifactMismatch", message: "The extraction manifest no longer matches its saved checksum." }));
      if (manifest.identitySha256 !== hash(json(manifest.identity)) || !json(extractionContent(manifest.identity)).equals(json(extractionContent(identity)))) return yield* Effect.fail(new StoryAudioError({ code: "ArtifactMismatch", message: "The saved identity checksum differs, or the artifact directory belongs to different source bytes, interval, tool version, or explicit configuration. Only the source locator may change." }));
      const output = yield* verifyOutput(request, identity, audioPath);
      if (!json(output).equals(json(manifest.output))) return yield* Effect.fail(new StoryAudioError({ code: "ArtifactMismatch", message: "The saved audio no longer matches its verified content identity." }));
      return { audioPath, manifestPath, reused: true, manifest };
    }
    const stagedAudio = join(request.artifactDirectory, `.audio-${randomUUID()}.flac`);
    const stagedManifest = join(request.artifactDirectory, `.manifest-${randomUUID()}.json`);
    yield* Effect.acquireRelease(
      io(async () => {
        await mkdir(dirname(request.artifactDirectory), { recursive: true });
        try { await mkdir(request.artifactDirectory); } catch (error) {
          if (hasCode(error, "EEXIST")) throw new StoryAudioError({ code: "ArtifactMismatch", message: "Another operation created this artifact directory. No extraction was started." });
          throw error;
        }
      }, "Cannot reserve the extraction artifact directory."),
      () => Effect.promise(async () => {
        await rm(stagedAudio, { force: true });
        await rm(stagedManifest, { force: true });
        try { await rmdir(request.artifactDirectory); } catch (error) { if (!hasCode(error, "ENOTEMPTY") && !hasCode(error, "ENOENT") && !hasCode(error, "EEXIST")) throw error; }
      }),
    );
    // A sample trim can leave a first frame shorter than FLAC's minimum block size.
    // Explicit encoder framing avoids inheriting that size; the final frame is not padded.
    const args = ["-hide_banner", "-nostdin", "-nostats", "-v", "error", "-xerror", "-n", "-protocol_whitelist", "file", "-i", source.realPath,
      "-map", `0:${request.audioStreamIndex}`, "-vn", "-sn", "-dn", "-af", `atrim=start_sample=${request.interval.startSample}:end_sample=${request.interval.endSample},asetpts=PTS-STARTPTS`,
      "-c:a", "flac", "-compression_level", "5", "-frame_size", "4608", "-sample_fmt", "s32", "-bits_per_raw_sample", "24", "-ar", String(source.sampleRateHz), "-ac", String(source.channels),
      "-threads:a", "1", "-map_metadata", "-1", "-map_chapters", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", "-fs", String(request.maxOutputBytes), "-f", "flac", stagedAudio];
    yield* runFfmpeg(request, args, request.extractionTimeoutMs, BigInt(request.maxProcessOutputBytes), true);
    const output = yield* verifyOutput(request, identity, stagedAudio);
    const sourceAfter = yield* inspectSourceMedia(inspectionRequest(request, request.sourcePath, request.audioStreamIndex)).pipe(
      Effect.mapError(() => new StoryAudioError({ code: "SourceChanged", message: "The original source could not be verified after extraction." })),
    );
    if (sourceAfter.source.sha256 !== source.sha256 || sourceAfter.source.realPath !== source.realPath || JSON.stringify(sourceAfter.source.stat) !== JSON.stringify(sourceInspection.source.stat)) {
      return yield* Effect.fail(new StoryAudioError({ code: "SourceChanged", message: "The original source changed while extracting; no completed result was published." }));
    }
    const record = {
      schemaVersion: 1 as const, kind: "verified-story-audio" as const, identity, identitySha256,
      precision: "The interval uses integer samples per channel on FFmpeg's decoded-audio clock, with an inclusive start and exclusive end. No seconds are rounded and no container/chapter/provider clock mapping is implied. FLAC stores the explicitly converted 24-bit PCM without further perceptual compression.",
      extraction: { executable: request.ffmpegPath, arguments: args },
      verification: { executable: request.ffmpegPath, arguments: verificationArguments(stagedAudio), decodedFormat: "s24le" as const }, output,
    };
    const manifest: StoryAudioManifest = { ...record, manifestSha256: hash(json(record)) };
    const manifestBytes = json(manifest);
    if (manifestBytes.byteLength > request.maxManifestBytes) return yield* Effect.fail(new StoryAudioError({ code: "ArtifactIoFailed", message: "The extraction manifest exceeds its explicit byte limit." }));
    yield* io(async () => {
      const handle = await open(stagedManifest, "wx", 0o600);
      try { await handle.writeFile(manifestBytes); await handle.sync(); } finally { await handle.close(); }
      const audio = await open(stagedAudio, "r");
      try { await audio.sync(); } finally { await audio.close(); }
      await link(stagedAudio, audioPath);
      await link(stagedManifest, manifestPath);
      const directory = await open(request.artifactDirectory, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    }, "Cannot publish the verified audio and its completion manifest. Existing files were not replaced.");
    return { audioPath, manifestPath, reused: false, manifest };
  }));
}
