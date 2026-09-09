import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClipIdentity, ShotRecord } from "./api.js";
import { mergeTimeline } from "./merge.js";
import { planTick } from "./playback.js";

const clip: ClipIdentity = { bookId: "b", storyId: "s", audioSha256: "a".repeat(64), transcriptSha256: "b".repeat(64), sampleRateHz: 48000, sampleCount: 96000 };
const record = (id: string, startSample: number): ShotRecord =>
  ({ schemaVersion: 1, kind: "visual-shot-generation", id, clip, startSample, mode: "graphic-illustration", createdAt: "2026-01-01T00:00:00Z", producer: { name: "t", version: "1" } });
const { stitched } = mergeTimeline([record("aaa", 0), record("bbb", 33600), record("ccc", 50400)], { settings: { frameAspect: { width: 16, height: 9 } }, shots: {} }, clip.sampleCount, new Map());
const base = { sampleCount: clip.sampleCount, toleranceSamples: 48, stitched, region: null };

test("without loop or region playback advances until the clip end, then stops there", () => {
  assert.deepEqual(planTick({ ...base, sample: 40000, loop: false, loopAnchorStart: null }), { kind: "advance", loopAnchorStart: null });
  assert.deepEqual(planTick({ ...base, sample: 96000, loop: false, loopAnchorStart: null }), { kind: "stop", target: 96000 });
});

test("loop anchors to the shot under the playhead and wraps at that shot's end even after crossing into the next one", () => {
  const first = planTick({ ...base, sample: 1000, loop: true, loopAnchorStart: null });
  assert.deepEqual(first, { kind: "advance", loopAnchorStart: 0 });
  const crossed = planTick({ ...base, sample: 33700, loop: true, loopAnchorStart: 0 });
  assert.deepEqual(crossed, { kind: "wrap", target: 0, loopAnchorStart: 0 });
  const unanchored = planTick({ ...base, sample: 33700, loop: true, loopAnchorStart: null });
  assert.deepEqual(unanchored, { kind: "advance", loopAnchorStart: 33600 }, "with no anchor the loop adopts the shot now under the playhead");
});

test("a stale anchor whose shot vanished re-anchors at the playhead", () => {
  assert.deepEqual(planTick({ ...base, sample: 51000, loop: true, loopAnchorStart: 12345 }), { kind: "advance", loopAnchorStart: 50400 });
});

test("the working region caps the stop point and the loop start, and is the stop when loop is off", () => {
  const region = { start: 14400, end: 43200 };
  assert.deepEqual(planTick({ ...base, region, sample: 43200, loop: false, loopAnchorStart: null }), { kind: "stop", target: 43200 });
  assert.deepEqual(planTick({ ...base, region, sample: 43200, loop: true, loopAnchorStart: 33600 }), { kind: "wrap", target: 33600, loopAnchorStart: 33600 });
  assert.deepEqual(planTick({ ...base, region, sample: 43200, loop: true, loopAnchorStart: 0 }), { kind: "wrap", target: 14400, loopAnchorStart: 0 }, "loop start never precedes the region in-point");
});

test("a looped shot entirely past the region out-point falls back to the region start", () => {
  const region = { start: 0, end: 20000 };
  assert.deepEqual(planTick({ ...base, region, sample: 20000, loop: true, loopAnchorStart: 50400 }), { kind: "wrap", target: 0, loopAnchorStart: null });
});
