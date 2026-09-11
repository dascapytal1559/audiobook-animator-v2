import { Data, Schema, Struct } from "effect";
import { NonNegative, Path, Positive, Sha256 } from "@animator/domain";
import { SourceMediaRequest } from "../source-media/contracts.js";


/** Samples count decoded frames per channel. Start is inclusive; end is exclusive. */
export const DecodedSampleInterval = Schema.Struct({
  clock: Schema.Literal("ffmpeg-decoded-audio-samples"),
  startSample: NonNegative,
  endSample: Positive,
});

export const StoryAudioRequest = Schema.Struct({
  sourcePath: Path,
  expectedSource: Schema.Struct({ sha256: Sha256, byteLength: Positive }),
  audioStreamIndex: NonNegative,
  interval: DecodedSampleInterval,
  artifactDirectory: Path,
  ffmpegPath: Path,
  inspection: SourceMediaRequest.mapFields(Struct.omit(["sourcePath", "audioStreamIndex"])),
  extractionTimeoutMs: Positive,
  verificationTimeoutMs: Positive,
  maxProcessOutputBytes: Positive,
  maxProcessErrorBytes: Positive,
  maxOutputBytes: Positive,
  maxManifestBytes: Positive.check(Schema.isLessThanOrEqualTo(1024 * 1024)),
});
export type StoryAudioRequest = typeof StoryAudioRequest.Type;

export const encoding = {
  codec: "flac" as const,
  sampleFormat: "s32" as const,
  bitsPerSample: 24 as const,
  compressionLevel: 5 as const,
};

export const ExtractionIdentity = Schema.Struct({
  request: StoryAudioRequest,
  source: Schema.Struct({
    realPath: Path, sha256: Sha256, byteLength: Positive,
    audioStreamIndex: NonNegative, sampleRateHz: Positive, channels: Positive,
  }),
  encoding: Schema.Struct({ codec: Schema.Literal("flac"), sampleFormat: Schema.Literal("s32"), bitsPerSample: Schema.Literal(24), compressionLevel: Schema.Literal(5) }),
  ffmpegVersion: Schema.String.check(Schema.isMinLength(1)),
});
export type ExtractionIdentity = typeof ExtractionIdentity.Type;

export const StoryAudioManifest = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal("verified-story-audio"),
  identity: ExtractionIdentity,
  identitySha256: Sha256,
  precision: Schema.String,
  extraction: Schema.Struct({ executable: Path, arguments: Schema.Array(Schema.String) }),
  verification: Schema.Struct({ executable: Path, arguments: Schema.Array(Schema.String), decodedFormat: Schema.Literal("s24le") }),
  output: Schema.Struct({
    filename: Schema.Literal("audio.flac"), sha256: Sha256, byteLength: Positive,
    codec: Schema.Literal("flac"), bitsPerSample: Schema.Literal(24),
    sampleRateHz: Positive, channels: Positive, sampleCount: Positive,
    decodedPcmSha256: Sha256,
  }),
  manifestSha256: Sha256,
});
export type StoryAudioManifest = typeof StoryAudioManifest.Type;

export class StoryAudioError extends Data.TaggedError("StoryAudioError")<{
  readonly code: "InvalidRequest" | "SourceMismatch" | "SourceChanged" | "UnsupportedSource"
    | "ArtifactIoFailed" | "ArtifactMismatch" | "ProcessUnavailable" | "ProcessFailed"
    | "ProcessTimedOut" | "ProcessOutputLimit" | "InvalidOutput";
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}> {}

export interface StoryAudioResult {
  readonly audioPath: string;
  readonly manifestPath: string;
  readonly reused: boolean;
  readonly manifest: StoryAudioManifest;
}
