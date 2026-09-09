import { Data, Schema, Struct } from "effect";
import { StoryAudioRequest } from "../story-audio/contracts.js";
import { BookSource } from "../transcription/book-contracts.js";
import { Punctuation, Sha256 } from "../transcription/contracts.js";
import { ProviderTimedWord } from "../transcription/normalize.js";

const Path = Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/^[^\0]+$/));
const Nonempty = Schema.String.check(Schema.isMinLength(1));
const PositiveInteger = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));
const NonnegativeInteger = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
export const SegmentKind = Schema.Literals(["story", "author-note", "opening-credits", "closing-credits"]);

export const StorySplitSegment = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,100}$/)),
  title: Nonempty, kind: SegmentKind,
  elementStartIndex: NonnegativeInteger, elementEndIndexExclusive: PositiveInteger,
  startSample: NonnegativeInteger, endSample: PositiveInteger,
});
export type StorySplitSegment = typeof StorySplitSegment.Type;

export const StorySplitPlan = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("story-split-plan"), bookTitle: Nonempty,
  source: Schema.Struct({ path: Path, sha256: Sha256, byteLength: PositiveInteger, audioStreamIndex: NonnegativeInteger, sampleRateHz: PositiveInteger }),
  transcript: Schema.Struct({ path: Path, sha256: Sha256, providerJobId: Nonempty, providerRawSha256: Sha256 }),
  timing: Schema.Struct({ clock: Schema.Literal("ffmpeg-decoded-audio-samples"), providerToDecodedOffsetSeconds: Schema.Finite, basis: Nonempty }),
  evidence: Schema.Array(Schema.Struct({ path: Path, sha256: Sha256, description: Nonempty })),
  segments: Schema.Array(StorySplitSegment),
});
export type StorySplitPlan = typeof StorySplitPlan.Type;

/** Every limit is explicit. Tool paths resolve from the config file, plan paths from the plan. */
export const StorySplitConfig = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  concurrency: PositiveInteger.check(Schema.isLessThanOrEqualTo(8)),
  maxSegments: PositiveInteger,
  maxPlanBytes: PositiveInteger,
  maxTranscriptBytes: PositiveInteger,
  maxEvidenceBytes: PositiveInteger,
  maxSegmentTranscriptBytes: PositiveInteger,
  maxInventoryBytes: PositiveInteger,
  maxRunManifestBytes: PositiveInteger,
  wordTimingToleranceSeconds: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  audio: StoryAudioRequest.mapFields(Struct.omit(["sourcePath", "expectedSource", "audioStreamIndex", "interval", "artifactDirectory"])),
});
export type StorySplitConfig = typeof StorySplitConfig.Type;

/** Only consumed fields are decoded; the pinned hash covers the complete original document. */
export const BookTranscriptForSplit = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("whole-book-timed-transcript"),
  provider: Schema.Struct({ name: Schema.Literal("rev-ai"), jobId: Nonempty, rawSha256: Sha256 }),
  source: BookSource,
  timing: Schema.Struct({ clock: Schema.Literal("submitted-media-provider") }),
  wordCount: PositiveInteger,
  elements: Schema.Array(Schema.Union([ProviderTimedWord, Punctuation])),
});
export type BookTranscriptForSplit = typeof BookTranscriptForSplit.Type;

export class StorySplitError extends Data.TaggedError("StorySplitError")<{
  readonly code: "InvalidConfig" | "InvalidPlan" | "TranscriptMismatch" | "SourceMismatch"
    | "EvidenceMismatch" | "InvalidAssignment" | "WordOutsideAudio" | "ArtifactIoFailed"
    | "ArtifactMismatch" | "InvalidAudioResult";
  readonly message: string;
}> {}

export interface SplitInventoryEntry {
  readonly id: string;
  readonly title: string;
  readonly kind: typeof SegmentKind.Type;
  readonly wordCount: number;
  readonly sampleCount: number;
  readonly sampleRateHz: number;
  readonly durationSeconds: number;
  readonly durationDisplay: string;
  readonly audioPath: string;
  readonly audioSha256: string;
  readonly audioManifestPath: string;
  readonly audioManifestSha256: string;
  readonly transcriptPath: string;
  readonly transcriptSha256: string;
  readonly textPath: string;
  readonly textSha256: string;
}

export interface StorySplitResult {
  readonly artifactDirectory: string;
  readonly inventoryPath: string;
  readonly readableInventoryPath: string;
  readonly storyCount: number;
  readonly extraCount: number;
  readonly stories: ReadonlyArray<SplitInventoryEntry>;
  readonly extras: ReadonlyArray<SplitInventoryEntry>;
}
