import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClipIdentity, ShotRecord } from "./api.js";
import { entryAt, mergeTimeline } from "./merge.js";

const clip: ClipIdentity = { bookId: "b", storyId: "s", audioSha256: "a".repeat(64), transcriptSha256: "b".repeat(64), sampleRateHz: 48000, sampleCount: 96000 };
const record = (id: string, startSample: number, createdAt: string): ShotRecord =>
  ({ schemaVersion: 1, kind: "visual-shot-generation", id, clip, startSample, mode: "graphic-illustration", createdAt, producer: { name: "t", version: "1" } });
const settings = { frameAspect: { width: 16, height: 9 } };

test("merge mirrors the server: overrides, newest-by-default, explicit selection, hidden skipped, opening gap", () => {
  const records = [record("aaa", 10000, "2026-01-01T00:00:00Z"), record("bbb", 48000, "2026-01-02T00:00:00Z"), record("ccc", 48000, "2026-01-03T00:00:00Z")];
  const plain = mergeTimeline(records, { settings, shots: {} }, clip.sampleCount, new Map());
  assert.deepEqual(plain.stitched.map(e => [e.kind, e.startSample, e.endSample]), [["gap", 0, 10000], ["shot", 10000, 48000], ["shot", 48000, 96000]]);
  assert.equal(plain.candidates[1]?.selectedId, "ccc");
  assert.equal(plain.candidates[1]?.selectionSource, "default");
  const decided = mergeTimeline(records, { settings, shots: { bbb: { selected: true }, aaa: { startSample: 0, mode: "poetic-abstraction" } } }, clip.sampleCount, new Map());
  assert.equal(decided.stitched[0]?.kind, "shot");
  assert.equal(decided.stitched[0]?.kind === "shot" ? decided.stitched[0].mode : null, "poetic-abstraction");
  assert.equal(decided.candidates[1]?.selectedId, "bbb");
  const hidden = mergeTimeline(records, { settings, shots: { bbb: { hidden: true }, ccc: { hidden: true } } }, clip.sampleCount, new Map());
  assert.equal(hidden.candidates[1]?.selectedId, null);
  assert.deepEqual(hidden.stitched.map(e => e.startSample), [0, 10000]);
  assert.equal(hidden.stitched[1]?.endSample, 96000);
});

test("entryAt uses the tolerance so a seek that lands just early still reads as the next shot", () => {
  const records = [record("aaa", 0, "2026-01-01T00:00:00Z"), record("bbb", 48000, "2026-01-02T00:00:00Z")];
  const { stitched } = mergeTimeline(records, { settings, shots: {} }, clip.sampleCount, new Map());
  assert.equal(entryAt(stitched, 47990, 48)?.startSample, 48000);
  assert.equal(entryAt(stitched, 47900, 48)?.startSample, 0);
  assert.equal(entryAt(stitched, 95999, 48)?.startSample, 48000);
  assert.equal(entryAt([], 5, 48), null);
});

test("an anchored shot starts at its word's effective start and reports the anchor; an unknown word falls back", () => {
  const records = [record("aaa", 0, "2026-01-01T00:00:00Z"), record("bbb", 48000, "2026-01-02T00:00:00Z")];
  const starts = new Map([["w7", 30000]]);
  const anchored = mergeTimeline(records, { settings, shots: { bbb: { anchorWordId: "w7", startSample: 40000 } } }, clip.sampleCount, starts);
  assert.deepEqual(anchored.stitched.map(e => e.startSample), [0, 30000], "the anchor wins over a stale startSample override");
  assert.equal(anchored.candidates[1]?.shots[0]?.anchorWordId, "w7");
  const missing = mergeTimeline(records, { settings, shots: { bbb: { anchorWordId: "gone", startSample: 40000 } } }, clip.sampleCount, starts);
  assert.deepEqual(missing.stitched.map(e => e.startSample), [0, 40000]);
  assert.equal(missing.candidates[1]?.shots[0]?.anchorWordId, undefined);
});
