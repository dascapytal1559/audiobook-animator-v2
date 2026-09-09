import { Data, Schema, Struct } from "effect";
import { SourceMediaRequest } from "../source-media/contracts.js";

const Path = Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/^[^\0]+$/));
const PositiveInteger = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));
const NonnegativeInteger = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const Sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));

/** Samples count decoded frames per channel. Start is inclusive; end is exclusive. */
export const DecodedSampleInterval = Schema.Struct({
  clock: Schema.Literal("ffmpeg-decoded-audio-samples"),
  startSample: NonnegativeInteger,
  endSample: PositiveInteger,
});

export const StoryAudioRequest = Schema.Struct({
  sourcePath: Path,
  expectedSource: Schema.Struct({ sha256: Sha256, byteLength: PositiveInteger }),
  audioStreamIndex: NonnegativeInteger,
  interval: DecodedSampleInterval,
  artifactDirectory: Path,
  ffmpegPath: Path,
  inspection: SourceMediaRequest.mapFields(Struct.omit(["sourcePath", "audioStreamIndex"])),
  extractionTimeoutMs: PositiveInteger,
  verificationTimeoutMs: PositiveInteger,
  maxProcessOutputBytes: PositiveInteger,
  maxProcessErrorBytes: PositiveInteger,
  maxOutputBytes: PositiveInteger,
  maxManifestBytes: PositiveInteger.check(Schema.isLessThanOrEqualTo(1024 * 1024)),
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
    realPath: Path, sha256: Sha256, byteLength: PositiveInteger,
    audioStreamIndex: NonnegativeInteger, sampleRateHz: PositiveInteger, channels: PositiveInteger,
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
    filename: Schema.Literal("audio.flac"), sha256: Sha256, byteLength: PositiveInteger,
    codec: Schema.Literal("flac"), bitsPerSample: Schema.Literal(24),
    sampleRateHz: PositiveInteger, channels: PositiveInteger, sampleCount: PositiveInteger,
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
