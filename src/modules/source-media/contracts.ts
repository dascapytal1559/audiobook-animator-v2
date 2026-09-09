import { Data, Schema } from "effect";

const PositiveInteger = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));
const LocalPath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isPattern(/^[^\0]+$/),
);

/** All operational limits are supplied at the application boundary. */
export const SourceMediaRequest = Schema.Struct({
  sourcePath: LocalPath,
  ffprobePath: LocalPath,
  probeTimeoutMs: PositiveInteger,
  maxProbeOutputBytes: PositiveInteger,
  maxProbeErrorBytes: PositiveInteger,
  hashChunkBytes: PositiveInteger.check(Schema.isLessThanOrEqualTo(64 * 1024 * 1024)),
  cueChapterToleranceSeconds: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  audioStreamIndex: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});

export type SourceMediaRequest = typeof SourceMediaRequest.Type;

export type SourceMediaErrorCode =
  | "InvalidRequest"
  | "SourceNotFound"
  | "NotRegularFile"
  | "SourceReadFailed"
  | "SourceChanged"
  | "ProbeUnavailable"
  | "ProbeFailed"
  | "ProbeTimedOut"
  | "ProbeOutputLimit"
  | "MalformedProbe"
  | "NoAudioStream"
  | "AmbiguousAudioStreams"
  | "AudioStreamNotFound";

export class SourceMediaError extends Data.TaggedError("SourceMediaError")<{
  readonly code: SourceMediaErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}> {}

export interface EvidenceIssue {
  readonly code: string;
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly location: string;
}

export interface CueTrack {
  readonly number: number;
  readonly fileOrdinal: number;
  readonly title: string | null;
  readonly index01: {
    readonly raw: string;
    readonly totalFrames: string;
    readonly framesPerSecond: 75;
    readonly seconds: number;
  } | null;
}

/** Supported subset: one quoted FILE (MP3/WAVE/AIFF), AUDIO TRACK, TITLE, INDEX 01. */
export interface CueSheetEvidence {
  readonly raw: string;
  readonly status: "valid" | "invalid" | "unsupported";
  readonly files: ReadonlyArray<{ readonly name: string; readonly type: string }>;
  readonly title: string | null;
  readonly tracks: ReadonlyArray<CueTrack>;
  readonly issues: ReadonlyArray<EvidenceIssue>;
}

export interface ChapterEvidence {
  readonly ordinal: number;
  /** The unmodified JSON value, including tags and decimal display timestamps. */
  readonly raw: unknown;
  readonly timing: {
    readonly startTicks: string;
    readonly endTicks: string;
    readonly timeBase: string;
    readonly startSeconds: number;
    readonly endSeconds: number;
  } | null;
}

export interface AudioStreamEvidence {
  readonly index: number;
  readonly codec: string | null;
  readonly sampleRateHz: number | null;
  readonly channels: number | null;
  readonly channelLayout: string | null;
  readonly bitRate: number | null;
  readonly durationSeconds: number | null;
  readonly startTimeSeconds: number | null;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface SourceFileStat {
  readonly byteLength: string;
  readonly device: number;
  readonly inode: number | null;
  readonly modifiedAt: string | null;
}

export interface ProbedMedia {
  readonly audio: AudioStreamEvidence;
  readonly audioStreamIndices: ReadonlyArray<number>;
  readonly format: Readonly<Record<string, unknown>>;
  readonly formatDurationSeconds: number | null;
  readonly duration: { readonly seconds: number; readonly source: "audio-stream" | "format" } | null;
  readonly chapters: ReadonlyArray<ChapterEvidence>;
  readonly cueSheets: ReadonlyArray<{ readonly tag: string; readonly evidence: CueSheetEvidence }>;
  /** Positional comparison is diagnostic evidence, never a story/title mapping. */
  readonly chapterCueComparison: {
    readonly basis: "ordinal-diagnostic-only";
    readonly toleranceSeconds: number;
    readonly entries: ReadonlyArray<{
      readonly chapterOrdinal: number;
      readonly cueTrackOrdinal: number;
      readonly cueMinusChapterSeconds: number;
      readonly withinTolerance: boolean;
    }>;
  };
  readonly issues: ReadonlyArray<EvidenceIssue>;
}

export interface SourceMediaInspection extends ProbedMedia {
  readonly schemaVersion: 1;
  readonly source: {
    readonly requestedPath: string;
    readonly absolutePath: string;
    readonly realPath: string;
    readonly sha256: string;
    readonly stat: SourceFileStat;
  };
  readonly probe: {
    readonly executable: string;
    readonly arguments: ReadonlyArray<string>;
    readonly stderr: string;
  };
}
