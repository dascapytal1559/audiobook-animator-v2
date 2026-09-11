import { test } from "node:test";
import assert from "node:assert/strict";
import type { Word } from "./api.js";
import { clampDelta, deltaBounds, effectiveWords, manualMapOf, moveWords, shiftedWords, wordStartMap } from "./timing.js";

const word = (id: string, start: number, end: number, extra: Partial<Word> = {}): Word =>
  ({ id, value: id, startSample: start, endSample: end, original: { startSample: start, endSample: end }, ...extra });
const words: Word[] = [
  word("w1", 1000, 2000),
  word("w2", 2100, 3000, { auto: { startSample: 2250, endSample: 3150 } }),
  word("w3", 3100, 4000, { auto: { startSample: 3250, endSample: 4150 }, manual: { startSample: 3300, endSample: 4200 } }),
  word("w4", 5000, 6000),
];

test("effective times are manual, else auto, else original; the local map wins over the story's manual layer", () => {
  const plain = effectiveWords(words, {});
  assert.deepEqual(plain.map(w => [w.startSample, w.endSample]), [[1000, 2000], [2250, 3150], [3250, 4150], [5000, 6000]]);
  assert.equal(plain[2]!.manual, undefined, "an empty local map means no manual layer, whatever the story said");
  const local = effectiveWords(words, { w1: { startSample: 1200, endSample: 2200 } });
  assert.deepEqual(local[0], { ...word("w1", 1000, 2000), startSample: 1200, endSample: 2200, manual: { startSample: 1200, endSample: 2200 } });
  assert.deepEqual(manualMapOf(words), { w3: { startSample: 3300, endSample: 4200 } });
});

test("the delta clamps against unselected neighbours and the clip bounds", () => {
  const base = effectiveWords(words, {});
  // Selecting w2–w3: previous end 2000, first start 2250 → min -250; next start 5000, last end 4150 → max +850.
  assert.deepEqual(deltaBounds(base, { first: 1, last: 2 }, 96000), { min: -250, max: 850 });
  assert.equal(clampDelta(base, { first: 1, last: 2 }, -5000, 96000), -250);
  assert.equal(clampDelta(base, { first: 1, last: 2 }, 5000, 96000), 850);
  assert.equal(clampDelta(base, { first: 1, last: 2 }, 300, 96000), 300);
  // First word: cannot go before the clip start. Last word: cannot pass the clip end.
  assert.deepEqual(deltaBounds(base, { first: 0, last: 0 }, 96000), { min: -1000, max: 250 });
  assert.deepEqual(deltaBounds(base, { first: 3, last: 3 }, 6500), { min: -850, max: 500 });
  assert.throws(() => deltaBounds(base, { first: 3, last: 4 }, 96000), RangeError);
});

test("a move shifts every selected word by the same delta, preserves durations, and leaves the rest of the map alone", () => {
  const base = effectiveWords(words, { w4: { startSample: 5100, endSample: 6100 } });
  const moved = moveWords(manualMapOf(base), base, { first: 1, last: 2 }, 100);
  assert.deepEqual(moved, { w2: { startSample: 2350, endSample: 3250 }, w3: { startSample: 3350, endSample: 4250 }, w4: { startSample: 5100, endSample: 6100 } });
  const view = shiftedWords(base, { first: 1, last: 2 }, 100);
  assert.deepEqual(view.map(w => w.startSample), [1000, 2350, 3350, 5100]);
  assert.equal(shiftedWords(base, { first: 1, last: 2 }, 0), base, "a zero delta returns the same array");
  assert.deepEqual([...wordStartMap(view)], [["w1", 1000], ["w2", 2350], ["w3", 3350], ["w4", 5100]]);
});
