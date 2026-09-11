import { Schema } from "effect";
import { ClipIdentity, Producer } from "./identity.js";
import { IsoUtc, NonNegative, Positive } from "./schema.js";

/** One word's span on the clip clock. Keys of the overlay maps are transcript word ids; `startSample < endSample <= sampleCount` is checked against the loaded transcript, not here. */
export const TimingEntry = Schema.Struct({ startSample: NonNegative, endSample: NonNegative });
export type TimingEntry = typeof TimingEntry.Type;
export const TimingEntries = Schema.Record(Schema.String, TimingEntry);
export type TimingEntries = typeof TimingEntries.Type;
/** A detected speech region on the clip clock; regions are sorted and disjoint. */
export type SpeechRegion = TimingEntry;

/** Before/after statistics for one range (A48). Percentiles are null when the range holds no phrase boundary; the fraction is null when it holds no word. */
export const TimingMeasure = Schema.Struct({
  wordCount: NonNegative, boundaryCount: NonNegative,
  onsetErrorMs: Schema.NullOr(Schema.Struct({ median: Schema.Number, p10: Schema.Number, p90: Schema.Number })),
  insideSpeechCount: NonNegative, insideSpeechFraction: Schema.NullOr(Schema.Number),
});
export type TimingMeasure = typeof TimingMeasure.Type;
export const AlignReport = Schema.Struct({
  range: Schema.Struct({ startSample: NonNegative, endSample: NonNegative }), wordCount: NonNegative, regionCount: NonNegative, leadMs: Schema.Int, boundaryPauseMs: Positive,
  before: TimingMeasure, after: TimingMeasure,
});
export type AlignReport = typeof AlignReport.Type;
export const AlignParameters = Schema.Struct({ leadMs: Schema.Int, thresholdDbfs: Schema.Number, minSilenceMs: Positive, minSpeechMs: Positive });
export type AlignParameters = typeof AlignParameters.Type;
export const AlignRun = Schema.Struct({ startSample: NonNegative, endSample: NonNegative, ranAt: IsoUtc, report: AlignReport });
export type AlignRun = typeof AlignRun.Type;
/** `<story>/word-timing.auto.json`: written only by the align pass (A42). Entries for a range are replaced by each run over it; every run is appended. */
export const WordTimingAuto = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("word-timing-auto"), clip: ClipIdentity, updatedAt: IsoUtc, producer: Producer,
  parameters: AlignParameters, runs: Schema.Array(AlignRun), words: TimingEntries,
});
export type WordTimingAuto = typeof WordTimingAuto.Type;
/** `<story>/word-timing.json`: written only by the editor (A42). Replaced wholesale on every save. */
export const WordTimingManual = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("word-timing-manual"), clip: ClipIdentity, updatedAt: IsoUtc, words: TimingEntries,
});
export type WordTimingManual = typeof WordTimingManual.Type;

// ---------------------------------------------------------------------------------------------------------------------
// Effective timing (A37, A42)

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

// ---------------------------------------------------------------------------------------------------------------------
// The energy-only align pass (A47) and its measurement (A48)

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
  /** Ids of words that begin a sentence (the first word after `.`, `?`, or `!`, plus the first word). Lets a word that overlaps no speech region follow its
   * sentence neighbours instead of the merely nearest region (a 17 ms coin flip on the pilot corpus). Absent means nearest-region only. */
  readonly sentenceStartIds?: ReadonlySet<string>;
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
 * the lead, assigns each to the speech region it overlaps most. A word that overlaps no region joins the region of its nearest overlapping neighbour
 * within the same sentence (walking outward in transcript order, stopping at a sentence start); with such a neighbour on both sides, or none, it takes
 * the nearest region by distance (earliest wins ties). Then maps every region's words linearly so the earliest start lands on the region start and the
 * latest end on the region end; a lone word fills its region. Regions are first clipped to the range and regions outside it dropped, so no entry ever
 * leaves the range; with no region in the range there are no entries. Word order within a region is preserved; results are integers with
 * `startSample < endSample`. Words outside the range are untouched.
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
    const starts = input.sentenceStartIds ?? new Set<string>();
    // Pass 1: the region each shifted word overlaps most. Overlap is negative by exactly the gap when disjoint, so the largest overlap is also the
    // nearest region when nothing overlaps; `overlaps` records whether it actually touched speech.
    const shiftedWords = inRange.map(word => ({ id: word.id, startSample: word.startSample + leadSamples, endSample: word.endSample + leadSamples }));
    const nearest = shiftedWords.map(shifted => {
      let best = 0, bestOverlap = -Infinity;
      clipped.forEach((r, i) => {
        const overlap = Math.min(r.endSample, shifted.endSample) - Math.max(r.startSample, shifted.startSample);
        if (overlap > bestOverlap) { best = i; bestOverlap = overlap; }
      });
      return { best, overlaps: bestOverlap > 0 };
    });
    // Pass 2: a word in silence follows its sentence. Walk backwards to the previous overlapping word without crossing a sentence start (this
    // word being a sentence start means there is no previous neighbour), and forwards to the next overlapping word without crossing one.
    const neighbourRegion = (index: number, step: -1 | 1): number | null => {
      for (let j = index; ; j += step) {
        if (step === -1 && starts.has(shiftedWords[j]!.id)) return null;
        const k = j + step;
        if (k < 0 || k >= shiftedWords.length) return null;
        if (step === 1 && starts.has(shiftedWords[k]!.id)) return null;
        if (nearest[k]!.overlaps) return nearest[k]!.best;
      }
    };
    shiftedWords.forEach((shifted, index) => {
      let best = nearest[index]!.best;
      if (!nearest[index]!.overlaps) {
        const before = neighbourRegion(index, -1), after = neighbourRegion(index, 1);
        if (before !== null && after === null) best = before;
        else if (after !== null && before === null) best = after;
      }
      const group = groups.get(best) ?? [];
      group.push(shifted); groups.set(best, group);
    });
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
