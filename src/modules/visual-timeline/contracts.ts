import { Data, Schema } from "effect";
import { Path, Positive } from "@animator/domain";
export { ClipIdentity, Decisions, type DecisionsBody, DEFAULT_SETTINGS, ImagePath, IsoUtc, Producer, ShotDecision, ShotId, ShotMode, ShotRecord, TimelineSettings } from "@animator/domain";

/** `config/visual-timeline.json`: the story config it opens and the byte and count limits for records, decisions, and images. Paths resolve from the config file. */
export const VisualTimelineConfig = Schema.Struct({
  schemaVersion: Schema.Literal(1), storyConfigPath: Path,
  limits: Schema.Struct({ maxRecordBytes: Positive, maxDecisionsBytes: Positive, maxRecords: Positive, maxImageBytes: Positive }),
});
export type VisualTimelineConfig = typeof VisualTimelineConfig.Type;

export class VisualTimelineError extends Data.TaggedError("VisualTimelineError")<{
  readonly code: "InvalidConfig" | "InvalidRequest" | "InvalidRecord" | "InvalidDecisions" | "IdentityMismatch" | "RecordExists" | "IoFailed";
  readonly message: string;
}> {}
