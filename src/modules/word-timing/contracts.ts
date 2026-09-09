import { Data, Schema } from "effect";
import { ClipIdentity, IsoUtc, Producer } from "../visual-timeline/contracts.js";
const Index = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const Positive = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));

/** One word's span on the clip clock. Keys of the overlay maps are transcript word ids; `startSample < endSample <= sampleCount` is checked against the loaded transcript, not here. */
export const TimingEntry = Schema.Struct({ startSample: Index, endSample: Index });
export type TimingEntry = typeof TimingEntry.Type;
export const TimingEntries = Schema.Record(Schema.String, TimingEntry);
export type TimingEntries = typeof TimingEntries.Type;

/** Before/after statistics for one range (A48). Percentiles are null when the range holds no phrase boundary; the fraction is null when it holds no word. */
export const TimingMeasure = Schema.Struct({
  wordCount: Index, boundaryCount: Index,
  onsetErrorMs: Schema.NullOr(Schema.Struct({ median: Schema.Number, p10: Schema.Number, p90: Schema.Number })),
  insideSpeechCount: Index, insideSpeechFraction: Schema.NullOr(Schema.Number),
});
export type TimingMeasure = typeof TimingMeasure.Type;
export const AlignReport = Schema.Struct({
  range: Schema.Struct({ startSample: Index, endSample: Index }), wordCount: Index, regionCount: Index, leadMs: Schema.Int, boundaryPauseMs: Positive,
  before: TimingMeasure, after: TimingMeasure,
});
export type AlignReport = typeof AlignReport.Type;

export const AlignParameters = Schema.Struct({ leadMs: Schema.Int, thresholdDbfs: Schema.Number, minSilenceMs: Positive, minSpeechMs: Positive });
export type AlignParameters = typeof AlignParameters.Type;
export const AlignRun = Schema.Struct({ startSample: Index, endSample: Index, ranAt: IsoUtc, report: AlignReport });
export type AlignRun = typeof AlignRun.Type;

/** `<story>/word-timing.auto.json`: written only by the align script (A42). Entries for a range are replaced by each run over it; every run is appended. */
export const WordTimingAuto = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("word-timing-auto"), clip: ClipIdentity, updatedAt: IsoUtc, producer: Producer,
  parameters: AlignParameters, runs: Schema.Array(AlignRun), words: TimingEntries,
});
export type WordTimingAuto = typeof WordTimingAuto.Type;
/** `<story>/word-timing.json`: written only by the editor (A42). Replaced wholesale on every save. */
export const WordTimingManual = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("word-timing-manual"), clip: ClipIdentity, updatedAt: IsoUtc, words: TimingEntries,
});
export type WordTimingManual = typeof WordTimingManual.Type;

export class WordTimingError extends Data.TaggedError("WordTimingError")<{
  readonly code: "InvalidRequest" | "InvalidTiming" | "IdentityMismatch" | "IoFailed";
  readonly message: string;
}> {}
