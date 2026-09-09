import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClipIdentity, Decisions, ShotRecord, TimelineResponse } from "./api.js";
import { applyPatch, decisionsForView, initialState, isDirty, reduce, workingBounds, type EditorState } from "./state.js";
import { mergeTimeline } from "./merge.js";

const clip: ClipIdentity = { bookId: "b", storyId: "s", audioSha256: "a".repeat(64), transcriptSha256: "b".repeat(64), sampleRateHz: 48000, sampleCount: 96000 };
const record = (id: string, startSample: number, createdAt: string, extra: Partial<ShotRecord> = {}): ShotRecord =>
  ({ schemaVersion: 1, kind: "visual-shot-generation", id, clip, startSample, mode: "graphic-illustration", createdAt, producer: { name: "test", version: "1" }, ...extra });
const decisions = (shots: Decisions["shots"] = {}): Decisions =>
  ({ schemaVersion: 1, kind: "visual-timeline-decisions", clip, updatedAt: "2026-09-08T00:00:00Z", settings: { frameAspect: { width: 16, height: 9 } }, shots });
const timeline = (records: ShotRecord[], d: Decisions = decisions()): TimelineResponse => {
  const merged = mergeTimeline(records, d, clip.sampleCount);
  return { clip, planningDirectory: "/planning", records, decisions: d, candidates: [...merged.candidates], stitched: [...merged.stitched] };
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
  const merged = mergeTimeline(state.records, state.decisions, clip.sampleCount);
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
  assert.equal(mergeTimeline(state.records, decisionsForView(state), clip.sampleCount).stitched.length, 3);
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
