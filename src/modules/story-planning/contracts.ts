import { Data, Schema } from "effect";
import { PairedTranscript, VerifiedInventory } from "../story-inventory/contracts.js";
import { StorySplitSegment } from "../story-split/contracts.js";
import { ProviderTimedWord } from "../transcription/normalize.js";
import { Punctuation, Sha256 } from "../transcription/contracts.js";
const Text = Schema.String.check(Schema.isMinLength(1));
const Path = Text.check(Schema.isPattern(/^[^\0]+$/));
const Positive = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));
const Index = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const Id = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,100}$/));
export const StoryPlanningConfig = Schema.Struct({
  schemaVersion: Schema.Literal(1), bookId: Id, bookTitle: Text, storyId: Id,
  inventoryPath: Path, inventorySha256: Sha256,
  limits: Schema.Struct({ maxInventoryBytes: Positive, maxTranscriptBytes: Positive, maxAudioManifestBytes: Positive, maxElements: Positive }),
});
export const PlanningInventory = Schema.Struct({ ...VerifiedInventory.fields,
  planSha256: Sha256, transcriptSha256: Sha256, sourceSha256: Sha256, providerJobId: Text,
});
/** Schema for the existing paired artifact, not a new transcript format. */
export const PlanningTranscript = Schema.Struct({ ...PairedTranscript.fields,
  segment: StorySplitSegment,
  provenance: Schema.Struct({ planSha256: Sha256, transcriptSha256: Sha256, providerJobId: Text, providerRawSha256: Sha256, sourceSha256: Sha256,
    evidence: Schema.Array(Schema.Struct({ path: Path, sha256: Sha256, description: Text })) }),
  timing: Schema.Struct({ clock: Schema.Literal("ffmpeg-decoded-audio-samples"), providerToDecodedOffsetSeconds: Schema.Finite, basis: Text,
    wordTiming: Schema.Literal("approximate-provider-times-mapped-to-segment"), caveat: Text,
    wordTimingToleranceSeconds: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)) }),
  audio: Schema.Struct({ ...PairedTranscript.fields.audio.fields, channels: Positive }),
  elements: Schema.Array(Schema.Union([
    Schema.Struct({ ...ProviderTimedWord.fields, bookElementIndex: Index, approximateSegmentStartSeconds: Schema.Finite, approximateSegmentEndSeconds: Schema.Finite }),
    Schema.Struct({ ...Punctuation.fields, bookElementIndex: Index }),
  ])),
  text: Schema.String,
});
export type PlanningTranscript = typeof PlanningTranscript.Type;
export class StoryPlanningError extends Data.TaggedError("StoryPlanningError")<{
  readonly code: "InvalidConfig" | "InvalidInventory" | "TranscriptMismatch" | "ArtifactMismatch" | "IoFailed";
  readonly message: string;
}> {}
