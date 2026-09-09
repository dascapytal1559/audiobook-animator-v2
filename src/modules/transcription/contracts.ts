import { Data, Schema } from "effect";

const Path = Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/^[^\0]+$/));
const PositiveInteger = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));
const Nonnegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
export const Sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));

/** Paths resolve relative to the config file. Every operational limit is explicit. */
export const RevDemoConfig = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  apiBaseUrl: Schema.Literal("https://api.rev.ai/speechtotext/v1"),
  transcriber: Schema.Literal("machine"),
  language: Schema.Literal("en"),
  inputPath: Path,
  provenancePath: Path,
  artifactDirectory: Path,
  maxInputBytes: PositiveInteger.check(Schema.isLessThanOrEqualTo(32 * 1024 * 1024)),
  maxClipDurationSeconds: Schema.Finite.check(Schema.isBetween({ minimum: 1, maximum: 120 })),
  requestTimeoutMs: PositiveInteger,
  pollTimeoutMs: PositiveInteger,
  pollIntervalMs: PositiveInteger,
  maxResponseBytes: PositiveInteger,
  timestampToleranceSeconds: Nonnegative,
});
export type RevDemoConfig = typeof RevDemoConfig.Type;

/** The source preparation step supplies this block inside its provenance artifact. */
export const TranscriptionInput = Schema.Struct({
  path: Path,
  sha256: Sha256,
  byteLength: PositiveInteger,
  durationSeconds: Schema.Finite.check(Schema.isGreaterThan(0)),
  sourceSha256: Sha256,
  sourceStartSeconds: Nonnegative,
  sourceClock: Schema.Literal("decoded-audio"),
  timingCaveat: Schema.String,
});
export type TranscriptionInput = typeof TranscriptionInput.Type;

export type TranscriptionErrorCode =
  | "InvalidConfig" | "MissingCredential" | "InputReadFailed" | "InvalidProvenance"
  | "InputMismatch" | "DemoLimitExceeded" | "ArtifactIoFailed" | "ArtifactMismatch"
  | "SubmissionUncertain" | "HttpFailed" | "InvalidResponse" | "JobFailed"
  | "PollTimedOut" | "InvalidTimestamps";

export class TranscriptionError extends Data.TaggedError("TranscriptionError")<{
  readonly code: TranscriptionErrorCode;
  readonly message: string;
}> {}

export const TimedWord = Schema.Struct({
  kind: Schema.Literal("word"), id: Schema.String, speaker: Schema.Int,
  value: Schema.String, confidence: Schema.NullOr(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
  clipStartSeconds: Nonnegative, clipEndSeconds: Nonnegative,
  sourceStartSeconds: Nonnegative, sourceEndSeconds: Nonnegative,
});
export type TimedWord = typeof TimedWord.Type;

export const Punctuation = Schema.Struct({
  kind: Schema.Literal("punctuation"), id: Schema.String, speaker: Schema.Int, value: Schema.String,
});
export type Punctuation = typeof Punctuation.Type;

export interface ParsedTranscript {
  readonly elements: ReadonlyArray<TimedWord | Punctuation>;
  readonly text: string;
  readonly wordCount: number;
}

export interface RevDemoResult {
  readonly jobId: string;
  readonly artifactDirectory: string;
  readonly transcriptPath: string;
  readonly rawTranscriptPath: string;
  readonly sourceClock: "decoded-audio";
  readonly timingCaveat: string;
  readonly wordCount: number;
  readonly wordPreview: ReadonlyArray<TimedWord>;
  readonly durationDifferenceSeconds: number | null;
}
