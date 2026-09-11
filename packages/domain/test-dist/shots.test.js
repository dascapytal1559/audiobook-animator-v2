import assert from "node:assert/strict";
import test from "node:test";
import { entryAt, mergeTimeline } from "./shots.js";
const clip = { bookId: "b", storyId: "s", audioSha256: "a".repeat(64), transcriptSha256: "b".repeat(64), sampleRateHz: 48000, sampleCount: 96000 };
const record = (id, startSample, createdAt) => ({ schemaVersion: 1, kind: "visual-shot-generation", id, clip, startSample, mode: "graphic-illustration", createdAt, producer: { name: "t", version: "1" } });
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
            zzz: { selected: true }, aaa: { startSample: 96000, selected: true, hidden: true, anchorWordId: "gone" }, bbb: { selected: true }, ccc: { selected: true }
        } }, clip.sampleCount, words);
    assert.deepEqual(problems, [
        "Decision references a shot with no generation record: zzz",
        "Decision startSample 96000 is outside the clip's 96000 samples for shot aaa",
        "Shot aaa is both selected and hidden",
        "Shot aaa is anchored to a word that is not in the transcript: gone",
        "More than one shot selected at sample 0: ccc, bbb",
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
//# sourceMappingURL=shots.test.js.map