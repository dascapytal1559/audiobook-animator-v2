import assert from "node:assert/strict";
import test from "node:test";
import { detectRegions, SpeechAccumulator } from "./index.js";
const s16le = (samples: ReadonlyArray<number>) => { const b = Buffer.alloc(samples.length * 2); samples.forEach((s, i) => b.writeInt16LE(s, i * 2)); return b; };
const dbfs = (samples: ReadonlyArray<number>) => { const rms = Math.sqrt(samples.reduce((acc, s) => acc + (s / 32768) ** 2, 0) / samples.length); return rms === 0 ? -Infinity : 20 * Math.log10(rms); };

test("the speech accumulator frames RMS in dBFS across odd chunk splits, counts the partial last frame, and reports digital zero as -Infinity", () => {
  const samples = [0, 0, 0, 0, 16384, -16384, 16384, -16384, 32767, -32768, 100, 0, 3];
  const bytes = s16le(samples);
  const accumulator = new SpeechAccumulator(4);
  for (const [start, end] of [[0, 1], [1, 9], [9, 9], [9, 20], [20, bytes.length]] as const) accumulator.push(bytes.subarray(start, end));
  const result = accumulator.finish();
  assert.equal(result.sampleCount, 13);
  assert.equal(result.framesDbfs.length, 4, "4 + 4 + 4 + 1 samples");
  assert.equal(result.framesDbfs[0], -Infinity, "a frame at exact digital zero");
  assert.ok(Math.abs(result.framesDbfs[1]! - dbfs([16384, -16384, 16384, -16384])) < 1e-9);
  assert.ok(Math.abs(result.framesDbfs[1]! - -6.02) < 0.01, "half scale is about -6 dBFS");
  assert.ok(Math.abs(result.framesDbfs[2]! - dbfs([32767, -32768, 100, 0])) < 1e-9);
  assert.ok(Math.abs(result.framesDbfs[3]! - dbfs([3])) < 1e-9, "the partial frame is averaged over its own length");
  const dangling = new SpeechAccumulator(4); dangling.push(Buffer.from([0, 0, 1]));
  assert.throws(() => dangling.finish(), /halfway through a sample/);
  assert.deepEqual(new SpeechAccumulator(4).finish(), { framesDbfs: [], sampleCount: 0 });
  assert.throws(() => new SpeechAccumulator(0), RangeError);
});

test("region detection thresholds frames, drops short speech before bridging short silence, and keeps regions on the sample clock", () => {
  const S = -20, Q = -80;
  // speech(6) silence(1) speech(6) | silence(3) | click(1) | silence(3) | speech(5) | silence(2) partial frame
  const frames = [S, S, S, S, S, S, Q, S, S, S, S, S, S, Q, Q, Q, S, Q, Q, Q, S, S, S, S, S, -Infinity, -Infinity];
  const base = { frameSamples: 10, thresholdDbfs: -50 };
  assert.deepEqual(detectRegions(frames, { ...base, minSilenceFrames: 0, minSpeechFrames: 0 }), [
    { startSample: 0, endSample: 60 }, { startSample: 70, endSample: 130 }, { startSample: 160, endSample: 170 }, { startSample: 200, endSample: 250 }], "raw thresholding");
  assert.deepEqual(detectRegions(frames, { ...base, minSilenceFrames: 2, minSpeechFrames: 2 }), [
    { startSample: 0, endSample: 130 }, { startSample: 200, endSample: 250 }], "the one-frame gap is bridged; the click is dropped first, so the two 3-frame silences around it merge into a real 7-frame gap");
  assert.deepEqual(detectRegions(frames, { ...base, minSilenceFrames: 4, minSpeechFrames: 0 }), [
    { startSample: 0, endSample: 270 }], "without speech cleanup the click splits the gap into two short silences that both get bridged, as does the short trailing silence");
  assert.deepEqual(detectRegions(frames, { ...base, minSilenceFrames: 4, minSpeechFrames: 2 }), [
    { startSample: 0, endSample: 130 }, { startSample: 200, endSample: 270 }], "speech cleanup first keeps that gap");
  assert.deepEqual(detectRegions(frames, { ...base, minSilenceFrames: 0, minSpeechFrames: 6 }), [
    { startSample: 0, endSample: 60 }, { startSample: 70, endSample: 130 }], "speech runs shorter than the minimum are dropped");
  assert.deepEqual(detectRegions([Q, S, S], { ...base, minSilenceFrames: 0, minSpeechFrames: 0 }, 25), [{ startSample: 10, endSample: 25 }], "a trailing partial frame ends at the clip");
  assert.deepEqual(detectRegions([-Infinity, -Infinity], { ...base, minSilenceFrames: 0, minSpeechFrames: 0 }), [], "digital zero is silence at any threshold");
  assert.deepEqual(detectRegions([S, S], { ...base, thresholdDbfs: -20, minSilenceFrames: 0, minSpeechFrames: 0 }), [{ startSample: 0, endSample: 20 }], "a frame exactly at the threshold is speech");
  assert.deepEqual(detectRegions([], { ...base, minSilenceFrames: 0, minSpeechFrames: 0 }), []);
  assert.throws(() => detectRegions([S], { ...base, minSilenceFrames: 0, minSpeechFrames: 0 }, 25), /do not cover/);
  assert.throws(() => detectRegions([S], { ...base, minSilenceFrames: -1, minSpeechFrames: 0 }), RangeError);
});
