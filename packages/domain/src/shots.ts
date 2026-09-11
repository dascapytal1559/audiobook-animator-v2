import { Schema } from "effect";
import { ClipIdentity, Producer } from "./identity.js";
import { IsoUtc, NonNegative, Positive, Text } from "./schema.js";
import { ULID_PATTERN } from "./ulid.js";

export const ShotId = Schema.String.check(Schema.isPattern(ULID_PATTERN));
export const ShotMode = Schema.Literals(["graphic-illustration", "poetic-abstraction"]);
export type ShotMode = typeof ShotMode.Type;
export const SHOT_MODES: ReadonlyArray<ShotMode> = ShotMode.literals;
/** One path segment inside the record's own directory: no separators, no `.`/`..`, never absolute. */
export const ImagePath = Schema.String.check(Schema.isPattern(/^(?!\.\.?$)[^\0/\\]+$/));

const shotFields = {
  id: ShotId, startSample: NonNegative, mode: ShotMode,
  label: Schema.optionalKey(Text), prompt: Schema.optionalKey(Text), imagePath: Schema.optionalKey(ImagePath), notes: Schema.optionalKey(Text),
  createdAt: IsoUtc, producer: Producer,
};
/** Immutable generation record at `<story>/shots/<id>/record.json`. `startSample` is on the clip's own clock; its upper bound is checked against the clip. */
export const ShotRecord = Schema.Struct({ schemaVersion: Schema.Literal(1), kind: Schema.Literal("visual-shot-generation"), clip: ClipIdentity, ...shotFields });
export type ShotRecord = typeof ShotRecord.Type;
/** A record as the editor server serves it: `imageUrl` is added when the record has an image. */
export const ServedShotRecord = Schema.Struct({ ...ShotRecord.fields, imageUrl: Schema.optionalKey(Text) });
export type ServedShotRecord = typeof ServedShotRecord.Type;

/** `anchorWordId` (A51) pins the shot to a transcript word: the effective start follows that word's effective start and beats `startSample`. */
export const ShotDecision = Schema.Struct({
  startSample: Schema.optionalKey(NonNegative), anchorWordId: Schema.optionalKey(Text), mode: Schema.optionalKey(ShotMode),
  selected: Schema.optionalKey(Schema.Boolean), hidden: Schema.optionalKey(Schema.Boolean), notes: Schema.optionalKey(Text),
});
export type ShotDecision = typeof ShotDecision.Type;
export const TimelineSettings = Schema.Struct({ frameAspect: Schema.Struct({ width: Positive, height: Positive }) });
export type TimelineSettings = typeof TimelineSettings.Type;
/** What an editor supplies; identity, version, and timestamp are owned by the writer. */
export const DecisionsBody = Schema.Struct({ settings: TimelineSettings, shots: Schema.Record(Schema.String, ShotDecision) });
export type DecisionsBody = typeof DecisionsBody.Type;
/** Editable overlay at `<story>/decisions.json`. Keys are validated against loaded record ids by the merge, not by this schema. */
export const Decisions = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("visual-timeline-decisions"), clip: ClipIdentity, updatedAt: IsoUtc, ...DecisionsBody.fields,
});
export type Decisions = typeof Decisions.Type;
export const DEFAULT_SETTINGS: TimelineSettings = { frameAspect: { width: 16, height: 9 } };

const SelectionSource = Schema.Literals(["decision", "default"]);
/** A record after its decision: overrides applied, anchor reported, selection resolved within its candidate group. */
export const EffectiveShot = Schema.Struct({
  ...shotFields, imageUrl: Schema.optionalKey(Text), anchorWordId: Schema.optionalKey(Text),
  hidden: Schema.Boolean, selected: Schema.Boolean, selectionSource: Schema.optionalKey(SelectionSource),
});
export type EffectiveShot = typeof EffectiveShot.Type;
/** Shots sharing one effective startSample. `selectedId` is null only when every candidate is hidden. */
export const CandidateGroup = Schema.Struct({ startSample: NonNegative, shots: Schema.Array(EffectiveShot), selectedId: Schema.NullOr(ShotId), selectionSource: Schema.NullOr(SelectionSource) });
export type CandidateGroup = typeof CandidateGroup.Type;
export const StitchedEntry = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("shot"), ...EffectiveShot.fields, endSample: Positive }),
  Schema.Struct({ kind: Schema.Literal("gap"), startSample: NonNegative, endSample: Positive }),
]);
export type StitchedEntry = typeof StitchedEntry.Type;

export type MergedTimeline = {
  readonly candidates: ReadonlyArray<CandidateGroup>;
  readonly stitched: ReadonlyArray<StitchedEntry>;
  /** Shots whose anchor names a word that is not in `wordStarts` while `wordStarts` is empty: the words are unknown, so the anchor merely falls back. */
  readonly unresolvedAnchors: ReadonlyArray<string>;
  /** Every rule the decisions break, in order found; empty when they are valid. A writer must refuse decisions with problems; a viewer may ignore them. */
  readonly problems: ReadonlyArray<string>;
};
type MutableShot = { -readonly [K in keyof EffectiveShot]: EffectiveShot[K] };

/**
 * The one timeline rule (A19, A25, A30 to A32, A51). Decision overrides are applied over record fields, shots with the same effective start
 * form a candidate group, one candidate is selected per group (the explicitly selected one, else the newest by `createdAt`, never a hidden
 * one), and the selected shots are stitched so each holds until the next start and the last until the clip end; an opening gap is explicit.
 * `wordStarts` maps word id to effective start sample: an anchored shot starts at its word. When `wordStarts` is empty the words are unknown
 * and an anchor falls back to the override or record and is listed in `unresolvedAnchors`; when words are known, an anchor to a missing word
 * is a problem. Records that carry `imageUrl` keep it on their shots.
 */
export function mergeTimeline(records: ReadonlyArray<ServedShotRecord>, decisions: DecisionsBody, sampleCount: number, wordStarts: ReadonlyMap<string, number>): MergedTimeline {
  const byId = new Map(records.map(r => [r.id, r] as const));
  const problems: string[] = [];
  const unresolvedAnchors: string[] = [];
  for (const [id, decision] of Object.entries(decisions.shots)) {
    if (!byId.has(id)) problems.push(`Decision references a shot with no generation record: ${id}`);
    if (decision.startSample !== undefined && decision.startSample >= sampleCount) problems.push(`Decision startSample ${decision.startSample} is outside the clip's ${sampleCount} samples for shot ${id}`);
    if (decision.selected === true && decision.hidden === true) problems.push(`Shot ${id} is both selected and hidden`);
    if (decision.anchorWordId !== undefined && !wordStarts.has(decision.anchorWordId)) {
      if (wordStarts.size > 0) problems.push(`Shot ${id} is anchored to a word that is not in the transcript: ${decision.anchorWordId}`);
      else unresolvedAnchors.push(id);
    }
  }
  const groups = new Map<number, MutableShot[]>();
  for (const record of records) {
    const d = decisions.shots[record.id] ?? {};
    const { schemaVersion: _v, kind: _k, clip: _c, ...fields } = record;
    const anchored = d.anchorWordId !== undefined ? wordStarts.get(d.anchorWordId) : undefined;
    const shot: MutableShot = { ...fields, startSample: anchored ?? d.startSample ?? record.startSample, ...(d.anchorWordId !== undefined ? { anchorWordId: d.anchorWordId } : {}),
      mode: d.mode ?? record.mode, ...(d.notes !== undefined ? { notes: d.notes } : {}),
      hidden: d.hidden === true, selected: false, ...(d.selected === true ? { selectionSource: "decision" as const } : {}) };
    const group = groups.get(shot.startSample) ?? [];
    group.push(shot); groups.set(shot.startSample, group);
  }
  const candidates: CandidateGroup[] = [];
  for (const startSample of [...groups.keys()].sort((a, b) => a - b)) {
    const shots = groups.get(startSample)!.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const explicit = shots.filter(s => s.selectionSource === "decision");
    if (explicit.length > 1) problems.push(`More than one shot selected at sample ${startSample}: ${explicit.map(s => s.id).join(", ")}`);
    const visible = shots.filter(s => !s.hidden);
    const chosen = explicit[0] ?? visible[0];
    for (const s of shots) { if (s !== chosen) delete s.selectionSource; }
    if (chosen) { chosen.selected = true; chosen.selectionSource = explicit[0] ? "decision" : "default"; }
    candidates.push({ startSample, shots, selectedId: chosen?.id ?? null, selectionSource: chosen?.selectionSource ?? null });
  }
  const selected = candidates.flatMap(g => g.shots.filter(s => s.selected));
  const stitched: StitchedEntry[] = selected.map((shot, i) => ({ kind: "shot", ...shot, endSample: selected[i + 1]?.startSample ?? sampleCount }));
  const firstStart = stitched[0]?.startSample ?? sampleCount;
  if (firstStart > 0) stitched.unshift({ kind: "gap", startSample: 0, endSample: firstStart });
  return { candidates, stitched, unresolvedAnchors, problems };
}

/** The stitched entry under `sample`, with a tolerance so a seek that lands a hair early still reads as the intended shot. */
export function entryAt(stitched: ReadonlyArray<StitchedEntry>, sample: number, toleranceSamples: number): StitchedEntry | null {
  let current: StitchedEntry | null = null;
  for (const entry of stitched) {
    if (entry.startSample <= sample + toleranceSamples) current = entry;
    else break;
  }
  return current;
}
