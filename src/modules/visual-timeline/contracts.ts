import { Data, Schema } from "effect";
import { ClipIdentity, Producer } from "../../core/identity.js";
import { IsoUtc, NonNegative, Path, Positive, Text } from "../../core/schema.js";
import { ULID_PATTERN } from "./ulid.js";
export { ClipIdentity, IsoUtc, Producer };
export const ShotId = Schema.String.check(Schema.isPattern(ULID_PATTERN));
export const ShotMode = Schema.Literals(["graphic-illustration", "poetic-abstraction"]);
export type ShotMode = typeof ShotMode.Type;
/** One path segment inside the record's own directory: no separators, no `.`/`..`, never absolute. */
export const ImagePath = Schema.String.check(Schema.isPattern(/^(?!\.\.?$)[^\0/\\]+$/));

export const VisualTimelineConfig = Schema.Struct({
  schemaVersion: Schema.Literal(1), storyPlanningConfigPath: Path,
  limits: Schema.Struct({ maxRecordBytes: Positive, maxDecisionsBytes: Positive, maxRecords: Positive, maxImageBytes: Positive }),
});
export type VisualTimelineConfig = typeof VisualTimelineConfig.Type;

/** Immutable generation record at `<story>/shots/<id>/record.json`. `startSample` is on the clip's own clock; its upper bound is checked against the clip. */
export const ShotRecord = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("visual-shot-generation"), id: ShotId, clip: ClipIdentity,
  startSample: NonNegative, mode: ShotMode,
  label: Schema.optionalKey(Text), prompt: Schema.optionalKey(Text), imagePath: Schema.optionalKey(ImagePath), notes: Schema.optionalKey(Text),
  createdAt: IsoUtc, producer: Producer,
});
export type ShotRecord = typeof ShotRecord.Type;

/** `anchorWordId` (A51) pins the shot to a transcript word: the effective start follows that word's effective start and beats `startSample`. Validated against the known words at merge time. */
export const ShotDecision = Schema.Struct({
  startSample: Schema.optionalKey(NonNegative), anchorWordId: Schema.optionalKey(Text), mode: Schema.optionalKey(ShotMode),
  selected: Schema.optionalKey(Schema.Boolean), hidden: Schema.optionalKey(Schema.Boolean), notes: Schema.optionalKey(Text),
});
export type ShotDecision = typeof ShotDecision.Type;
export const TimelineSettings = Schema.Struct({ frameAspect: Schema.Struct({ width: Positive, height: Positive }) });
export type TimelineSettings = typeof TimelineSettings.Type;
/** Editable overlay at `<story>/decisions.json`. Keys are validated against loaded record ids, not by this schema (Record key checks are not enforced in this RC). */
export const Decisions = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("visual-timeline-decisions"), clip: ClipIdentity, updatedAt: IsoUtc,
  settings: TimelineSettings, shots: Schema.Record(Schema.String, ShotDecision),
});
export type Decisions = typeof Decisions.Type;
/** What an editor supplies; identity, version, and timestamp are owned by the module. */
export type DecisionsBody = Pick<Decisions, "settings" | "shots">;
export const DEFAULT_SETTINGS: TimelineSettings = { frameAspect: { width: 16, height: 9 } };

export class VisualTimelineError extends Data.TaggedError("VisualTimelineError")<{
  readonly code: "InvalidConfig" | "InvalidRequest" | "InvalidRecord" | "InvalidDecisions" | "IdentityMismatch" | "RecordExists" | "IoFailed";
  readonly message: string;
}> {}
