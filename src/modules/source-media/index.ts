import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Effect, FileSystem, Option, Schema, Stream } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import {
  SourceMediaError,
  SourceMediaRequest,
  type SourceFileStat,
  type SourceMediaInspection,
} from "./contracts.js";
import { parseFfprobeOutput } from "./probe.js";

export { SourceMediaError, SourceMediaRequest } from "./contracts.js";
export type { SourceMediaInspection, SourceMediaErrorCode } from "./contracts.js";

function fileError(error: PlatformError): SourceMediaError {
  return new SourceMediaError({
    code: error.reason._tag === "NotFound" ? "SourceNotFound" : "SourceReadFailed",
    message: error.message,
  });
}

function snapshot(info: FileSystem.File.Info): SourceFileStat {
  return {
    byteLength: String(info.size), device: info.dev, inode: Option.getOrNull(info.ino),
    modifiedAt: Option.isSome(info.mtime) ? info.mtime.value.toISOString() : null,
  };
}

function collectOutput(
  stream: Stream.Stream<Uint8Array, PlatformError>,
  byteLimit: number,
  channel: "stdout" | "stderr",
) {
  return Stream.runFoldEffect(stream, () => ({ parts: [] as Buffer[], byteLength: 0 }), (state, part) => {
    if (state.byteLength + part.byteLength > byteLimit) {
      return Effect.fail(new SourceMediaError({ code: "ProbeOutputLimit", message: `ffprobe ${channel} exceeded its configured byte limit.`, details: { channel, byteLimit } }));
    }
    state.parts.push(Buffer.from(part));
    state.byteLength += part.byteLength;
    return Effect.succeed(state);
  }).pipe(Effect.map((state) => Buffer.concat(state.parts, state.byteLength).toString("utf8")));
}

/** Inspection only: no audio is cut, metadata is optional evidence, and no story mapping is inferred. */
export function inspectSourceMedia(
  request: SourceMediaRequest,
): Effect.Effect<SourceMediaInspection, SourceMediaError, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function* () {
    const options = yield* Schema.decodeUnknownEffect(SourceMediaRequest)(request).pipe(
      Effect.mapError(() => new SourceMediaError({ code: "InvalidRequest", message: "Source inspection requires nonempty paths, positive integer operational limits, and a nonnegative finite comparison tolerance." })),
    );
    const fs = yield* FileSystem.FileSystem;
    const absolutePath = resolve(options.sourcePath);
    const realPath = yield* fs.realPath(absolutePath).pipe(Effect.mapError(fileError));
    const before = yield* fs.stat(realPath).pipe(Effect.mapError(fileError));
    if (before.type !== "File") return yield* Effect.fail(new SourceMediaError({ code: "NotRegularFile", message: "The source path must identify a regular local file.", details: { path: realPath, type: before.type } }));
    const sourceStat = snapshot(before);
    const args = ["-v", "error", "-protocol_whitelist", "file", "-show_streams", "-show_format", "-show_chapters", "-print_format", "json", "-i", realPath];

    const probe = Effect.scoped(Effect.gen(function* () {
      const process = yield* ChildProcess.make(options.ffprobePath, args, {
        shell: false, detached: false, windowsHide: true,
        stdin: "ignore", stdout: "pipe", stderr: "pipe",
        env: { LC_ALL: "C" }, extendEnv: true,
        killSignal: "SIGTERM", forceKillAfter: 1_000,
      }).pipe(Effect.mapError((error) => new SourceMediaError({
        code: error.reason._tag === "NotFound" ? "ProbeUnavailable" : "ProbeFailed", message: error.message,
      })));
      const result = yield* Effect.all({
        stdout: collectOutput(process.stdout, options.maxProbeOutputBytes, "stdout"),
        stderr: collectOutput(process.stderr, options.maxProbeErrorBytes, "stderr"),
        exitCode: process.exitCode,
      }, { concurrency: 3 }).pipe(Effect.mapError((error) => error instanceof SourceMediaError ? error : new SourceMediaError({ code: "ProbeFailed", message: error.message })));
      if (result.exitCode !== 0) return yield* Effect.fail(new SourceMediaError({ code: "ProbeFailed", message: `ffprobe exited with status ${result.exitCode}.`, details: { exitCode: result.exitCode, stderr: result.stderr } }));
      return result;
    })).pipe(Effect.timeoutOrElse({
      duration: options.probeTimeoutMs,
      orElse: () => Effect.fail(new SourceMediaError({ code: "ProbeTimedOut", message: "ffprobe exceeded its configured timeout.", details: { timeoutMs: options.probeTimeoutMs } })),
    }));
    const hash = Stream.runFold(
      fs.stream(realPath, { chunkSize: options.hashChunkBytes, offset: 0 }),
      () => ({ hash: createHash("sha256"), bytes: 0n }),
      (state, bytes) => { state.hash.update(bytes); state.bytes += BigInt(bytes.byteLength); return state; },
    ).pipe(
      Effect.mapError(fileError),
      Effect.flatMap((state) => state.bytes === before.size
        ? Effect.succeed(state.hash.digest("hex"))
        : Effect.fail(new SourceMediaError({ code: "SourceChanged", message: "The number of bytes read changed during source inspection." }))),
    );
    const result = yield* Effect.all({ sha256: hash, probe }, { concurrency: 2 });
    const afterRealPath = yield* fs.realPath(absolutePath).pipe(Effect.mapError(fileError));
    const after = yield* fs.stat(realPath).pipe(Effect.mapError(fileError));
    // These checks detect ordinary edits/replacements; a hash remains the durable content identity.
    if (afterRealPath !== realPath || after.type !== "File" || JSON.stringify(snapshot(after)) !== JSON.stringify(sourceStat)) {
      return yield* Effect.fail(new SourceMediaError({ code: "SourceChanged", message: "The source changed while hashing or probing; rerun inspection on a stable file." }));
    }
    const media = yield* parseFfprobeOutput(result.probe.stdout, options);
    const reportedSize = media.format["size"];
    if (typeof reportedSize === "string" && /^\d+$/.test(reportedSize) && BigInt(reportedSize) !== before.size) {
      return yield* Effect.fail(new SourceMediaError({ code: "SourceChanged", message: "ffprobe's source size differs from the file that was hashed." }));
    }
    return {
      schemaVersion: 1,
      source: { requestedPath: options.sourcePath, absolutePath, realPath, sha256: result.sha256, stat: sourceStat },
      probe: { executable: options.ffprobePath, arguments: args, stderr: result.probe.stderr },
      ...media,
    };
  });
}
