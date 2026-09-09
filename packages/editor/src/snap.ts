/**
 * Snap targets. Shot-start dragging (A34) snaps to chunk starts, word starts, and the midpoints of inter-word pauses at least
 * `minPauseSamples` long; a word group move (A39) snaps its leading edge to speech-region onsets. Both lists share `findSnapTarget`.
 */

export type SnapWord = { readonly id: string; readonly value: string; readonly startSample: number; readonly endSample: number };
export type SnapChunk = { readonly id: string; readonly text: string; readonly startSample: number; readonly wordIds: ReadonlyArray<string> };
export type SnapTarget =
  | { readonly kind: "chunk-start"; readonly sample: number; readonly chunkId: string; readonly text: string; readonly firstWordId: string }
  | { readonly kind: "word-start"; readonly sample: number; readonly wordId: string; readonly value: string }
  | { readonly kind: "pause-midpoint"; readonly sample: number; readonly pauseStart: number; readonly pauseEnd: number }
  | { readonly kind: "speech-onset"; readonly sample: number; readonly regionEnd: number };

/** Lower rank wins when two targets are equally near: a chunk start beats the word start it coincides with, which beats a pause midpoint. */
const RANK: Record<SnapTarget["kind"], number> = { "chunk-start": 0, "word-start": 1, "pause-midpoint": 2, "speech-onset": 3 };

/** One target per speech region start, sorted by sample. Regions with no words are still onsets: that is where a misplaced phrase belongs. */
export function computeSpeechOnsetTargets(regions: ReadonlyArray<{ readonly startSample: number; readonly endSample: number }>): ReadonlyArray<SnapTarget> {
  return [...regions].sort((a, b) => a.startSample - b.startSample).map(r => ({ kind: "speech-onset", sample: r.startSample, regionEnd: r.endSample }));
}

/** Builds the target list once per transcript, sorted by sample then rank. Words are sorted by start; overlapping or unordered words never produce a pause. */
export function computeSnapTargets(words: ReadonlyArray<SnapWord>, chunks: ReadonlyArray<SnapChunk>, minPauseSamples: number): ReadonlyArray<SnapTarget> {
  if (!Number.isInteger(minPauseSamples) || minPauseSamples < 1) throw new RangeError(`minPauseSamples must be a positive integer, got ${minPauseSamples}.`);
  const sorted = [...words].sort((a, b) => a.startSample - b.startSample || a.endSample - b.endSample);
  const targets: SnapTarget[] = chunks.flatMap(c => {
    const firstWordId = c.wordIds[0];
    return firstWordId === undefined ? [] : [{ kind: "chunk-start" as const, sample: c.startSample, chunkId: c.id, text: c.text, firstWordId }];
  });
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
  targets.sort((a, b) => a.sample - b.sample || RANK[a.kind] - RANK[b.kind]);
  return targets;
}

/**
 * Nearest target within `radiusSamples` of `sample`, or null. Ties prefer chunk starts over word starts over pause midpoints, then the
 * earlier target. Binary search over the sorted list, then every target sharing the sample on either side is considered.
 */
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
  let best: SnapTarget | null = null;
  const consider = (t: SnapTarget) => {
    const distance = Math.abs(t.sample - sample);
    if (distance > radiusSamples) return;
    if (best === null) { best = t; return; }
    const bestDistance = Math.abs(best.sample - sample);
    if (distance < bestDistance || (distance === bestDistance && (RANK[t.kind] < RANK[best.kind] || (RANK[t.kind] === RANK[best.kind] && t.sample < best.sample)))) best = t;
  };
  for (let i = lo - 1; i >= 0 && targets[i]!.sample === targets[lo - 1]!.sample; i--) consider(targets[i]!);
  for (let i = lo; i < targets.length && targets[i]!.sample === targets[lo]!.sample; i++) consider(targets[i]!);
  return best;
}
