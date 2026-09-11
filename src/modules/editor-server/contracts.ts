import { Data, Schema } from "effect";
import { NonNegative, Path, Positive } from "@animator/domain";

/**
 * `config/editor-server.json`. Paths resolve from the config file; the port and static directory are command-line arguments.
 * Every directory under `storiesDirectory` is a story the server can open (A55); the story config reached through the visual-timeline config names the default one (A18) and must live directly under it.
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

export { PeaksFile, SpeechFile } from "@animator/domain";

export class EditorServerError extends Data.TaggedError("EditorServerError")<{
  readonly code: "InvalidConfig" | "InvalidRequest" | "PayloadTooLarge" | "NotFound" | "PeaksFailed" | "IoFailed";
  readonly message: string;
}> {}
