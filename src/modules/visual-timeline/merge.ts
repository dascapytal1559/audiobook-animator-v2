import { Effect } from "effect";
import { type Decisions, type ShotRecord, VisualTimelineError } from "./contracts.js";
const fail = (code: VisualTimelineError["code"], message: string) => Effect.fail(new VisualTimelineError({ code, message }));

/** Record fields after decision overrides, plus the derived selection state. */
export type EffectiveShot = {
  readonly id: string; readonly startSample: number; readonly mode: ShotRecord["mode"];
  readonly label?: string; readonly prompt?: string; readonly imagePath?: string; readonly notes?: string;
  readonly createdAt: string; readonly producer: ShotRecord["producer"];
  readonly hidden: boolean; readonly selected: boolean; readonly selectionSource?: "decision" | "default";
};
/** Shots sharing one effective startSample. `selectedId` is null only when every candidate is hidden. */
export type CandidateGroup = { readonly startSample: number; readonly shots: ReadonlyArray<EffectiveShot>; readonly selectedId: string | null; readonly selectionSource: "decision" | "default" | null };
export type StitchedEntry =
  | (EffectiveShot & { readonly kind: "shot"; readonly endSample: number })
  | { readonly kind: "gap"; readonly startSample: number; readonly endSample: number };

/** Pure merge: validates decisions against records, groups candidates, and stitches holds over the whole clip. */
export function mergeTimeline(records: ReadonlyArray<ShotRecord>, decisions: Decisions, sampleCount: number, decisionsPath: string) {
  return Effect.gen(function* () {
    const byId = new Map(records.map(r => [r.id, r] as const));
    for (const [id, decision] of Object.entries(decisions.shots)) {
      if (!byId.has(id)) return yield* fail("InvalidDecisions", `Decision references a shot with no generation record: ${id} in ${decisionsPath}.`);
      if (decision.startSample !== undefined && decision.startSample >= sampleCount) return yield* fail("InvalidDecisions", `Decision startSample ${decision.startSample} is outside the clip's ${sampleCount} samples for shot ${id} in ${decisionsPath}.`);
      if (decision.selected === true && decision.hidden === true) return yield* fail("InvalidDecisions", `Shot ${id} is both selected and hidden in ${decisionsPath}.`);
    }
    const groups = new Map<number, Array<EffectiveShot & { selected: boolean; selectionSource?: "decision" | "default" }>>();
    for (const record of records) {
      const d = decisions.shots[record.id] ?? {};
      const { schemaVersion: _v, kind: _k, clip: _c, ...fields } = record;
      const shot = { ...fields, startSample: d.startSample ?? record.startSample, mode: d.mode ?? record.mode, ...(d.notes !== undefined ? { notes: d.notes } : {}),
        hidden: d.hidden === true, selected: false, ...(d.selected === true ? { selectionSource: "decision" as const } : {}) };
      const group = groups.get(shot.startSample) ?? [];
      group.push(shot); groups.set(shot.startSample, group);
    }
    const candidates: CandidateGroup[] = [];
    for (const startSample of [...groups.keys()].sort((a, b) => a - b)) {
      const shots = groups.get(startSample)!.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const explicit = shots.filter(s => s.selectionSource === "decision");
      if (explicit.length > 1) return yield* fail("InvalidDecisions", `More than one shot selected at sample ${startSample}: ${explicit.map(s => s.id).join(", ")} in ${decisionsPath}.`);
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
    return { candidates: candidates as ReadonlyArray<CandidateGroup>, stitched: stitched as ReadonlyArray<StitchedEntry> };
  });
}
