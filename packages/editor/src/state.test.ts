import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClipIdentity, Decisions, ShotRecord, StoryResponse, TimelineResponse, Word } from "./api.js";
import { applyPatch, decisionsForView, initialState, isDirty, isTimingDirty, reduce, wordsForView, workingBounds, type EditorState } from "./state.js";
import { mergeTimeline } from "./merge.js";

const clip: ClipIdentity = { bookId: "b", storyId: "s", audioSha256: "a".repeat(64), transcriptSha256: "b".repeat(64), sampleRateHz: 48000, sampleCount: 96000 };
const record = (id: string, startSample: number, createdAt: string, extra: Partial<ShotRecord> = {}): ShotRecord =>
  ({ schemaVersion: 1, kind: "visual-shot-generation", id, clip, startSample, mode: "graphic-illustration", createdAt, producer: { name: "test", version: "1" }, ...extra });
const decisions = (shots: Decisions["shots"] = {}): Decisions =>
  ({ schemaVersion: 1, kind: "visual-timeline-decisions", clip, updatedAt: "2026-09-08T00:00:00Z", settings: { frameAspect: { width: 16, height: 9 } }, shots });
const timeline = (records: ShotRecord[], d: Decisions = decisions()): TimelineResponse => {
  const merged = mergeTimeline(records, d, clip.sampleCount, new Map());
  return { clip, storyDirectory: "/stories/pilot", records, decisions: d, candidates: [...merged.candidates], stitched: [...merged.stitched] };
};
const records = [record("aaa", 0, "2026-01-01T00:00:00Z"), record("bbb", 48000, "2026-01-02T00:00:00Z"), record("ccc", 48000, "2026-01-03T00:00:00Z")];
const loaded = (): EditorState => reduce(initialState, { type: "timeline-loaded", timeline: timeline(records) });

test("loading adopts server decisions when clean and keeps local edits when dirty", () => {
  let state = loaded();
  assert.equal(isDirty(state), false);
  state = reduce(state, { type: "shot-edited", id: "aaa", patch: { mode: "poetic-abstraction" } });
  assert.equal(isDirty(state), true);
  state = reduce(state, { type: "timeline-loaded", timeline: timeline(records, decisions({ bbb: { notes: "from disk" } })) });
  assert.deepEqual(state.decisions.shots, { aaa: { mode: "poetic-abstraction" } }, "local overlay survives a refetch while unsaved");
  assert.deepEqual(state.serverDecisions?.shots, { bbb: { notes: "from disk" } });
  const clean = reduce(loaded(), { type: "timeline-loaded", timeline: timeline(records, decisions({ bbb: { notes: "from disk" } })) });
  assert.deepEqual(clean.decisions.shots, { bbb: { notes: "from disk" } });
});

test("a refetch prunes local decisions for records that no longer exist", () => {
  let state = reduce(loaded(), { type: "shot-edited", id: "ccc", patch: { hidden: true } });
  state = reduce(state, { type: "timeline-loaded", timeline: timeline(records.slice(0, 2)) });
  assert.deepEqual(state.decisions.shots, {});
});

test("save lifecycle tracks versions and edits made during a save keep it dirty", () => {
  let state = reduce(loaded(), { type: "shot-edited", id: "aaa", patch: { notes: "one" } });
  const version = state.editVersion;
  state = reduce(state, { type: "save-started", version });
  assert.equal(state.save.status, "saving");
  state = reduce(state, { type: "shot-edited", id: "aaa", patch: { notes: "two" } });
  state = reduce(state, { type: "save-succeeded", version, timeline: timeline(records, decisions({ aaa: { notes: "one" } })) });
  assert.equal(state.save.status, "saved", "status returns to saved; dirtiness is tracked by the versions");
  assert.equal(isDirty(state), true);
  assert.deepEqual(state.decisions.shots, { aaa: { notes: "two" } });
  const v2 = state.editVersion;
  state = reduce(state, { type: "save-succeeded", version: v2, timeline: timeline(records, decisions({ aaa: { notes: "two" } })) });
  assert.equal(state.save.status, "saved");
  assert.equal(isDirty(state), false);
  state = reduce(state, { type: "save-failed", message: "disk full" });
  assert.deepEqual(state.save, { status: "error", message: "disk full" });
  state = reduce(state, { type: "shot-edited", id: "aaa", patch: { notes: "three" } });
  assert.deepEqual(state.save, { status: "saved" }, "a new edit clears the error so the debounce retries");
});

test("selecting a candidate writes selected on it and clears the rest of its group, unhiding it", () => {
  let state = reduce(loaded(), { type: "shots-hidden", ids: ["bbb"] });
  state = reduce(state, { type: "shot-selected", id: "ccc", groupIds: ["bbb", "ccc"] });
  state = reduce(state, { type: "shot-selected", id: "bbb", groupIds: ["bbb", "ccc"] });
  assert.deepEqual(state.decisions.shots, { bbb: { selected: true } });
  const merged = mergeTimeline(state.records, state.decisions, clip.sampleCount, new Map());
  assert.equal(merged.candidates[1]?.selectedId, "bbb");
  assert.equal(merged.candidates[1]?.selectionSource, "decision");
});

test("hiding clears selected so the server never sees both flags", () => {
  let state = reduce(loaded(), { type: "shot-selected", id: "bbb", groupIds: ["bbb", "ccc"] });
  state = reduce(state, { type: "shots-hidden", ids: ["bbb"] });
  assert.deepEqual(state.decisions.shots["bbb"], { hidden: true });
});

test("empty notes and moving back to the record start drop their overrides", () => {
  let state = reduce(loaded(), { type: "shot-edited", id: "aaa", patch: { notes: "keep" } });
  state = reduce(state, { type: "shot-edited", id: "aaa", patch: { notes: "  " } });
  assert.equal(state.decisions.shots["aaa"], undefined);
  state = reduce(state, { type: "shot-moved", id: "bbb", startSample: 60000 });
  assert.deepEqual(state.decisions.shots["bbb"], { startSample: 60000 });
  state = reduce(state, { type: "shot-moved", id: "bbb", startSample: 48000 });
  assert.equal(state.decisions.shots["bbb"], undefined);
  assert.deepEqual(applyPatch({ selected: true, notes: "n" }, { selected: undefined }), { notes: "n" });
});

test("a drag previews without editing and commits on release only if the start changed", () => {
  let state = reduce(loaded(), { type: "drag-start", id: "bbb", startSample: 48000 });
  state = reduce(state, { type: "drag-move", startSample: 50000, snap: null });
  assert.equal(state.editVersion, 0);
  assert.equal(decisionsForView(state).shots["bbb"]?.startSample, 50000);
  assert.equal(mergeTimeline(state.records, decisionsForView(state), clip.sampleCount, new Map()).stitched.length, 3);
  const unchanged = reduce(reduce(state, { type: "drag-move", startSample: 48000, snap: null }), { type: "drag-end" });
  assert.equal(unchanged.editVersion, 0);
  assert.equal(unchanged.drag, null);
  const moved = reduce(state, { type: "drag-end" });
  assert.equal(moved.editVersion, 1);
  assert.deepEqual(moved.decisions.shots["bbb"], { startSample: 50000 });
  assert.equal(reduce(state, { type: "drag-cancel" }).drag, null);
});

test("aspect changes are validated and bump the edit version", () => {
  const state = reduce(loaded(), { type: "aspect-set", width: 4, height: 3 });
  assert.deepEqual(state.decisions.settings.frameAspect, { width: 4, height: 3 });
  assert.equal(state.editVersion, 1);
  assert.equal(reduce(state, { type: "aspect-set", width: 0, height: 3 }), state);
});

test("working region is client-only and its bounds default to the clip edges", () => {
  let state = reduce(loaded(), { type: "playhead-set", sample: 30000 });
  state = reduce(state, { type: "working-set-in" });
  assert.equal(workingBounds(state, clip.sampleCount), null);
  state = reduce(state, { type: "working-toggle" });
  assert.deepEqual(workingBounds(state, clip.sampleCount), { start: 30000, end: 96000 });
  state = reduce(reduce(state, { type: "playhead-set", sample: 70000 }), { type: "working-set-out" });
  assert.deepEqual(workingBounds(state, clip.sampleCount), { start: 30000, end: 70000 });
  state = reduce(reduce(state, { type: "playhead-set", sample: 80000 }), { type: "working-set-in" });
  assert.deepEqual(state.working, { enabled: true, inSample: 80000, outSample: null });
  assert.equal(state.editVersion, 0, "working region never touches decisions");
  assert.deepEqual(reduce(state, { type: "working-clear" }).working, { enabled: false, inSample: null, outSample: null });
});

// Word timing (A38–A41, A51, A53).
const word = (id: string, start: number, end: number, extra: Partial<Word> = {}): Word =>
  ({ id, value: id, startSample: start, endSample: end, original: { startSample: start, endSample: end }, ...extra });
const storyWords = [word("w1", 1000, 2000), word("w2", 2100, 3000), word("w3", 3100, 4000), word("w4", 5000, 6000, { manual: { startSample: 5000, endSample: 6000 } })];
const story = (words: Word[] = storyWords): StoryResponse => ({
  clip, story: { title: "t", bookTitle: "b" }, sourceStartSample: 0, words,
  chunks: [{ id: "c0", startSample: 1000, endSample: 6000, text: "w1 w2 w3 w4", wordIds: ["w1", "w2", "w3", "w4"], breakReason: "end" }],
  chunking: { pauseBreakMs: 600, minSentenceBreakMs: 150, mergedSentenceBreaks: [] },
});
const withStory = (): EditorState => reduce(loaded(), { type: "story-loaded", story: story() });
const select = (state: EditorState, first: string, last: string, extend = false): EditorState =>
  reduce(state, { type: "selection-set", selection: extend && state.selection ? { anchor: state.selection.anchor, focus: { first, last } } : { anchor: { first, last }, focus: { first, last } } });

test("loading a story adopts its manual layer; a drag commits a clamped group move as one manual map and one undo step", () => {
  let state = withStory();
  assert.deepEqual(state.manual, { w4: { startSample: 5000, endSample: 6000 } });
  state = select(state, "w2", "w2");
  state = select(state, "w3", "w3", true);
  state = reduce(state, { type: "word-drag-start" });
  state = reduce(state, { type: "word-drag-move", delta: 5000, snap: null });
  assert.equal(state.wordDrag?.delta, 1000, "clamped to the gap before w4");
  assert.deepEqual(wordsForView(state).map(w => w.startSample), [1000, 3100, 4100, 5000], "the view shows the move before it is committed");
  assert.equal(isTimingDirty(state), false);
  state = reduce(state, { type: "word-drag-end" });
  assert.equal(state.wordDrag, null);
  assert.deepEqual(state.manual, { w2: { startSample: 3100, endSample: 4000 }, w3: { startSample: 4100, endSample: 5000 }, w4: { startSample: 5000, endSample: 6000 } });
  assert.equal(isTimingDirty(state), true);
  assert.equal(isDirty(state), true);
  assert.equal(state.timingPast.length, 1);
});

test("nudges clamp too, undo and redo walk the manual-map stack, and a new edit drops the redo branch", () => {
  let state = select(withStory(), "w1", "w1");
  state = reduce(state, { type: "timing-nudge", deltaSamples: -480 });
  assert.deepEqual(state.manual["w1"], { startSample: 520, endSample: 1520 });
  state = reduce(state, { type: "timing-nudge", deltaSamples: -5000 });
  assert.deepEqual(state.manual["w1"], { startSample: 0, endSample: 1000 }, "clamped at the clip start");
  const v = state.timingEditVersion;
  state = reduce(state, { type: "timing-undo" });
  assert.deepEqual(state.manual["w1"], { startSample: 520, endSample: 1520 });
  assert.ok(state.timingEditVersion > v, "undo is an edit for autosave purposes");
  state = reduce(state, { type: "timing-undo" });
  assert.equal(state.manual["w1"], undefined);
  assert.equal(reduce(state, { type: "timing-undo" }), state, "nothing left to undo");
  state = reduce(state, { type: "timing-redo" });
  assert.deepEqual(state.manual["w1"], { startSample: 520, endSample: 1520 });
  state = reduce(state, { type: "timing-nudge", deltaSamples: 480 });
  assert.equal(state.timingFuture.length, 0);
  assert.equal(reduce(state, { type: "timing-redo" }), state);
});

test("a timing save adopts the server story only when nothing newer is pending; a refetch while dirty keeps the local map", () => {
  let state = select(withStory(), "w1", "w1");
  state = reduce(state, { type: "timing-nudge", deltaSamples: -100 });
  const version = state.timingEditVersion;
  state = reduce(state, { type: "timing-nudge", deltaSamples: -100 });
  state = reduce(state, { type: "story-loaded", story: story([word("w1", 1000, 2000)]) });
  assert.deepEqual(state.manual["w1"], { startSample: 800, endSample: 1800 }, "local map survives a refetch while unsaved");
  state = reduce(state, { type: "timing-save-succeeded", version, story: story([word("w1", 900, 1900, { manual: { startSample: 900, endSample: 1900 } })]) });
  assert.equal(isTimingDirty(state), true);
  assert.deepEqual(state.manual["w1"], { startSample: 800, endSample: 1800 });
  state = reduce(state, { type: "timing-save-succeeded", version: state.timingEditVersion, story: story([word("w1", 800, 1800, { manual: { startSample: 800, endSample: 1800 } })]) });
  assert.equal(isTimingDirty(state), false);
  assert.equal(state.selection?.focus.first, "w1", "the selection survives when its words still exist");
  state = reduce(state, { type: "story-loaded", story: story([word("w9", 0, 10)]) });
  assert.equal(state.selection, null);
});

test("a shot drag that ends on a word or sentence start anchors the shot; ending elsewhere or detaching writes a sample position", () => {
  let state = withStory();
  state = reduce(state, { type: "drag-start", id: "bbb", startSample: 48000 });
  state = reduce(state, { type: "drag-move", startSample: 2100, snap: { kind: "word-start", sample: 2100, wordId: "w2", value: "w2" } });
  assert.equal(decisionsForView(state).shots["bbb"]?.anchorWordId, undefined);
  state = reduce(state, { type: "drag-end" });
  assert.deepEqual(state.decisions.shots["bbb"], { anchorWordId: "w2" });
  const starts = new Map([["w2", 2600]]);
  assert.equal(mergeTimeline(state.records, state.decisions, clip.sampleCount, starts).candidates.find(g => g.shots.some(s => s.id === "bbb"))?.startSample, 2600, "the shot follows the word");
  state = reduce(state, { type: "drag-start", id: "bbb", startSample: 2600 });
  state = reduce(state, { type: "drag-move", startSample: 1000, snap: { kind: "chunk-start", sample: 1000, chunkId: "c0", text: "w1", firstWordId: "w1" } });
  state = reduce(state, { type: "drag-end" });
  assert.deepEqual(state.decisions.shots["bbb"], { anchorWordId: "w1" });
  state = reduce(state, { type: "drag-start", id: "bbb", startSample: 1000 });
  state = reduce(state, { type: "drag-move", startSample: 7000, snap: null });
  state = reduce(state, { type: "drag-end" });
  assert.deepEqual(state.decisions.shots["bbb"], { startSample: 7000 });
  state = reduce(state, { type: "shot-moved", id: "bbb", startSample: 48000 });
  assert.equal(state.decisions.shots["bbb"], undefined, "back on the record start: no override at all");
});
