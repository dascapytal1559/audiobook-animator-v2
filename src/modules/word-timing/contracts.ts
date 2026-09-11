import { Data } from "effect";
export { AlignParameters, AlignReport, AlignRun, TimingEntries, TimingEntry, TimingMeasure, WordTimingAuto, WordTimingManual } from "@animator/domain";

export class WordTimingError extends Data.TaggedError("WordTimingError")<{
  readonly code: "InvalidRequest" | "InvalidTiming" | "IdentityMismatch" | "IoFailed";
  readonly message: string;
}> {}
