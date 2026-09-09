import { Data, Schema } from "effect";
import { Sha256 } from "../transcription/contracts.js";
const Path = Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/^[^\0]+$/));
const Positive = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));
const Int16 = Schema.Int.check(Schema.isBetween({ minimum: -32768, maximum: 32767 }));

/** `config/editor-server.json`. Paths resolve from the config file; the port and static directory are command-line arguments. */
export const EditorServerConfig = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  visualTimelineConfigPath: Path,
  ffmpegPath: Path,
  peaks: Schema.Struct({ samplesPerBucket: Positive, maxCacheBytes: Positive }),
  watch: Schema.Struct({ debounceMs: Positive }),
  limits: Schema.Struct({ maxUploadBytes: Positive, requestTimeoutMs: Positive }),
});
export type EditorServerConfig = typeof EditorServerConfig.Type;

/** `<planningDirectory>/peaks.json`: int16 min/max per bucket of decoded mono samples, pinned to the clip's audio hash. The last bucket may be partial. */
export const PeaksFile = Schema.Struct({
  schemaVersion: Schema.Literal(1), audioSha256: Sha256, sampleRateHz: Positive, sampleCount: Positive, samplesPerBucket: Positive,
  min: Schema.Array(Int16), max: Schema.Array(Int16),
});
export type PeaksFile = typeof PeaksFile.Type;

export class EditorServerError extends Data.TaggedError("EditorServerError")<{
  readonly code: "InvalidConfig" | "InvalidRequest" | "PayloadTooLarge" | "NotFound" | "PeaksFailed" | "IoFailed";
  readonly message: string;
}> {}
