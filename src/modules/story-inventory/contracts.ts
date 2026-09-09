import { Data, Schema } from "effect";

const Text = Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/\S/));
const Path = Text.check(Schema.isPattern(/^[^\0]+$/));
const Id = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,100}$/));
const Sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const PositiveInteger = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));
const NonnegativeInteger = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const PositiveSeconds = Schema.Finite.check(Schema.isGreaterThan(0));

export const StorySynopses = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal("story-synopses"),
  bookId: Id,
  spoilerPolicy: Schema.Literal("premise-only"),
  stories: Schema.Array(Schema.Struct({ storyId: Id, title: Text, synopsis: Text, transcriptSha256: Sha256 })),
});
export type StorySynopses = typeof StorySynopses.Type;

export const StoryInventoryConfig = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  books: Schema.Array(Schema.Struct({ bookId: Id, inventoryPath: Path, synopsisPath: Path, outputMarkdownPath: Path })),
  outputMarkdownPath: Path,
  outputJsonPath: Path,
  limits: Schema.Struct({
    maxBooks: PositiveInteger,
    maxStoriesPerBook: PositiveInteger,
    maxInventoryBytes: PositiveInteger,
    maxSynopsisBytes: PositiveInteger,
    maxTranscriptBytes: PositiveInteger,
    maxAudioManifestBytes: PositiveInteger,
    maxOutputBytes: PositiveInteger,
  }),
});
export type StoryInventoryConfig = typeof StoryInventoryConfig.Type;

export const VerifiedStory = Schema.Struct({
  id: Id, title: Text, kind: Schema.Literal("story"), wordCount: PositiveInteger,
  sampleCount: PositiveInteger, sampleRateHz: PositiveInteger, durationSeconds: PositiveSeconds, durationDisplay: Text,
  audioPath: Path, audioSha256: Sha256, audioManifestPath: Path, audioManifestSha256: Sha256,
  transcriptPath: Path, transcriptSha256: Sha256, textPath: Path, textSha256: Sha256,
});
export type VerifiedStory = typeof VerifiedStory.Type;

/** Decode the fields consumed by the reader; never rewrite the acceptance artifact. */
export const VerifiedInventory = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("verified-story-inventory"), status: Schema.Literal("complete"),
  bookTitle: Text, storyCount: PositiveInteger, extraCount: NonnegativeInteger,
  checks: Schema.Struct({
    everyElementAssignedExactlyOnce: Schema.Literal(true), everySegmentAudioVerified: Schema.Literal(true),
    durationBasis: Schema.Literal("verified-sample-count-divided-by-sample-rate"), wordTiming: Schema.Literal("approximate"),
  }),
  stories: Schema.Array(VerifiedStory), extras: Schema.Array(Schema.Unknown),
});
export type VerifiedInventory = typeof VerifiedInventory.Type;

export const PairedTranscript = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("paired-story-segment-transcript"),
  segment: Schema.Struct({ id: Id, title: Text, kind: Schema.Literal("story"), startSample: NonnegativeInteger, endSample: PositiveInteger }),
  audio: Schema.Struct({
    path: Path, manifestPath: Path, manifestSha256: Sha256, sha256: Sha256,
    sampleCount: PositiveInteger, sampleRateHz: PositiveInteger, durationSeconds: PositiveSeconds,
  }),
  wordCount: PositiveInteger,
});

export const AudioManifest = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("verified-story-audio"),
  output: Schema.Struct({
    filename: Path, sha256: Sha256, byteLength: PositiveInteger,
    sampleRateHz: PositiveInteger, sampleCount: PositiveInteger,
  }),
});

export class StoryInventoryError extends Data.TaggedError("StoryInventoryError")<{
  readonly code: "InvalidConfig" | "InvalidInventory" | "InvalidSynopses" | "TranscriptMismatch" | "ArtifactMismatch" | "IoFailed";
  readonly message: string;
}> {}
