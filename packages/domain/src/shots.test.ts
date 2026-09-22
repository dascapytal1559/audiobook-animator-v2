import assert from "node:assert/strict";
import test from "node:test";
import type { ClipIdentity } from "./identity.js";
import { declaredShots, entryAt, mergeTimeline, timelineForTrack, type ShotRecord } from "./shots.js";

const clip: ClipIdentity = { bookId: "b", storyId: "s", audioSha256: "a".repeat(64), transcriptSha256: "b".repeat(64), sampleRateHz: 48000, sampleCount: 96000 };
const record = (id: string, startSample: number, createdAt: string): ShotRecord =>
  ({ schemaVersion: 1, kind: "visual-shot-generation", id, clip, startSample, mode: "graphic-illustration", createdAt, producer: { name: "t", version: "1" } });
const settings = { frameAspect: { width: 16, height: 9 } };

test("overrides apply, the newest candidate wins by default, an explicit selection wins, hidden shots are never selected, and coverage opens with a gap", () => {
  const records = [record("aaa", 10000, "2026-01-01T00:00:00Z"), record("bbb", 48000, "2026-01-02T00:00:00Z"), record("ccc", 48000, "2026-01-03T00:00:00Z")];
  const plain = mergeTimeline(records, { settings, shots: {} }, clip.sampleCount, new Map());
  assert.deepEqual(plain.stitched.map(e => [e.kind, e.startSample, e.endSample]), [["gap", 0, 10000], ["shot", 10000, 48000], ["shot", 48000, 96000]]);
  assert.equal(plain.candidates[1]?.selectedId, "ccc");
  assert.equal(plain.candidates[1]?.selectionSource, "default");
  assert.deepEqual(plain.problems, []);
  const decided = mergeTimeline(records, { settings, shots: { bbb: { selected: true }, aaa: { startSample: 0, mode: "poetic-abstraction" } } }, clip.sampleCount, new Map());
  assert.equal(decided.stitched[0]?.kind, "shot");
  assert.equal(decided.stitched[0]?.kind === "shot" ? decided.stitched[0].mode : null, "poetic-abstraction");
  assert.equal(decided.candidates[1]?.selectedId, "bbb");
  const hidden = mergeTimeline(records, { settings, shots: { bbb: { hidden: true }, ccc: { hidden: true } } }, clip.sampleCount, new Map());
  assert.equal(hidden.candidates[1]?.selectedId, null);
  assert.deepEqual(hidden.stitched.map(e => e.startSample), [0, 10000]);
  assert.equal(hidden.stitched[1]?.endSample, 96000);
});

test("every broken rule is reported as a problem, in order, without aborting the merge", () => {
  const records = [record("aaa", 0, "2026-01-01T00:00:00Z"), record("bbb", 0, "2026-01-02T00:00:00Z"), record("ccc", 0, "2026-01-03T00:00:00Z")];
  const words = new Map([["w1", 10]]);
  const { problems } = mergeTimeline(records, { settings, shots: {
    zzz: { selected: true }, aaa: { startSample: 96000, selected: true, hidden: true, anchorWordId: "gone" }, bbb: { selected: true }, ccc: { selected: true } } }, clip.sampleCount, words);
  assert.deepEqual(problems, [
    "Decision references a shot with no generation record: zzz",
    "Decision startSample 96000 is outside the clip's 96000 samples for shot aaa",
    "Shot aaa is both selected and hidden",
    "Shot aaa is anchored to a word that is not in the transcript: gone",
    "More than one shot selected at sample 0 in track main: ccc, bbb",
  ]);
});

test("entryAt uses the tolerance so a seek that lands just early still reads as the next shot", () => {
  const records = [record("aaa", 0, "2026-01-01T00:00:00Z"), record("bbb", 48000, "2026-01-02T00:00:00Z")];
  const { stitched } = mergeTimeline(records, { settings, shots: {} }, clip.sampleCount, new Map());
  assert.equal(entryAt(stitched, 47990, 48)?.startSample, 48000);
  assert.equal(entryAt(stitched, 47900, 48)?.startSample, 0);
  assert.equal(entryAt(stitched, 95999, 48)?.startSample, 48000);
  assert.equal(entryAt([], 5, 48), null);
});

test("an anchored shot starts at its word's effective start; with unknown words the anchor is unresolved and falls back, with known words a missing word is a problem", () => {
  const records = [record("aaa", 0, "2026-01-01T00:00:00Z"), record("bbb", 48000, "2026-01-02T00:00:00Z")];
  const starts = new Map([["w7", 30000]]);
  const anchored = mergeTimeline(records, { settings, shots: { bbb: { anchorWordId: "w7", startSample: 40000 } } }, clip.sampleCount, starts);
  assert.deepEqual(anchored.stitched.map(e => e.startSample), [0, 30000], "the anchor wins over a stale startSample override");
  assert.equal(anchored.candidates[1]?.shots[0]?.anchorWordId, "w7");
  assert.deepEqual([anchored.unresolvedAnchors, anchored.problems], [[], []]);
  const unknownWords = mergeTimeline(records, { settings, shots: { bbb: { anchorWordId: "w7", startSample: 40000 } } }, clip.sampleCount, new Map());
  assert.deepEqual(unknownWords.stitched.map(e => e.startSample), [0, 40000]);
  assert.deepEqual([unknownWords.unresolvedAnchors, unknownWords.problems], [["bbb"], []]);
  const missing = mergeTimeline(records, { settings, shots: { bbb: { anchorWordId: "gone", startSample: 40000 } } }, clip.sampleCount, starts);
  assert.deepEqual(missing.stitched.map(e => e.startSample), [0, 40000]);
  assert.deepEqual(missing.problems, ["Shot bbb is anchored to a word that is not in the transcript: gone"]);
});

test("a record served with imageUrl keeps it on its shot and stitched entry", () => {
  const records = [{ ...record("aaa", 0, "2026-01-01T00:00:00Z"), imagePath: "image.png", imageUrl: "/api/stories/s/shots/aaa/image" }];
  const { stitched } = mergeTimeline(records, { settings, shots: {} }, clip.sampleCount, new Map());
  assert.equal(stitched[0]?.kind === "shot" ? stitched[0].imageUrl : null, "/api/stories/s/shots/aaa/image");
});

test("tracks sharing starts and word anchors choose candidates and hold independently", () => {
  const at = "2026-01-01T00:00:00Z";
  const records = [record("main", 0, at),
    { ...record("c1", 10000, at), trackId: "claude" }, { ...record("c2", 60000, at), trackId: "claude" },
    { ...record("g1", 10000, at), trackId: "grok" }, { ...record("g2", 20000, at), trackId: "grok" }];
  const merged = mergeTimeline(records, { settings, shots: {
    c1: { selected: true, anchorWordId: "sentence" }, g1: { selected: true, anchorWordId: "sentence" }, g2: { hidden: true },
  } }, clip.sampleCount, new Map([["sentence", 30000]]));
  assert.deepEqual(merged.problems, []);
  assert.deepEqual(merged.candidates.map(g => [g.trackId, g.startSample, g.selectedId]), [
    ["main", 0, "main"], ["claude", 30000, "c1"], ["claude", 60000, "c2"], ["grok", 20000, null], ["grok", 30000, "g1"],
  ]);
  const spans = (track: string) => timelineForTrack(merged, track).stitched.map(e => [e.kind, e.startSample, e.endSample]);
  assert.deepEqual(spans("main"), [["shot", 0, 96000]]);
  assert.deepEqual(spans("claude"), [["gap", 0, 30000], ["shot", 30000, 60000], ["shot", 60000, 96000]]);
  assert.deepEqual(spans("grok"), [["gap", 0, 30000], ["shot", 30000, 96000]]);
  assert.deepEqual(timelineForTrack(merged, "missing"), { candidates: [], stitched: [] });
  assert.equal(entryAt(timelineForTrack(merged, "claude").stitched, 70000, 0)?.kind, "shot");
});

test("an empty or wholly hidden track keeps its own opening gap", () => {
  const empty = mergeTimeline([], { settings, shots: {} }, clip.sampleCount, new Map());
  assert.deepEqual(empty.stitched, [{ kind: "gap", trackId: "main", startSample: 0, endSample: 96000 }]);
  const hidden = mergeTimeline([{ ...record("a", 1, "2026-01-01T00:00:00Z"), trackId: "proof" }], { settings, shots: { a: { hidden: true } } }, clip.sampleCount, new Map());
  assert.deepEqual(hidden.stitched, [{ kind: "gap", trackId: "proof", startSample: 0, endSample: 96000 }]);
});

test("declared shots are the distinct anchor words of the shown shots across tracks, in timeline order; unanchored, hidden, and unselected shots declare nothing", () => {
  const onTrack = (id: string, startSample: number, trackId: string, createdAt = "2026-01-01T00:00:00Z"): ShotRecord => ({ ...record(id, startSample, createdAt), trackId });
  const records = [onTrack("aaa", 0, "one"), onTrack("bbb", 0, "two"), onTrack("ccc", 5000, "one"), onTrack("ddd", 9000, "two"), onTrack("eee", 20000, "one"), onTrack("fff", 40000, "one", "2026-01-02T00:00:00Z")];
  const starts = new Map([["w0", 100], ["w5", 30000], ["w9", 60000], ["w12", 70000]]);
  const shots = { aaa: { anchorWordId: "w0" }, bbb: { anchorWordId: "w0" }, ddd: { anchorWordId: "w5" }, eee: { anchorWordId: "w9", hidden: true }, fff: { anchorWordId: "w12" } };
  const { stitched } = mergeTimeline(records, { settings, shots }, clip.sampleCount, starts);
  assert.deepEqual(declaredShots(stitched), [{ anchorWordId: "w0", startSample: 100 }, { anchorWordId: "w5", startSample: 30000 }, { anchorWordId: "w12", startSample: 70000 }]);
  assert.deepEqual(declaredShots([]), []);
});
