/**
 * Word timing on the client (A39, A40, A42): the effective layer merge, the group move with its neighbour clamp, and the manual
 * overlay map that autosave sends. Words are always handled in transcript order; the row order is the order the story lists them.
 */
import { effectiveTiming, type TimingEntries } from "@animator/domain";
import type { Span, Word } from "./api.js";
import type { IndexRange } from "./selection.js";

export type ManualMap = Readonly<Record<string, Span>>;

/** The complete manual overlay as the story reports it, the starting point of the undo stack. */
export function manualMapOf(words: ReadonlyArray<Word>): ManualMap {
  const map: Record<string, Span> = {};
  for (const word of words) if (word.manual !== undefined) map[word.id] = { startSample: word.manual.startSample, endSample: word.manual.endSample };
  return map;
}

/** Words with the local manual map applied through the shared rule: the top-level times are manual, else auto, else original, and `manual` mirrors the map. */
export function effectiveWords(words: ReadonlyArray<Word>, manual: ManualMap): ReadonlyArray<Word> {
  const auto: Record<string, Span> = {};
  for (const word of words) if (word.auto !== undefined) auto[word.id] = word.auto;
  return effectiveTiming(words.map(w => ({ id: w.id, value: w.value, startSample: w.original.startSample, endSample: w.original.endSample })), auto, manual as TimingEntries).words;
}

/**
 * Bounds on a delta so the range keeps its order and never overlaps its unselected neighbours (A40): the first word's start stays at
 * or after the previous word's end (or clip start) and the last word's end at or before the next word's start (or clip end).
 */
export function deltaBounds(words: ReadonlyArray<Span>, range: IndexRange, sampleCount: number): { min: number; max: number } {
  const first = words[range.first];
  const last = words[range.last];
  if (first === undefined || last === undefined) throw new RangeError(`Range ${range.first}–${range.last} is outside the ${words.length} words.`);
  const previous = words[range.first - 1];
  const next = words[range.last + 1];
  const min = (previous?.endSample ?? 0) - first.startSample;
  const max = (next?.startSample ?? sampleCount) - last.endSample;
  return { min: Math.min(0, min), max: Math.max(0, max) };
}

export function clampDelta(words: ReadonlyArray<Span>, range: IndexRange, delta: number, sampleCount: number): number {
  const { min, max } = deltaBounds(words, range, sampleCount);
  return Math.round(Math.min(max, Math.max(min, delta)));
}

/** The words with `delta` applied to the range: the view during a drag. Ends ride along so durations are preserved (Q21). */
export function shiftedWords(words: ReadonlyArray<Word>, range: IndexRange, delta: number): ReadonlyArray<Word> {
  if (delta === 0) return words;
  return words.map((word, i) => (i < range.first || i > range.last ? word : { ...word, startSample: word.startSample + delta, endSample: word.endSample + delta }));
}

/** The manual map after committing a move: every word in the range gets its shifted effective span; the rest of the map is untouched. */
export function moveWords(manual: ManualMap, words: ReadonlyArray<Word>, range: IndexRange, delta: number): ManualMap {
  const next: Record<string, Span> = { ...manual };
  for (let i = range.first; i <= range.last; i++) {
    const word = words[i]!;
    next[word.id] = { startSample: word.startSample + delta, endSample: word.endSample + delta };
  }
  return next;
}

/** Effective start per word id, the lookup the shot merge resolves anchors through (A51). */
export function wordStartMap(words: ReadonlyArray<Span & { id: string }>): ReadonlyMap<string, number> {
  return new Map(words.map(w => [w.id, w.startSample]));
}
