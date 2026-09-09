/** Snap targets for shot-start dragging (A34): word starts and the midpoints of inter-word pauses at least `minPauseSamples` long. */

export type SnapWord = { readonly id: string; readonly value: string; readonly startSample: number; readonly endSample: number };
export type SnapTarget =
  | { readonly kind: "word-start"; readonly sample: number; readonly wordId: string; readonly value: string }
  | { readonly kind: "pause-midpoint"; readonly sample: number; readonly pauseStart: number; readonly pauseEnd: number };

/** Builds the sorted target list once per transcript. Words are sorted by start; overlapping or unordered words never produce a pause. */
export function computeSnapTargets(words: ReadonlyArray<SnapWord>, minPauseSamples: number): ReadonlyArray<SnapTarget> {
  if (!Number.isInteger(minPauseSamples) || minPauseSamples < 1) throw new RangeError(`minPauseSamples must be a positive integer, got ${minPauseSamples}.`);
  const sorted = [...words].sort((a, b) => a.startSample - b.startSample || a.endSample - b.endSample);
  const targets: SnapTarget[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const word = sorted[i]!;
    targets.push({ kind: "word-start", sample: word.startSample, wordId: word.id, value: word.value });
    const next = sorted[i + 1];
    if (next === undefined) continue;
    const pause = next.startSample - word.endSample;
    if (pause >= minPauseSamples) {
      targets.push({ kind: "pause-midpoint", sample: word.endSample + Math.floor(pause / 2), pauseStart: word.endSample, pauseEnd: next.startSample });
    }
  }
  targets.sort((a, b) => a.sample - b.sample);
  return targets;
}

/** Nearest target within `radiusSamples` of `sample`, or null. Ties prefer the earlier target. Binary search over the sorted list. */
export function findSnapTarget(targets: ReadonlyArray<SnapTarget>, sample: number, radiusSamples: number): SnapTarget | null {
  if (!(radiusSamples >= 0)) throw new RangeError(`radiusSamples must be non-negative, got ${radiusSamples}.`);
  if (targets.length === 0) return null;
  let lo = 0;
  let hi = targets.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (targets[mid]!.sample < sample) lo = mid + 1;
    else hi = mid;
  }
  const before = targets[lo - 1];
  const after = targets[lo];
  const candidates = [before, after].filter((t): t is SnapTarget => t !== undefined);
  let best: SnapTarget | null = null;
  for (const t of candidates) {
    const distance = Math.abs(t.sample - sample);
    if (distance > radiusSamples) continue;
    if (best === null || distance < Math.abs(best.sample - sample)) best = t;
  }
  return best;
}
