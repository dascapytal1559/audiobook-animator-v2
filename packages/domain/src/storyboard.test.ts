import assert from "node:assert/strict";
import test from "node:test";
import type { ClipIdentity } from "./identity.js";
import type { SceneDescriptionTake } from "./scene-descriptions.js";
import { mergeTimeline, type ShotRecord } from "./shots.js";
import { cursorWord, frameAt, latestJobs, STORYBOARD_TRACK, storyboardFrames, type StoryboardJob } from "./storyboard.js";

const clip: ClipIdentity = { bookId: "b", storyId: "s", audioSha256: "a".repeat(64), transcriptSha256: "b".repeat(64), sampleRateHz: 48000, sampleCount: 96000 };
const record = (id: string, startSample: number, fields: Partial<ShotRecord> = {}): ShotRecord =>
  ({ schemaVersion: 1, kind: "visual-shot-generation", id, clip, startSample, mode: "graphic-illustration", createdAt: "2026-01-01T00:00:00Z", producer: { name: "t", version: "1" }, ...fields });
const take = (id: string, anchorWordId: string, model: string, createdAt: string): SceneDescriptionTake =>
  ({ id, anchorWordId, model, text: `${model} on ${anchorWordId}`, createdAt, producer: { name: "editor", version: "1" } });
const settings = { frameAspect: { width: 16, height: 9 } };
const starts = new Map([["w1", 1000], ["w5", 30000], ["w8", 50000]]);

test("the storyboard's frames are its track's anchored shots in order, each holding until the track's next shot, with the newest description of its word; other tracks and unanchored shots are no frames", () => {
  const records = [
    record("aaa", 0, { trackId: STORYBOARD_TRACK, anchorWordId: "w1" }),
    record("bbb", 0, { trackId: STORYBOARD_TRACK, anchorWordId: "w5", createdAt: "2026-01-01T00:00:00Z" }),
    record("ccc", 0, { trackId: STORYBOARD_TRACK, anchorWordId: "w5", createdAt: "2026-01-02T00:00:00Z", imagePath: "image.png" }),
    record("ddd", 40000, { trackId: STORYBOARD_TRACK }),
    record("eee", 0, { trackId: "main", anchorWordId: "w8" }),
  ];
  const { stitched } = mergeTimeline(records, { settings, shots: {} }, clip.sampleCount, starts);
  const takes = [take("t1", "w5", "openai/gpt-6-astra", "2026-01-01T00:00:00Z"), take("t2", "w5", "user", "2026-01-03T00:00:00Z"), take("t3", "w8", "user", "2026-01-03T00:00:00Z")];
  const frames = storyboardFrames(stitched, takes);
  assert.deepEqual(frames.map(f => [f.anchorWordId, f.startSample, f.endSample, f.shot.id, f.description?.id ?? null]), [["w1", 1000, 30000, "aaa", null], ["w5", 30000, 40000, "ccc", "t2"]]);
  assert.equal(frameAt(frames, 999, 0), null);
  assert.equal(frameAt(frames, 999, 1)?.anchorWordId, "w1");
  assert.equal(frameAt(frames, 29999, 0)?.anchorWordId, "w1");
  assert.equal(frameAt(frames, 95000, 0)?.anchorWordId, "w5", "the last frame stays the cursor's frame past an unanchored shot");
  assert.deepEqual(storyboardFrames([], takes), []);
});

test("the cursor's word is the word being spoken, else the next to start, else the last", () => {
  const words = [{ id: "a", startSample: 10, endSample: 20 }, { id: "b", startSample: 30, endSample: 40 }];
  assert.deepEqual([0, 10, 19, 20, 35, 40, 99].map(sample => cursorWord(words, sample)?.id), ["a", "a", "a", "b", "b", "b", "b"]);
  assert.equal(cursorWord([], 5), null);
});

test("latestJobs keeps the newest job for each frame", () => {
  const job = (id: string, anchorWordId: string, startedAt: string): StoryboardJob => ({ id, anchorWordId, status: "done", startedAt, attempts: [] });
  const latest = latestJobs([job("01ARZ3NDEKTSV4RRFFQ69G5FA2", "w1", "2026-01-02T00:00:00Z"), job("01ARZ3NDEKTSV4RRFFQ69G5FA1", "w1", "2026-01-01T00:00:00Z"), job("01ARZ3NDEKTSV4RRFFQ69G5FA3", "w5", "2026-01-01T00:00:00Z")]);
  assert.deepEqual([...latest].map(([word, j]) => [word, j.id]), [["w1", "01ARZ3NDEKTSV4RRFFQ69G5FA2"], ["w5", "01ARZ3NDEKTSV4RRFFQ69G5FA3"]]);
});
