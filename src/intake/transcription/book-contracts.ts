import { Data, Schema, Struct } from "effect";
import { Path, Positive, PositiveSeconds, Sha256 } from "../../core/schema.js";
import { SourceMediaRequest } from "../source-media/contracts.js";


export const RevBookConfig = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  sourcePath: Path,
  artifactDirectory: Path,
  expectedSource: Schema.Struct({ sha256: Sha256, byteLength: Positive }),
  maxInputBytes: Positive.check(Schema.isLessThanOrEqualTo(2_000_000_000)),
  maxDurationSeconds: PositiveSeconds.check(Schema.isLessThanOrEqualTo(17 * 60 * 60)),
  maxTranscriptBytes: Positive.check(Schema.isLessThanOrEqualTo(64 * 1024 * 1024)),
  maxNormalizedTranscriptBytes: Positive.check(Schema.isLessThanOrEqualTo(512 * 1024 * 1024)),
  timestampToleranceSeconds: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  inspection: SourceMediaRequest.mapFields(Struct.omit(["sourcePath"])),
});
export type RevBookConfig = typeof RevBookConfig.Type;

export const BookSource = Schema.Struct({
  path: Path, realPath: Path, sha256: Sha256, byteLength: Positive,
  durationSeconds: PositiveSeconds, durationEvidence: Schema.Literals(["audio-stream", "format"]),
  audio: Schema.Struct({
    streamIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    codec: Schema.NullOr(Schema.String),
    sampleRateHz: Schema.NullOr(Positive), channels: Schema.NullOr(Positive),
    startTimeSeconds: Schema.NullOr(Schema.Finite),
  }),
});
export type BookSource = typeof BookSource.Type;

export const bookTiming = {
  clock: "submitted-media-provider" as const,
  mappingToExtractionClock: "unverified" as const,
  caveat: "Rev timestamps are relative to the submitted original media on the provider's timeline. Their mapping to FFmpeg decoded-audio or container timestamps has not been calibrated; these word times do not authorize automatic audio cuts.",
};

export const BookPreparation = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("whole-book-transcription-preparation"),
  provider: Schema.Literal("rev-ai"), submissionMethod: Schema.Literal("dashboard-export"),
  config: RevBookConfig, source: BookSource,
  timing: Schema.Struct({
    clock: Schema.Literal("submitted-media-provider"),
    mappingToExtractionClock: Schema.Literal("unverified"), caveat: Schema.String,
  }),
  inspection: Schema.Struct({ path: Path, sha256: Sha256 }),
  signature: Sha256,
});
export type BookPreparation = typeof BookPreparation.Type;

export class BookTranscriptionError extends Data.TaggedError("BookTranscriptionError")<{
  readonly code: "InvalidConfig" | "InputMismatch" | "InputLimitExceeded" | "InvalidDuration"
    | "ArtifactIoFailed" | "ArtifactMismatch" | "InvalidTranscript" | "InvalidJobId";
  readonly message: string;
}> {}

export interface BookPreparationResult {
  /** Current verified locator; source.path below records the historical submitted location. */
  readonly currentSourcePath: string;
  readonly preparationPath: string;
  readonly inspectionPath: string;
  readonly artifactDirectory: string;
  readonly signature: string;
  readonly source: BookSource;
  readonly timing: typeof bookTiming;
}

export interface BookTranscriptResult extends BookPreparationResult {
  readonly jobId: string;
  readonly rawTranscriptPath: string;
  readonly transcriptPath: string;
  readonly textPath: string;
  readonly wordCount: number;
  readonly firstWordStartSeconds: number;
  readonly lastWordEndSeconds: number;
  readonly recognitionAndCoverage: "not-verified";
}
