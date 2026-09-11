import { Schema } from "effect";
import { errorsOf } from "../../core/error.js";
import { Positive } from "@animator/domain";
export { ClipIdentity, Decisions, type DecisionsBody, DEFAULT_SETTINGS, ImagePath, IsoUtc, Producer, ShotDecision, ShotId, ShotMode, ShotRecord, TimelineSettings } from "@animator/domain";

/** Settings for the timeline files: byte and count ceilings for records, decisions, and images. Defaults live in code; a run file may override any of them. */
export const VisualTimelineSettings = Schema.Struct({
  limits: Schema.Struct({ maxRecordBytes: Positive, maxDecisionsBytes: Positive, maxRecords: Positive, maxImageBytes: Positive }),
});
export type VisualTimelineSettings = typeof VisualTimelineSettings.Type;
export const visualTimelineDefaults: VisualTimelineSettings = { limits: { maxRecordBytes: 65_536, maxDecisionsBytes: 1_048_576, maxRecords: 5_000, maxImageBytes: 52_428_800 } };

export type TimelineCode = "InvalidConfig" | "InvalidRequest" | "InvalidRecord" | "InvalidDecisions" | "IdentityMismatch" | "RecordExists" | "IoFailed";
const errors = errorsOf<"timeline", TimelineCode>("timeline");
/** A timeline failure: the shared AnimatorError with this module's code union. */
export const timelineError = errors.make;
export const isTimelineError = errors.is;
