import { Data, Schema } from "effect";
import { Id, NonNegative, Path, Positive, PositiveSeconds, Sha256, Text } from "@animator/domain";
import { StorySplitSegment } from "../../intake/story-split/contracts.js";
import { ProviderTimedWord } from "../../intake/transcription/normalize.js";
import { Punctuation } from "../../intake/transcription/contracts.js";

/** `config/story.json`: the one story directory this configuration selects. Paths resolve from the config file. */
export const StoryConfig = Schema.Struct({
  schemaVersion: Schema.Literal(1), storyDirectory: Path,
  limits: Schema.Struct({ maxManifestBytes: Positive, maxTranscriptBytes: Positive, maxAudioManifestBytes: Positive, maxElements: Positive }),
});
export type StoryConfig = typeof StoryConfig.Type;
export type ManifestLimits = Pick<StoryConfig["limits"], "maxManifestBytes" | "maxTranscriptBytes" | "maxAudioManifestBytes">;

/** Where a story came from: the book split that produced it. Historical locators and the split's pinned hashes; the split inventory is not reopened. */
export const StoryOrigin = Schema.Struct({
  splitInventoryPath: Path, splitInventorySha256: Sha256, segmentPath: Path,
  planSha256: Sha256, transcriptSha256: Sha256, sourceSha256: Sha256, providerJobId: Text,
});
export type StoryOrigin = typeof StoryOrigin.Type;
/**
 * `data/stories/<id>/story.json`: the story's identity, its current file locators (relative to the directory), its origin, and the editable
 * premise-only synopsis. `id` must equal the directory name. Every identity field is verified against the linked files on load, so an
 * edit that breaks identity is caught rather than trusted.
 */
export const StoryManifest = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("story-manifest"), id: Id, title: Text,
  book: Schema.Struct({ id: Id, title: Text }), spoilerPolicy: Schema.Literal("premise-only"), synopsis: Text.check(Schema.isPattern(/\S/)),
  wordCount: Positive, sampleCount: Positive, sampleRateHz: Positive, durationSeconds: PositiveSeconds, durationDisplay: Text,
  audioPath: Path, audioSha256: Sha256, audioManifestPath: Path, audioManifestSha256: Sha256,
  transcriptProvider: Schema.Literals(["rev-ai", "openai"]),
  transcriptPath: Path, transcriptSha256: Sha256, textPath: Path, textSha256: Sha256,
  origin: StoryOrigin,
  /** Per-story editor settings that override the server config; absent means the config default. */
  chunking: Schema.optionalKey(Schema.Struct({ minSentenceBreakMs: NonNegative })),
});
export type StoryManifest = typeof StoryManifest.Type;

/** The fields of the paired transcript every reader checks against the manifest. The element-level schema is `PlanningTranscript`. */
export const PairedTranscript = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("paired-story-segment-transcript"),
  segment: Schema.Struct({ id: Id, title: Text, kind: Schema.Literal("story"), startSample: NonNegative, endSample: Positive }),
  provenance: Schema.Struct({ planSha256: Sha256, transcriptSha256: Sha256, sourceSha256: Sha256, providerJobId: Text }),
  audio: Schema.Struct({ path: Path, manifestPath: Path, manifestSha256: Sha256, sha256: Sha256, sampleCount: Positive, sampleRateHz: Positive, durationSeconds: PositiveSeconds }),
  wordCount: Positive,
});
/** The fields of the verified audio manifest every reader checks. The full schema is `StoryAudioManifest` in story-audio. */
export const PairedAudioManifest = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("verified-story-audio"),
  output: Schema.Struct({ filename: Path, sha256: Sha256, byteLength: Positive, sampleRateHz: Positive, sampleCount: Positive }),
});

/** Schema for the existing paired artifact, not a new transcript format. */
export const PlanningTranscript = Schema.Struct({ ...PairedTranscript.fields,
  segment: StorySplitSegment,
  provenance: Schema.Struct({ ...PairedTranscript.fields.provenance.fields, providerRawSha256: Sha256,
    evidence: Schema.Array(Schema.Struct({ path: Path, sha256: Sha256, description: Text })) }),
  timing: Schema.Struct({ clock: Schema.Literal("ffmpeg-decoded-audio-samples"), providerToDecodedOffsetSeconds: Schema.Finite, basis: Text,
    wordTiming: Schema.Literal("approximate-provider-times-mapped-to-segment"), caveat: Text,
    wordTimingToleranceSeconds: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)) }),
  audio: Schema.Struct({ ...PairedTranscript.fields.audio.fields, channels: Positive }),
  elements: Schema.Array(Schema.Union([
    Schema.Struct({ ...ProviderTimedWord.fields, bookElementIndex: NonNegative, approximateSegmentStartSeconds: Schema.Finite, approximateSegmentEndSeconds: Schema.Finite }),
    Schema.Struct({ ...Punctuation.fields, bookElementIndex: NonNegative }),
  ])),
  text: Schema.String,
});
export type PlanningTranscript = typeof PlanningTranscript.Type;
export class StoryError extends Data.TaggedError("StoryError")<{
  readonly code: "InvalidConfig" | "InvalidManifest" | "TranscriptMismatch" | "ArtifactMismatch" | "IoFailed";
  readonly message: string;
}> {}
