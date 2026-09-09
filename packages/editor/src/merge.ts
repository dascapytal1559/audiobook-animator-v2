/**
 * Client-side mirror of src/modules/visual-timeline/merge.ts so local edits render before the server confirms them.
 * The server's merge is authoritative; this must stay semantically identical. It never validates, because the reducer only
 * produces decisions the server accepts (one selected per group, never selected and hidden together, starts inside the clip).
 */
import type { CandidateGroup, DecisionsBody, EffectiveShot, ShotRecord, StitchedEntry } from "./api.js";

export type Merged = { candidates: ReadonlyArray<CandidateGroup>; stitched: ReadonlyArray<StitchedEntry> };

/**
 * `wordStarts` maps word id to effective start (A51): an anchored shot starts where its word starts, else at its `startSample` override,
 * else at the record. An anchor to an unknown word is ignored rather than failing, so a stale decision still renders.
 */
export function mergeTimeline(records: ReadonlyArray<ShotRecord>, decisions: DecisionsBody, sampleCount: number, wordStarts: ReadonlyMap<string, number>): Merged {
  const groups = new Map<number, EffectiveShot[]>();
  for (const record of records) {
    const d = decisions.shots[record.id] ?? {};
    const { schemaVersion: _v, kind: _k, clip: _c, ...fields } = record;
    const anchored = d.anchorWordId !== undefined ? wordStarts.get(d.anchorWordId) : undefined;
    const shot: EffectiveShot = {
      ...fields, startSample: anchored ?? d.startSample ?? record.startSample, mode: d.mode ?? record.mode, ...(d.notes !== undefined ? { notes: d.notes } : {}),
      hidden: d.hidden === true, selected: false, ...(d.selected === true ? { selectionSource: "decision" as const } : {}),
      ...(anchored !== undefined && d.anchorWordId !== undefined ? { anchorWordId: d.anchorWordId } : {}),
    };
    const group = groups.get(shot.startSample) ?? [];
    group.push(shot);
    groups.set(shot.startSample, group);
  }
  const candidates: CandidateGroup[] = [];
  for (const startSample of [...groups.keys()].sort((a, b) => a - b)) {
    const shots = groups.get(startSample)!.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const explicit = shots.filter(s => s.selectionSource === "decision");
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
  return { candidates, stitched };
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
