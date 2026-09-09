import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSnapTargets, findSnapTarget, type SnapWord } from "./snap.js";

const words: SnapWord[] = [
  { id: "w1", value: "The", startSample: 1000, endSample: 2000 },
  { id: "w2", value: "great", startSample: 2100, endSample: 3000 },
  { id: "w3", value: "silence", startSample: 5000, endSample: 6000 },
  { id: "w4", value: "falls", startSample: 6050, endSample: 7000 },
];

test("targets include every word start and only pauses at least the minimum length", () => {
  const targets = computeSnapTargets(words, 1500);
  assert.deepEqual(targets.map(t => [t.kind, t.sample]), [
    ["word-start", 1000], ["word-start", 2100], ["pause-midpoint", 4000], ["word-start", 5000], ["word-start", 6050],
  ]);
  const pause = targets[2];
  assert.equal(pause?.kind, "pause-midpoint");
  if (pause?.kind === "pause-midpoint") { assert.equal(pause.pauseStart, 3000); assert.equal(pause.pauseEnd, 5000); }
});

test("targets are sorted even when words arrive out of order", () => {
  const shuffled = [words[2]!, words[0]!, words[3]!, words[1]!];
  const targets = computeSnapTargets(shuffled, 1500);
  assert.deepEqual(targets.map(t => t.sample), [1000, 2100, 4000, 5000, 6050]);
});

test("a pause exactly at the threshold counts and an odd pause midpoint floors", () => {
  const targets = computeSnapTargets([
    { id: "a", value: "a", startSample: 0, endSample: 100 },
    { id: "b", value: "b", startSample: 401, endSample: 500 },
  ], 301);
  assert.deepEqual(targets.map(t => [t.kind, t.sample]), [["word-start", 0], ["pause-midpoint", 250], ["word-start", 401]]);
});

test("findSnapTarget returns the nearest target inside the radius and null outside it", () => {
  const targets = computeSnapTargets(words, 1500);
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
  const targets = computeSnapTargets(words, 1500);
  assert.equal(findSnapTarget(targets, 1550, 600)?.sample, 1000);
  assert.equal(findSnapTarget(targets, 5000, 0)?.sample, 5000);
  assert.throws(() => findSnapTarget(targets, 1, -1), RangeError);
});
