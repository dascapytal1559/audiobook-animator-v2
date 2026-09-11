import { errorsOf } from "../../core/error.js";
export { AlignParameters, AlignReport, AlignRun, TimingEntries, TimingEntry, TimingMeasure, WordTimingAuto, WordTimingManual } from "@animator/domain";

export type TimingCode = "InvalidRequest" | "InvalidTiming" | "IdentityMismatch" | "IoFailed";
const errors = errorsOf<"timing", TimingCode>("timing");
/** A timing failure: the shared AnimatorError with this module's code union. */
export const timingError = errors.make;
export const isTimingError = errors.is;
