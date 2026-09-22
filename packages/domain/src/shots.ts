import { Schema } from "effect";
import { ClipIdentity, Producer } from "./identity.js";
import { IsoUtc, NonNegative, Positive, Text } from "./schema.js";
import { ULID_PATTERN } from "./ulid.js";

export const ShotId = Schema.String.check(Schema.isPattern(ULID_PATTERN));
export const ShotMode = Schema.Literals(["graphic-illustration", "poetic-abstraction", "source-screenshot"]);
export type ShotMode = typeof ShotMode.Type;
export const SHOT_MODES: ReadonlyArray<ShotMode> = ShotMode.literals;
/** Independent image sequence over the same narration (A60). Old immutable records belong to `main`. */
export const ImageTrackId = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/));
export const DEFAULT_IMAGE_TRACK = "main";
export const imageTrackOf = (record: { readonly trackId?: string }): string => record.trackId ?? DEFAULT_IMAGE_TRACK;
/** One path segment inside the record's own directory: no separators, no `.`/`..`, never absolute. */
export const ImagePath = Schema.String.check(Schema.isPattern(/^(?!\.\.?$)[^\0/\\]+$/));

const shotFields = {
  id: ShotId, startSample: NonNegative, mode: ShotMode, trackId: Schema.optionalKey(ImageTrackId),
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
  ...shotFields, trackId: ImageTrackId, imageUrl: Schema.optionalKey(Text), anchorWordId: Schema.optionalKey(Text),
  hidden: Schema.Boolean, selected: Schema.Boolean, selectionSource: Schema.optionalKey(SelectionSource),
});
export type EffectiveShot = typeof EffectiveShot.Type;
/** Shots sharing one track and effective startSample. `selectedId` is null only when every candidate is hidden. */
export const CandidateGroup = Schema.Struct({ trackId: ImageTrackId, startSample: NonNegative, shots: Schema.Array(EffectiveShot), selectedId: Schema.NullOr(ShotId), selectionSource: Schema.NullOr(SelectionSource) });
export type CandidateGroup = typeof CandidateGroup.Type;
export const StitchedEntry = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("shot"), ...EffectiveShot.fields, endSample: Positive }),
  Schema.Struct({ kind: Schema.Literal("gap"), trackId: ImageTrackId, startSample: NonNegative, endSample: Positive }),
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
 * The one timeline rule (A19, A25, A30 to A32, A51, A60). Decision overrides are applied over record fields, shots in the same track with the same effective start
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
  const tracks = new Map<string, Map<number, MutableShot[]>>();
  if (records.length === 0) tracks.set(DEFAULT_IMAGE_TRACK, new Map());
  for (const record of records) {
    const d = decisions.shots[record.id] ?? {};
    const { schemaVersion: _v, kind: _k, clip: _c, ...fields } = record;
    const anchored = d.anchorWordId !== undefined ? wordStarts.get(d.anchorWordId) : undefined;
    const shot: MutableShot = { ...fields, trackId: imageTrackOf(record), startSample: anchored ?? d.startSample ?? record.startSample, ...(d.anchorWordId !== undefined ? { anchorWordId: d.anchorWordId } : {}),
      mode: d.mode ?? record.mode, ...(d.notes !== undefined ? { notes: d.notes } : {}),
      hidden: d.hidden === true, selected: false, ...(d.selected === true ? { selectionSource: "decision" as const } : {}) };
    const groups = tracks.get(shot.trackId) ?? new Map<number, MutableShot[]>();
    tracks.set(shot.trackId, groups);
    const group = groups.get(shot.startSample) ?? [];
    group.push(shot); groups.set(shot.startSample, group);
  }
  const candidates: CandidateGroup[] = [];
  const stitched: StitchedEntry[] = [];
  for (const trackId of [...tracks.keys()].sort((a, b) => a === DEFAULT_IMAGE_TRACK ? -1 : b === DEFAULT_IMAGE_TRACK ? 1 : a.localeCompare(b))) {
    const groups = tracks.get(trackId)!;
    const trackCandidates: CandidateGroup[] = [];
    for (const startSample of [...groups.keys()].sort((a, b) => a - b)) {
      const shots = groups.get(startSample)!.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const explicit = shots.filter(s => s.selectionSource === "decision");
      if (explicit.length > 1) problems.push(`More than one shot selected at sample ${startSample} in track ${trackId}: ${explicit.map(s => s.id).join(", ")}`);
      const visible = shots.filter(s => !s.hidden);
      const chosen = explicit[0] ?? visible[0];
      for (const s of shots) { if (s !== chosen) delete s.selectionSource; }
      if (chosen) { chosen.selected = true; chosen.selectionSource = explicit[0] ? "decision" : "default"; }
      trackCandidates.push({ trackId, startSample, shots, selectedId: chosen?.id ?? null, selectionSource: chosen?.selectionSource ?? null });
    }
    const selected = trackCandidates.flatMap(g => g.shots.filter(s => s.selected));
    const trackStitched: StitchedEntry[] = selected.map((shot, i) => ({ kind: "shot", ...shot, endSample: selected[i + 1]?.startSample ?? sampleCount }));
    const firstStart = trackStitched[0]?.startSample ?? sampleCount;
    if (firstStart > 0) trackStitched.unshift({ kind: "gap", trackId, startSample: 0, endSample: firstStart });
    candidates.push(...trackCandidates);
    stitched.push(...trackStitched);
  }
  return { candidates, stitched, unresolvedAnchors, problems };
}

/**
 * A declared shot (A65): a place where a new shot begins, declared by anchoring a shot to a transcript word (A51). Nothing automatic
 * declares one; the word is the shot's identity, so it follows timing edits, and takes of the shot name that word.
 */
export type DeclaredShot = { readonly anchorWordId: string; readonly startSample: number };
/**
 * Every declared shot in timeline order: the distinct anchor words of the shots the image tracks show, each at its word's effective start.
 * A hidden or unselected shot declares nothing, and an unanchored shot is a placement, not a declaration.
 */
export function declaredShots(stitched: ReadonlyArray<StitchedEntry>): ReadonlyArray<DeclaredShot> {
  const starts = new Map<string, number>();
  for (const entry of stitched) if (entry.kind === "shot" && entry.anchorWordId !== undefined && !starts.has(entry.anchorWordId)) starts.set(entry.anchorWordId, entry.startSample);
  return [...starts].map(([anchorWordId, startSample]) => ({ anchorWordId, startSample })).sort((a, b) => a.startSample - b.startSample || a.anchorWordId.localeCompare(b.anchorWordId));
}

/** Project one independent sequence before preview, playback, or candidate editing (A60). */
export function timelineForTrack(timeline: Pick<MergedTimeline, "candidates" | "stitched">, trackId: string) {
  return { candidates: timeline.candidates.filter(group => group.trackId === trackId), stitched: timeline.stitched.filter(entry => entry.trackId === trackId) };
}

/** The entry under `sample` in one track's stitched sequence, with a tolerance for seeks that land a hair early. */
export function entryAt(stitched: ReadonlyArray<StitchedEntry>, sample: number, toleranceSamples: number): StitchedEntry | null {
  let current: StitchedEntry | null = null;
  for (const entry of stitched) {
    if (entry.startSample <= sample + toleranceSamples) current = entry;
    else break;
  }
  return current;
}
