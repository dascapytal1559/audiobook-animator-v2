import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSnapTargets, computeSpeechOnsetTargets, findSnapTarget, type SnapChunk, type SnapWord } from "./snap.js";

const words: SnapWord[] = [
  { id: "w1", value: "The", startSample: 1000, endSample: 2000 },
  { id: "w2", value: "great", startSample: 2100, endSample: 3000 },
  { id: "w3", value: "silence", startSample: 5000, endSample: 6000 },
  { id: "w4", value: "falls", startSample: 6050, endSample: 7000 },
];
const chunks: SnapChunk[] = [
  { id: "c0", text: "The great.", startSample: 1000, wordIds: ["w1", "w2"] },
  { id: "c1", text: "silence falls", startSample: 5000, wordIds: ["w3", "w4"] },
];

test("targets include every word start and only pauses at least the minimum length", () => {
  const targets = computeSnapTargets(words, [], 1500);
  assert.deepEqual(targets.map(t => [t.kind, t.sample]), [
    ["word-start", 1000], ["word-start", 2100], ["pause-midpoint", 4000], ["word-start", 5000], ["word-start", 6050],
  ]);
  const pause = targets[2];
  assert.equal(pause?.kind, "pause-midpoint");
  if (pause?.kind === "pause-midpoint") { assert.equal(pause.pauseStart, 3000); assert.equal(pause.pauseEnd, 5000); }
});

test("targets are sorted even when words arrive out of order", () => {
  const shuffled = [words[2]!, words[0]!, words[3]!, words[1]!];
  const targets = computeSnapTargets(shuffled, [], 1500);
  assert.deepEqual(targets.map(t => t.sample), [1000, 2100, 4000, 5000, 6050]);
});

test("a pause exactly at the threshold counts and an odd pause midpoint floors", () => {
  const targets = computeSnapTargets([
    { id: "a", value: "a", startSample: 0, endSample: 100 },
    { id: "b", value: "b", startSample: 401, endSample: 500 },
  ], [], 301);
  assert.deepEqual(targets.map(t => [t.kind, t.sample]), [["word-start", 0], ["pause-midpoint", 250], ["word-start", 401]]);
});

test("findSnapTarget returns the nearest target inside the radius and null outside it", () => {
  const targets = computeSnapTargets(words, [], 1500);
  assert.equal(findSnapTarget(targets, 2050, 100)?.sample, 2100);
  assert.equal(findSnapTarget(targets, 2049, 100)?.sample, 2100);
  assert.equal(findSnapTarget(targets, 1990, 100), null);
  assert.equal(findSnapTarget(targets, 2010, 100)?.sample, 2100);
  assert.equal(findSnapTarget(targets, 4100, 100)?.sample, 4000);
  assert.equal(findSnapTarget(targets, 4400, 100), null);
  assert.equal(findSnapTarget(targets, 0, 999), null);
  assert.equal(findSnapTarget(targets, 0, 1000)?.sample, 1000);
  assert.equal(findSnapTarget(targets, 9000, 100), null);
  assert.equal(findSnapTarget([], 1, 10), null);
});

test("ties prefer the earlier target and exact hits snap at radius zero", () => {
  const targets = computeSnapTargets(words, [], 1500);
  assert.equal(findSnapTarget(targets, 1550, 600)?.sample, 1000);
  assert.equal(findSnapTarget(targets, 5000, 0)?.sample, 5000);
  assert.throws(() => findSnapTarget(targets, 1, -1), RangeError);
});

test("every chunk start is a target, sorted before the word start it shares a sample with", () => {
  const targets = computeSnapTargets(words, chunks, 1500);
  assert.deepEqual(targets.map(t => [t.kind, t.sample]), [
    ["chunk-start", 1000], ["word-start", 1000], ["word-start", 2100], ["pause-midpoint", 4000], ["chunk-start", 5000], ["word-start", 5000], ["word-start", 6050],
  ]);
  const first = targets[0];
  assert.equal(first?.kind, "chunk-start");
  if (first?.kind === "chunk-start") { assert.equal(first.chunkId, "c0"); assert.equal(first.text, "The great."); }
});

test("ties prefer chunk start over word start over pause midpoint, then the earlier target", () => {
  const targets = computeSnapTargets(words, chunks, 1500);
  // Exact hit on a sample shared by a chunk start and a word start, approached from either side.
  assert.equal(findSnapTarget(targets, 5000, 0)?.kind, "chunk-start");
  assert.equal(findSnapTarget(targets, 4990, 50)?.kind, "chunk-start");
  assert.equal(findSnapTarget(targets, 5010, 50)?.kind, "chunk-start");
  assert.equal(findSnapTarget(targets, 1000, 0)?.kind, "chunk-start");
  // 4500 is 500 from both the pause midpoint (4000) and the chunk start (5000): the chunk start wins although it is later.
  assert.equal(findSnapTarget(targets, 4500, 500)?.kind, "chunk-start");
  // 3050 is 950 from the word start at 2100 and from the pause midpoint at 4000: the word start wins although it is earlier anyway.
  assert.equal(findSnapTarget(targets, 3050, 950)?.kind, "word-start");
  // A word start with no chunk at its sample still beats a pause midpoint at equal distance, even when the midpoint is earlier.
  const later = computeSnapTargets([
    { id: "a", value: "a", startSample: 0, endSample: 100 },
    { id: "b", value: "b", startSample: 2100, endSample: 2200 },
  ], [], 1000);
  assert.deepEqual(later.map(t => [t.kind, t.sample]), [["word-start", 0], ["pause-midpoint", 1100], ["word-start", 2100]]);
  assert.equal(findSnapTarget(later, 1600, 500)?.kind, "word-start");
  // Nearer still beats rank: 5540 is 540 from the chunk start at 5000 and 510 from the word start at 6050.
  assert.equal(findSnapTarget(targets, 5540, 600)?.kind, "word-start");
});

test("speech onsets are their own target list, one per region start, and describe the region end", () => {
  const targets = computeSpeechOnsetTargets([{ startSample: 5000, endSample: 6000 }, { startSample: 1000, endSample: 2000 }]);
  assert.deepEqual(targets.map(t => [t.kind, t.sample]), [["speech-onset", 1000], ["speech-onset", 5000]]);
  assert.equal(findSnapTarget(targets, 1100, 200)?.sample, 1000);
  assert.equal(findSnapTarget(targets, 3000, 200), null);
});
