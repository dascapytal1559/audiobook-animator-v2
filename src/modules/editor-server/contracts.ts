import { Data, Schema } from "effect";
import { NonNegative, Path, Positive } from "@animator/domain";

/**
 * Settings for the editor server and the word-timing tools. Defaults live in code; a run file may override any of them, and every
 * artifact they write (the peaks and speech caches, the auto timing overlay) records the values it was produced with.
 */
export const EditorSettings = Schema.Struct({
  ffmpegPath: Path,
  peaks: Schema.Struct({ samplesPerBucket: Positive, maxCacheBytes: Positive }),
  /** Speech-region detection (A45): RMS frames of `frameMs`, an absolute dBFS threshold, and the shortest silence and speech runs that survive cleanup. */
  speech: Schema.Struct({ frameMs: Positive, thresholdDbfs: Schema.Number, minSilenceMs: Positive, minSpeechMs: Positive }),
  /** The automatic align pass (A47, A48): words are shifted later by `leadMs` before snapping; a gap of at least `boundaryPauseMs` marks a phrase boundary in the report. */
  alignment: Schema.Struct({ leadMs: Schema.Int, boundaryPauseMs: Positive }),
  watch: Schema.Struct({ debounceMs: Positive }),
  limits: Schema.Struct({ maxUploadBytes: Positive, requestTimeoutMs: Positive, maxWordTimingBytes: Positive }),
  /** A gap between consecutive words at least this long ends a chunk in the editor's chunk lane; a story's manifest may override `minSentenceBreakMs` (A54). */
  chunking: Schema.Struct({ pauseBreakMs: Positive, minSentenceBreakMs: NonNegative }),
});
export type EditorSettings = typeof EditorSettings.Type;
export const editorDefaults: EditorSettings = {
  ffmpegPath: "ffmpeg",
  peaks: { samplesPerBucket: 1024, maxCacheBytes: 16_777_216 },
  speech: { frameMs: 10, thresholdDbfs: -50, minSilenceMs: 150, minSpeechMs: 50 },
  alignment: { leadMs: 150, boundaryPauseMs: 300 },
  watch: { debounceMs: 200 },
  limits: { maxUploadBytes: 52_428_800, requestTimeoutMs: 30_000, maxWordTimingBytes: 16_777_216 },
  chunking: { pauseBreakMs: 600, minSentenceBreakMs: 0 },
};

export { PeaksFile, SpeechFile } from "@animator/domain";

export class EditorServerError extends Data.TaggedError("EditorServerError")<{
  readonly code: "InvalidConfig" | "InvalidRequest" | "PayloadTooLarge" | "NotFound" | "PeaksFailed" | "IoFailed";
  readonly message: string;
}> {}
