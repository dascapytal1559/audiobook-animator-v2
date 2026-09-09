import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Effect, Schema } from "effect";
import { RevDemoConfig, TranscriptionError, TranscriptionInput } from "./contracts.js";

export interface DemoInput {
  readonly config: RevDemoConfig;
  readonly input: TranscriptionInput;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly provenance: unknown;
  readonly provenanceSha256: string;
  readonly signature: string;
}

export const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

export function readJson(path: string, maxBytes: number): Effect.Effect<{ readonly value: unknown; readonly text: string } | undefined, TranscriptionError> {
  return Effect.tryPromise({
    try: async () => {
      try {
        if ((await stat(path)).size > maxBytes) throw new Error("Artifact exceeds its configured read limit.");
        const text = await readFile(path, "utf8");
        return { value: JSON.parse(text) as unknown, text };
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
        throw error;
      }
    },
    catch: () => new TranscriptionError({ code: "ArtifactIoFailed", message: `Cannot read bounded JSON artifact ${path}.` }),
  });
}

/** Sync file contents before the rename so a returned job ID survives a normal process restart. */
export function writeArtifact(path: string, text: string, exclusive = false): Effect.Effect<boolean, TranscriptionError> {
  return Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(path), { recursive: true });
      const temporary = exclusive ? path : `${path}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporary, "wx", 0o600);
        try { await handle.writeFile(text, "utf8"); await handle.sync(); } finally { await handle.close(); }
        if (!exclusive) await rename(temporary, path);
        const directory = await open(dirname(path), "r");
        try { await directory.sync(); } finally { await directory.close(); }
        return true;
      } catch (error) {
        if (exclusive && typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") return false;
        throw error;
      } finally {
        if (!exclusive) await rm(temporary, { force: true });
      }
    },
    catch: () => new TranscriptionError({ code: "ArtifactIoFailed", message: `Cannot save artifact ${path}.` }),
  });
}

export const writeJson = (path: string, value: unknown, exclusive = false): Effect.Effect<boolean, TranscriptionError> =>
  writeArtifact(path, `${JSON.stringify(value, null, 2)}\n`, exclusive);

export function loadDemoInput(configPath: string): Effect.Effect<DemoInput, TranscriptionError> {
  return Effect.gen(function* () {
    const configFile = yield* readJson(resolve(configPath), 64 * 1024);
    if (!configFile) return yield* Effect.fail(new TranscriptionError({ code: "InvalidConfig", message: "The required demo config file does not exist." }));
    const decoded = yield* Schema.decodeUnknownEffect(RevDemoConfig, { onExcessProperty: "error" })(configFile.value).pipe(
      Effect.mapError(() => new TranscriptionError({ code: "InvalidConfig", message: "Rev demo config is invalid. Supply all explicit paths, provider settings, and positive limits; this demo allows at most 120 seconds and 32 MiB." })),
    );
    const base = dirname(resolve(configPath));
    const config: RevDemoConfig = { ...decoded,
      inputPath: resolve(base, decoded.inputPath), provenancePath: resolve(base, decoded.provenancePath),
      artifactDirectory: resolve(base, decoded.artifactDirectory),
    };
    const provenance = yield* readJson(config.provenancePath, config.maxResponseBytes);
    if (!provenance) return yield* Effect.fail(new TranscriptionError({ code: "InvalidProvenance", message: "The demo requires an input provenance artifact." }));
    const document = yield* Schema.decodeUnknownEffect(Schema.Struct({ transcriptionInput: TranscriptionInput }))(provenance.value).pipe(
      Effect.mapError(() => new TranscriptionError({ code: "InvalidProvenance", message: "Provenance must contain the transcriptionInput block with content hashes, duration, and source clock mapping." })),
    );
    const input = document.transcriptionInput;
    if (input.durationSeconds > config.maxClipDurationSeconds || input.byteLength > config.maxInputBytes) {
      return yield* Effect.fail(new TranscriptionError({ code: "DemoLimitExceeded", message: "Input exceeds the configured small-demo duration or byte limit." }));
    }
    const bytes = yield* Effect.tryPromise({
      try: async () => {
        const inputRealPath = await realpath(config.inputPath);
        const provenanceRealPath = await realpath(resolve(dirname(config.provenancePath), input.path));
        const info = await stat(inputRealPath);
        if (inputRealPath !== provenanceRealPath || !info.isFile() || info.size !== input.byteLength || info.size > config.maxInputBytes) {
          throw new TranscriptionError({ code: "InputMismatch", message: "Input path or size does not match the prepared clip provenance." });
        }
        const data = Uint8Array.from(await readFile(inputRealPath));
        if (data.length !== input.byteLength || sha256(data) !== input.sha256) throw new TranscriptionError({ code: "InputMismatch", message: "Input bytes do not match the prepared clip SHA-256." });
        return data;
      },
      catch: (error) => error instanceof TranscriptionError ? error : new TranscriptionError({ code: "InputReadFailed", message: "Cannot read the prepared demo clip." }),
    });
    const signature = sha256(JSON.stringify({
      provider: "rev-ai", apiBaseUrl: config.apiBaseUrl, transcriber: config.transcriber, language: config.language,
      clipSha256: input.sha256, sourceSha256: input.sourceSha256, sourceStartSeconds: input.sourceStartSeconds,
      sourceClock: input.sourceClock, durationSeconds: input.durationSeconds,
    }));
    return { config, input, bytes, signature, provenance: provenance.value, provenanceSha256: sha256(provenance.text) };
  });
}
