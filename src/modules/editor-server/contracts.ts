import { Data, Schema } from "effect";
import { Sha256 } from "../transcription/contracts.js";
const Path = Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/^[^\0]+$/));
const NonNegative = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const Positive = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));
const Int16 = Schema.Int.check(Schema.isBetween({ minimum: -32768, maximum: 32767 }));

/**
 * `config/editor-server.json`. Paths resolve from the config file; the port and static directory are command-line arguments.
 * Every directory under `storiesDirectory` is a story the server can open (A55); the story-planning config reached through the visual-timeline config names the default one (A18) and must live directly under it.
 */
export const EditorServerConfig = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  storiesDirectory: Path,
  visualTimelineConfigPath: Path,
  ffmpegPath: Path,
  peaks: Schema.Struct({ samplesPerBucket: Positive, maxCacheBytes: Positive }),
  /** Speech-region detection (A45): RMS frames of `frameMs`, an absolute dBFS threshold, and the shortest silence and speech runs that survive cleanup. */
  speech: Schema.Struct({ frameMs: Positive, thresholdDbfs: Schema.Number, minSilenceMs: Positive, minSpeechMs: Positive }),
  /** The automatic align pass (A47, A48): words are shifted later by `leadMs` before snapping; a gap of at least `boundaryPauseMs` marks a phrase boundary in the report. */
  alignment: Schema.Struct({ leadMs: Schema.Int, boundaryPauseMs: Positive }),
  watch: Schema.Struct({ debounceMs: Positive }),
  limits: Schema.Struct({ maxUploadBytes: Positive, requestTimeoutMs: Positive, maxWordTimingBytes: Positive }),
  /** A gap between consecutive words at least this long ends a chunk in the editor's chunk lane. */
  chunking: Schema.Struct({ pauseBreakMs: Positive, minSentenceBreakMs: NonNegative }),
});
export type EditorServerConfig = typeof EditorServerConfig.Type;

/** `<story>/cache/peaks.json`: int16 min/max per bucket of decoded mono samples, pinned to the clip's audio hash. The last bucket may be partial. */
export const PeaksFile = Schema.Struct({
  schemaVersion: Schema.Literal(1), audioSha256: Sha256, sampleRateHz: Positive, sampleCount: Positive, samplesPerBucket: Positive,
  min: Schema.Array(Int16), max: Schema.Array(Int16),
});
export type PeaksFile = typeof PeaksFile.Type;

const Index = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
/** `<story>/cache/speech.json`: detected speech regions on the clip clock, pinned to the audio hash and the detection parameters. Computed in the same decode as peaks (A46). */
export const SpeechFile = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("speech-regions"), audioSha256: Sha256, sampleRateHz: Positive, sampleCount: Positive,
  frameSamples: Positive, thresholdDbfs: Schema.Number, minSilenceMs: Positive, minSpeechMs: Positive,
  regions: Schema.Array(Schema.Struct({ startSample: Index, endSample: Index })),
});
export type SpeechFile = typeof SpeechFile.Type;

export class EditorServerError extends Data.TaggedError("EditorServerError")<{
  readonly code: "InvalidConfig" | "InvalidRequest" | "PayloadTooLarge" | "NotFound" | "PeaksFailed" | "IoFailed";
  readonly message: string;
}> {}
