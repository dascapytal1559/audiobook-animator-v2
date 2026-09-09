import { dirname, isAbsolute, join, resolve } from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { inspectSourceMedia, type SourceMediaError, type SourceMediaInspection } from "../source-media/index.js";
import { sha256 } from "./content-hash.js";
import { JobId, type TranscriptionError } from "./contracts.js";
import { normalizeRevProviderTranscript, type ProviderTimedWord } from "./normalize.js";
import { jsonBytes, parseBookJson, readBookArtifact, retainBookArtifact } from "./book-artifacts.js";
import { BookPreparation, BookTranscriptionError, RevBookConfig, bookTiming, type BookPreparationResult, type BookSource, type BookTranscriptResult } from "./book-contracts.js";

export { BookTranscriptionError, RevBookConfig, BookPreparation } from "./book-contracts.js";
export type { BookPreparationResult, BookTranscriptResult } from "./book-contracts.js";

type Services = FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner;
type BookError = BookTranscriptionError | SourceMediaError | TranscriptionError;
const configLimit = 64 * 1024;
const manifestLimit = 1024 * 1024;

function loadBookConfig(configPath: string) {
  return Effect.gen(function* () {
    if (!configPath || configPath.includes("\0")) return yield* Effect.fail(new BookTranscriptionError({ code: "InvalidConfig", message: "Supply an explicit configuration path." }));
    const path = resolve(configPath);
    const bytes = yield* readBookArtifact(path, configLimit);
    if (!bytes) return yield* Effect.fail(new BookTranscriptionError({ code: "InvalidConfig", message: "The required whole-book configuration does not exist." }));
    const raw = yield* parseBookJson(bytes, "Whole-book configuration").pipe(
      Effect.mapError(() => new BookTranscriptionError({ code: "InvalidConfig", message: "Whole-book configuration must be valid UTF-8 JSON." })),
    );
    const config = yield* Schema.decodeUnknownEffect(RevBookConfig, { onExcessProperty: "error" })(raw).pipe(
      Effect.mapError(() => new BookTranscriptionError({ code: "InvalidConfig", message: "Invalid whole-book config. Supply the pinned source SHA-256 and byte length, explicit paths and inspection options, and limits within 17 hours, 2 GB, and 64 MiB of transcript JSON." })),
    );
    const base = dirname(path);
    const probe = config.inspection.ffprobePath;
    return {
      ...config, sourcePath: resolve(base, config.sourcePath), artifactDirectory: resolve(base, config.artifactDirectory),
      inspection: { ...config.inspection, ffprobePath: !isAbsolute(probe) && probe.includes("/") ? resolve(base, probe) : probe },
    };
  });
}

function resultFromPreparation(preparation: BookPreparation, currentSourcePath: string): BookPreparationResult {
  return {
    currentSourcePath,
    preparationPath: join(preparation.config.artifactDirectory, "preparation.json"),
    inspectionPath: preparation.inspection.path, artifactDirectory: preparation.config.artifactDirectory,
    signature: preparation.signature, source: preparation.source, timing: bookTiming,
  };
}

function preparationContent(preparation: BookPreparation) {
  const { signature: _signature, config, source, inspection, ...identity } = preparation;
  const { sourcePath: _sourcePath, ...configuration } = config;
  const { path: _path, realPath: _realPath, ...media } = source;
  return { ...identity, config: configuration, source: media, inspectionPath: inspection.path };
}

/** A file move changes these recorded locators, but not the media or probe contract. */
function inspectionContent(inspection: SourceMediaInspection) {
  const { requestedPath: _requestedPath, absolutePath: _absolutePath, realPath, stat, ...source } = inspection.source;
  const { device: _device, inode: _inode, modifiedAt: _modifiedAt, ...contentStat } = stat;
  const { filename: _filename, ...format } = inspection.format;
  const args = inspection.probe.arguments;
  if (args.at(-2) !== "-i" || args.at(-1) !== realPath) throw new Error("Inspection has an unexpected input argument.");
  return { ...inspection, source: { ...source, stat: contentStat }, format,
    probe: { ...inspection.probe, arguments: args.slice(0, -1) } };
}

function prepare(configPath: string): Effect.Effect<{ preparation: BookPreparation; currentSourcePath: string }, BookError, Services> {
  return Effect.gen(function* () {
    const config = yield* loadBookConfig(configPath);
    const fs = yield* FileSystem.FileSystem;
    const info = yield* fs.stat(config.sourcePath).pipe(
      Effect.mapError(() => new BookTranscriptionError({ code: "InputMismatch", message: "Cannot inspect the configured source file." })),
    );
    if (info.type !== "File" || info.size !== BigInt(config.expectedSource.byteLength)) {
      return yield* Effect.fail(new BookTranscriptionError({ code: "InputMismatch", message: "The source must be a regular file with the byte length pinned in the whole-book configuration." }));
    }
    if (info.size > BigInt(config.maxInputBytes)) return yield* Effect.fail(new BookTranscriptionError({ code: "InputLimitExceeded", message: "The complete source exceeds the configured byte limit." }));
    const inspection = yield* inspectSourceMedia({ ...config.inspection, sourcePath: config.sourcePath });
    const byteLength = Number(inspection.source.stat.byteLength);
    if (inspection.source.sha256 !== config.expectedSource.sha256 || byteLength !== config.expectedSource.byteLength) {
      return yield* Effect.fail(new BookTranscriptionError({ code: "InputMismatch", message: "The source bytes do not match the SHA-256 and byte length pinned in the whole-book configuration." }));
    }
    if (!inspection.duration) return yield* Effect.fail(new BookTranscriptionError({ code: "InvalidDuration", message: "Whole-book preparation requires a positive finite duration from the inspected audio stream or format." }));
    if (byteLength > config.maxInputBytes || inspection.duration.seconds > config.maxDurationSeconds) {
      return yield* Effect.fail(new BookTranscriptionError({ code: "InputLimitExceeded", message: "The complete source exceeds the configured whole-book byte or duration limit." }));
    }
    // A dashboard uploads the complete container. Do not imply that choosing a local stream
    // forces the provider to use it when multiple audio streams are present.
    if (inspection.audioStreamIndices.length !== 1) return yield* Effect.fail(new BookTranscriptionError({ code: "InputMismatch", message: "The dashboard whole-book importer requires exactly one audio stream in the submitted file." }));
    const source: BookSource = {
      path: inspection.source.absolutePath, realPath: inspection.source.realPath,
      sha256: inspection.source.sha256, byteLength, durationSeconds: inspection.duration.seconds, durationEvidence: inspection.duration.source,
      audio: { streamIndex: inspection.audio.index, codec: inspection.audio.codec, sampleRateHz: inspection.audio.sampleRateHz, channels: inspection.audio.channels, startTimeSeconds: inspection.audio.startTimeSeconds },
    };
    const inspectionBytes = jsonBytes(inspection);
    const inspectionPath = join(config.artifactDirectory, "source-inspection.json");
    const identity = {
      schemaVersion: 1 as const, kind: "whole-book-transcription-preparation" as const,
      provider: "rev-ai" as const, submissionMethod: "dashboard-export" as const,
      config, source, timing: bookTiming,
      inspection: { path: inspectionPath, sha256: sha256(inspectionBytes) },
    };
    const preparation = yield* Schema.decodeUnknownEffect(BookPreparation)({ ...identity, signature: sha256(jsonBytes(identity)) }).pipe(
      Effect.mapError(() => new BookTranscriptionError({ code: "InvalidDuration", message: "Inspected source evidence cannot form a valid whole-book preparation." })),
    );
    const preparationPath = join(config.artifactDirectory, "preparation.json");
    const existingBytes = yield* readBookArtifact(preparationPath, manifestLimit);
    if (existingBytes) {
      const raw = yield* parseBookJson(existingBytes, "Existing whole-book preparation").pipe(
        Effect.mapError(() => new BookTranscriptionError({ code: "ArtifactMismatch", message: "The existing whole-book preparation is not valid JSON." })),
      );
      const existing = yield* Schema.decodeUnknownEffect(BookPreparation, { onExcessProperty: "error" })(raw).pipe(
        Effect.mapError(() => new BookTranscriptionError({ code: "ArtifactMismatch", message: "The existing whole-book preparation has an invalid contract." })),
      );
      const { signature, ...savedIdentity } = existing;
      if (signature !== sha256(jsonBytes(savedIdentity)) || !jsonBytes(preparationContent(existing)).equals(jsonBytes(preparationContent(preparation)))) {
        return yield* Effect.fail(new BookTranscriptionError({ code: "ArtifactMismatch", message: "The existing preparation checksum, source content, or explicit configuration differs. Only a source file's location may change on a reusable run." }));
      }
      const savedInspectionBytes = yield* readBookArtifact(existing.inspection.path, config.inspection.maxProbeOutputBytes + manifestLimit);
      if (!savedInspectionBytes || sha256(savedInspectionBytes) !== existing.inspection.sha256) {
        return yield* Effect.fail(new BookTranscriptionError({ code: "ArtifactMismatch", message: "The saved source inspection is missing or does not match its preparation checksum." }));
      }
      const savedInspection = yield* parseBookJson(savedInspectionBytes, "Saved source inspection").pipe(
        Effect.mapError(() => new BookTranscriptionError({ code: "ArtifactMismatch", message: "The saved source inspection is not valid JSON." })),
      );
      const sameInspection = yield* Effect.try({
        try: () => jsonBytes(inspectionContent(savedInspection as SourceMediaInspection)).equals(jsonBytes(inspectionContent(inspection))),
        catch: () => new BookTranscriptionError({ code: "ArtifactMismatch", message: "The saved source inspection has an invalid contract." }),
      });
      if (!sameInspection) return yield* Effect.fail(new BookTranscriptionError({ code: "ArtifactMismatch", message: "The current media inspection differs from the saved evidence beyond source location and file stat fields." }));
      // Historical signatures and downstream transcript hashes must survive a source move.
      return { preparation: existing, currentSourcePath: config.sourcePath };
    }
    yield* retainBookArtifact(inspectionPath, inspectionBytes, config.inspection.maxProbeOutputBytes + manifestLimit);
    yield* retainBookArtifact(preparationPath, jsonBytes(preparation), manifestLimit);
    return { preparation, currentSourcePath: config.sourcePath };
  });
}

/** Inspect and fingerprint one original file; this operation never submits audio or cuts it. */
export function prepareRevBook(options: { readonly configPath: string }): Effect.Effect<BookPreparationResult, BookError, Services> {
  return prepare(options.configPath).pipe(Effect.map(({ preparation, currentSourcePath }) => resultFromPreparation(preparation, currentSourcePath)));
}

/** Import an operator-associated dashboard export without credentials or network requests. */
export function importRevBookTranscript(options: {
  readonly configPath: string;
  readonly transcriptPath: string;
  readonly jobId: string;
}): Effect.Effect<BookTranscriptResult, BookError, Services> {
  return Effect.gen(function* () {
    const jobId = yield* Schema.decodeUnknownEffect(JobId)(options.jobId).pipe(
      Effect.mapError(() => new BookTranscriptionError({ code: "InvalidJobId", message: "Supply the Rev job ID associated with this complete source and dashboard export." })),
    );
    if (!options.transcriptPath || options.transcriptPath.includes("\0")) return yield* Effect.fail(new BookTranscriptionError({ code: "InvalidTranscript", message: "Supply an explicit transcript export path." }));
    const { preparation, currentSourcePath } = yield* prepare(options.configPath);
    const result = resultFromPreparation(preparation, currentSourcePath);
    const config = preparation.config;
    const bytes = yield* readBookArtifact(resolve(options.transcriptPath), config.maxTranscriptBytes);
    if (!bytes) return yield* Effect.fail(new BookTranscriptionError({ code: "InvalidTranscript", message: "The supplied transcript export does not exist." }));
    const provider = {
      name: "rev-ai", jobId, submissionMethod: "dashboard-export",
      association: "operator-supplied-source-export-and-job-id", requestedSettings: null,
      rawSha256: sha256(bytes), reportedDurationSeconds: null,
    };
    const evidence = { schemaVersion: 1, preparationSignature: preparation.signature, provider };
    const evidencePath = join(config.artifactDirectory, "evidence.json");
    const existingEvidence = yield* readBookArtifact(evidencePath, manifestLimit);
    if (!existingEvidence) {
      const fs = yield* FileSystem.FileSystem;
      for (const name of ["transcript.raw.json", "transcript.json", "transcript.txt"]) {
        const exists = yield* fs.exists(join(config.artifactDirectory, name)).pipe(
          Effect.mapError(() => new BookTranscriptionError({ code: "ArtifactIoFailed", message: "Cannot check existing whole-book transcript artifacts." })),
        );
        if (exists) return yield* Effect.fail(new BookTranscriptionError({ code: "ArtifactMismatch", message: "Transcript artifacts exist without their job/source evidence. Preserve this directory and reconcile the orphaned files before importing." }));
      }
    }
    yield* retainBookArtifact(evidencePath, jsonBytes(evidence), manifestLimit);
    const rawTranscriptPath = join(config.artifactDirectory, "transcript.raw.json");
    yield* retainBookArtifact(rawTranscriptPath, bytes, config.maxTranscriptBytes);
    const raw = yield* parseBookJson(bytes, "Rev dashboard transcript");
    // Rev transcript-only exports usually carry no job identity. If one is present,
    // it must agree with the operator's association; never discard contradictory data.
    if (typeof raw === "object" && raw !== null && "id" in raw && raw.id !== jobId) {
      return yield* Effect.fail(new BookTranscriptionError({ code: "InvalidJobId", message: "The export's job ID conflicts with the supplied Rev job ID. Raw evidence is retained." }));
    }
    const parsed = yield* normalizeRevProviderTranscript(raw, preparation.source.durationSeconds, config.timestampToleranceSeconds);
    const words = parsed.elements.filter((element): element is ProviderTimedWord => element.kind === "word");
    let firstWordStartSeconds = Infinity;
    let lastWordEndSeconds = 0;
    for (const word of words) {
      firstWordStartSeconds = Math.min(firstWordStartSeconds, word.providerStartSeconds);
      lastWordEndSeconds = Math.max(lastWordEndSeconds, word.providerEndSeconds);
    }
    const checks = {
      timestampRanges: "validated", timestampToleranceSeconds: config.timestampToleranceSeconds,
      ordering: "words-within-monologues-and-monologue-starts-validated",
      recognitionAndCoverage: "not-verified" as const,
      sourceAssociation: "operator-supplied-not-provider-authenticated",
      firstWordStartSeconds, lastWordEndSeconds,
    };
    const transcriptPath = join(config.artifactDirectory, "transcript.json");
    const textPath = join(config.artifactDirectory, "transcript.txt");
    yield* retainBookArtifact(transcriptPath, jsonBytes({
      schemaVersion: 1, kind: "whole-book-timed-transcript", provider,
      source: preparation.source, timing: preparation.timing,
      provenance: { preparationPath: result.preparationPath, preparationSignature: preparation.signature, inspection: preparation.inspection },
      checks, ...parsed,
    }), config.maxNormalizedTranscriptBytes);
    yield* retainBookArtifact(textPath, Buffer.from(`${parsed.text}\n`, "utf8"), config.maxTranscriptBytes);
    return { ...result, jobId, rawTranscriptPath, transcriptPath, textPath, wordCount: parsed.wordCount, firstWordStartSeconds, lastWordEndSeconds, recognitionAndCoverage: "not-verified" };
  });
}
