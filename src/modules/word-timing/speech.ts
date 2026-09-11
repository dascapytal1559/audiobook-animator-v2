/** Speech-region detection (A45): RMS energy per fixed frame, an absolute dBFS threshold, then run-length cleanup. Pure; no I/O. */

import type { SpeechRegion } from "@animator/domain";
export type { SpeechRegion };

/** Streaming per-frame RMS in dBFS over little-endian s16 bytes, the same chunk shape as the peaks reduction: chunks may split a sample, the last partial frame counts. A frame at exact digital zero is -Infinity dBFS. */
export class SpeechAccumulator {
  readonly framesDbfs: number[] = [];
  sampleCount = 0;
  private pendingLowByte: number | null = null;
  private sumSquares = 0;
  private frameFill = 0;
  constructor(readonly frameSamples: number) {
    if (!Number.isSafeInteger(frameSamples) || frameSamples < 1) throw new RangeError("frameSamples must be a positive integer.");
  }
  push(chunk: Uint8Array): void {
    let i = 0;
    if (this.pendingLowByte !== null && chunk.length > 0) {
      this.sample(this.pendingLowByte | (chunk[0]! << 8));
      this.pendingLowByte = null;
      i = 1;
    }
    for (; i + 1 < chunk.length; i += 2) this.sample(chunk[i]! | (chunk[i + 1]! << 8));
    if (i < chunk.length) this.pendingLowByte = chunk[i]!;
  }
  /** Close the open frame. Calling twice is a defect; a dangling half sample is one too. */
  finish(): { readonly framesDbfs: ReadonlyArray<number>; readonly sampleCount: number } {
    if (this.pendingLowByte !== null) throw new RangeError("The s16le byte stream ended halfway through a sample.");
    if (this.frameFill > 0) this.closeFrame();
    return { framesDbfs: this.framesDbfs, sampleCount: this.sampleCount };
  }
  private sample(unsigned16: number): void {
    const value = ((unsigned16 << 16) >> 16) / 32768;
    this.sumSquares += value * value;
    this.sampleCount++;
    if (++this.frameFill === this.frameSamples) this.closeFrame();
  }
  private closeFrame(): void {
    const rms = Math.sqrt(this.sumSquares / this.frameFill);
    this.framesDbfs.push(rms === 0 ? -Infinity : 20 * Math.log10(rms));
    this.sumSquares = 0; this.frameFill = 0;
  }
}

export type DetectOptions = {
  readonly frameSamples: number;
  /** A frame is speech when its RMS is at or above this level; -Infinity (digital zero) is always silence. */
  readonly thresholdDbfs: number;
  /** Silence runs shorter than this many frames are absorbed into the surrounding speech. 0 keeps every run. */
  readonly minSilenceFrames: number;
  /** Speech runs shorter than this many frames are dropped. 0 keeps every run. */
  readonly minSpeechFrames: number;
};

type Run = { speech: boolean; start: number; end: number };
const runs = (flags: ReadonlyArray<boolean>): Run[] => {
  const out: Run[] = [];
  for (let i = 0; i < flags.length; i++) {
    const last = out[out.length - 1];
    if (last !== undefined && last.speech === flags[i]) last.end = i + 1;
    else out.push({ speech: flags[i]!, start: i, end: i + 1 });
  }
  return out;
};
/** Relabel runs shorter than `minFrames` of kind `speech` to the opposite kind and merge neighbours. */
const absorb = (input: ReadonlyArray<Run>, speech: boolean, minFrames: number): Run[] =>
  runs(input.flatMap(r => Array.from({ length: r.end - r.start }, () => r.speech === speech && r.end - r.start < minFrames ? !speech : r.speech)));

/**
 * Threshold each frame, then clean up in a fixed order: (1) drop speech runs shorter than `minSpeechFrames` (clicks and breaths become silence),
 * (2) bridge silence runs shorter than `minSilenceFrames` (intra-phrase gaps become speech), (3) drop again any speech run that is still shorter
 * than `minSpeechFrames`, which cannot create new short silences because it only widens them. Regions are on the sample clock; the last region
 * ends at `sampleCount` when the final partial frame is speech.
 */
export function detectRegions(framesDbfs: ReadonlyArray<number>, options: DetectOptions, sampleCount = framesDbfs.length * options.frameSamples): ReadonlyArray<SpeechRegion> {
  const { frameSamples, thresholdDbfs, minSilenceFrames, minSpeechFrames } = options;
  if (!Number.isSafeInteger(frameSamples) || frameSamples < 1) throw new RangeError("frameSamples must be a positive integer.");
  if (!Number.isSafeInteger(minSilenceFrames) || minSilenceFrames < 0 || !Number.isSafeInteger(minSpeechFrames) || minSpeechFrames < 0) throw new RangeError("minSilenceFrames and minSpeechFrames must be non-negative integers.");
  if (!Number.isFinite(thresholdDbfs)) throw new RangeError("thresholdDbfs must be finite.");
  if (framesDbfs.length !== Math.ceil(sampleCount / frameSamples)) throw new RangeError(`${framesDbfs.length} frames of ${frameSamples} samples do not cover ${sampleCount} samples.`);
  let current = runs(framesDbfs.map(db => db >= thresholdDbfs));
  current = absorb(current, true, minSpeechFrames);
  current = absorb(current, false, minSilenceFrames);
  current = absorb(current, true, minSpeechFrames);
  return current.filter(r => r.speech).map(r => ({ startSample: r.start * frameSamples, endSample: Math.min(sampleCount, r.end * frameSamples) }));
}
