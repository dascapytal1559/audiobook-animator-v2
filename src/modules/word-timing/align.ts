import type { AlignReport, TimingEntries, TimingEntry, TimingMeasure } from "./contracts.js";
import type { SpeechRegion } from "./speech.js";

export type TimedWord = TimingEntry & { readonly id: string };
export type SampleRange = { readonly startSample: number; readonly endSample: number };
export type MeasureInput = {
  /** The range's words, in transcript order, carrying the timing being measured. */
  readonly words: ReadonlyArray<TimingEntry>;
  /** Every detected region of the clip, sorted and disjoint. */
  readonly regions: ReadonlyArray<SpeechRegion>;
  readonly sampleRateHz: number;
  /** A word starting at least this far after the previous word's end is a phrase boundary; the first word always is. */
  readonly boundaryPauseSamples: number;
};
export type AlignInput = {
  /** Every transcript word with its ORIGINAL provider timing, in transcript order. Manual and auto overlays are never an input (A42). */
  readonly words: ReadonlyArray<TimedWord>;
  readonly regions: ReadonlyArray<SpeechRegion>;
  readonly range: SampleRange;
  readonly sampleRateHz: number;
  readonly leadMs: number;
  readonly boundaryPauseMs: number;
};

const round1 = (x: number) => Math.round(x * 10) / 10;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
/** Linear-interpolation quantile of a sorted, non-empty array. */
const quantile = (sorted: ReadonlyArray<number>, p: number) => {
  const position = p * (sorted.length - 1);
  const lo = Math.floor(position), hi = Math.ceil(position);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (position - lo);
};

/** Before/after statistics for one range (A48): signed onset error at phrase boundaries against the nearest speech onset, and how many words sit wholly inside speech. */
export function measureRange(input: MeasureInput): TimingMeasure {
  const { words, regions, sampleRateHz, boundaryPauseSamples } = input;
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) throw new RangeError("sampleRateHz must be positive.");
  const toMs = (samples: number) => (samples / sampleRateHz) * 1000;
  const errors: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const boundary = i === 0 || word.startSample - words[i - 1]!.endSample >= boundaryPauseSamples;
    if (!boundary || regions.length === 0) continue;
    let nearest = Infinity;
    for (const region of regions) { const d = word.startSample - region.startSample; if (Math.abs(d) < Math.abs(nearest)) nearest = d; }
    errors.push(toMs(nearest));
  }
  errors.sort((a, b) => a - b);
  const inside = words.filter(w => regions.some(r => w.startSample >= r.startSample && w.endSample <= r.endSample)).length;
  const boundaryCount = words.length === 0 ? 0 : words.filter((w, i) => i === 0 || w.startSample - words[i - 1]!.endSample >= boundaryPauseSamples).length;
  return {
    wordCount: words.length, boundaryCount,
    onsetErrorMs: errors.length === 0 ? null : { median: round1(quantile(errors, 0.5)), p10: round1(quantile(errors, 0.1)), p90: round1(quantile(errors, 0.9)) },
    insideSpeechCount: inside, insideSpeechFraction: words.length === 0 ? null : Math.round((inside / words.length) * 10_000) / 10_000,
  };
}

/**
 * The energy-only first pass (A47), pure. Takes the words whose original start lies in `[range.startSample, range.endSample)`, shifts each later by
 * the lead, assigns each to the speech region it overlaps most (the nearest region when it overlaps none; earliest wins ties), then maps every
 * region's words linearly so the earliest start lands on the region start and the latest end on the region end; a lone word fills its region.
 * Regions are first clipped to the range and regions outside it dropped, so no entry ever leaves the range; with no region in the range there are
 * no entries. Word order within a region is preserved; results are integers with `startSample < endSample`. Words outside the range are untouched.
 */
export function alignRange(input: AlignInput): { readonly entries: TimingEntries; readonly report: AlignReport } {
  const { words, regions, range, sampleRateHz, leadMs, boundaryPauseMs } = input;
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) throw new RangeError("sampleRateHz must be positive.");
  if (!Number.isSafeInteger(range.startSample) || !Number.isSafeInteger(range.endSample) || range.startSample < 0 || range.startSample >= range.endSample) throw new RangeError(`Range must satisfy 0 <= startSample < endSample, got ${range.startSample}..${range.endSample}.`);
  const leadSamples = Math.round((leadMs / 1000) * sampleRateHz);
  const boundaryPauseSamples = Math.round((boundaryPauseMs / 1000) * sampleRateHz);
  const inRange = words.filter(w => w.startSample >= range.startSample && w.startSample < range.endSample);
  const clipped = regions.map(r => ({ startSample: Math.max(r.startSample, range.startSample), endSample: Math.min(r.endSample, range.endSample) })).filter(r => r.startSample < r.endSample);
  const entries: Record<string, TimingEntry> = {};
  if (clipped.length > 0) {
    const groups = new Map<number, Array<TimedWord>>();
    for (const word of inRange) {
      const shifted = { id: word.id, startSample: word.startSample + leadSamples, endSample: word.endSample + leadSamples };
      // Overlap is negative by exactly the gap when the two are disjoint, so the largest overlap is also the nearest region when nothing overlaps.
      let best = 0, bestOverlap = -Infinity;
      clipped.forEach((r, i) => {
        const overlap = Math.min(r.endSample, shifted.endSample) - Math.max(r.startSample, shifted.startSample);
        if (overlap > bestOverlap) { best = i; bestOverlap = overlap; }
      });
      const group = groups.get(best) ?? [];
      group.push(shifted); groups.set(best, group);
    }
    for (const [index, group] of groups) {
      const region = clipped[index]!;
      const first = Math.min(...group.map(w => w.startSample)), last = Math.max(...group.map(w => w.endSample));
      const scale = (region.endSample - region.startSample) / (last - first);
      const map = (x: number) => region.startSample + (x - first) * scale;
      for (const word of group) {
        const startSample = clamp(Math.round(map(word.startSample)), region.startSample, region.endSample - 1);
        const endSample = clamp(Math.round(map(word.endSample)), startSample + 1, region.endSample);
        entries[word.id] = { startSample, endSample };
      }
    }
  }
  const measure = (timing: (w: TimedWord) => TimingEntry) => measureRange({ words: inRange.map(timing), regions, sampleRateHz, boundaryPauseSamples });
  const report: AlignReport = { range: { startSample: range.startSample, endSample: range.endSample }, wordCount: inRange.length, regionCount: clipped.length, leadMs, boundaryPauseMs,
    before: measure(w => ({ startSample: w.startSample, endSample: w.endSample })), after: measure(w => entries[w.id] ?? { startSample: w.startSample, endSample: w.endSample }) };
  return { entries, report };
}
