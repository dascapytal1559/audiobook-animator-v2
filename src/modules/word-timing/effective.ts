import type { TimingEntries, TimingEntry } from "./contracts.js";

/** A transcript word with its provider timing on the clip clock. */
export type SourceWord = { readonly id: string; readonly value: string; readonly startSample: number; readonly endSample: number };
/** A word after the overlays: top-level times are effective (manual, else auto, else original); the layers stay visible for the three tracks (A52). */
export type EffectiveWord = SourceWord & { readonly original: TimingEntry; readonly auto?: TimingEntry; readonly manual?: TimingEntry };
export type EffectiveTiming = {
  readonly words: ReadonlyArray<EffectiveWord>;
  /** Neighbouring pairs, in transcript order, whose effective starts are out of order. Not rejected: manual and auto entries mix freely (A42). */
  readonly inversions: number;
  readonly manualCount: number; readonly autoCount: number;
};

/** Validate one overlay's entries against the transcript: every key a word id, `0 <= startSample < endSample <= sampleCount`. Returns the first problem, naming `label`. */
export function validateEntries(entries: TimingEntries, wordIds: ReadonlySet<string>, sampleCount: number, label: string): string | null {
  for (const [id, entry] of Object.entries(entries)) {
    if (!wordIds.has(id)) return `Timing entry names a word that is not in the transcript: ${id} in ${label}.`;
    if (!(entry.startSample >= 0 && entry.startSample < entry.endSample && entry.endSample <= sampleCount)) return `Timing entry for ${id} must satisfy 0 <= startSample < endSample <= ${sampleCount}, got ${entry.startSample}..${entry.endSample} in ${label}.`;
  }
  return null;
}

/** Pure precedence merge: manual, else auto, else original. Entries for ids not in `words` are ignored; validate first. */
export function effectiveTiming(words: ReadonlyArray<SourceWord>, auto: TimingEntries | undefined, manual: TimingEntries | undefined): EffectiveTiming {
  let manualCount = 0, autoCount = 0, inversions = 0;
  const merged: EffectiveWord[] = words.map(word => {
    const original = { startSample: word.startSample, endSample: word.endSample };
    const a = auto?.[word.id]; const m = manual?.[word.id];
    if (a !== undefined) autoCount++;
    if (m !== undefined) manualCount++;
    const effective = m ?? a ?? original;
    return { id: word.id, value: word.value, startSample: effective.startSample, endSample: effective.endSample, original, ...(a !== undefined ? { auto: a } : {}), ...(m !== undefined ? { manual: m } : {}) };
  });
  for (let i = 1; i < merged.length; i++) if (merged[i]!.startSample < merged[i - 1]!.startSample) inversions++;
  return { words: merged, inversions, manualCount, autoCount };
}
