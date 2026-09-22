import assert from "node:assert/strict";
import test from "node:test";
import type { StitchedEntry, StoryMapResponse, Word } from "./api.js";
import type { MapState } from "./state.js";
import { clock, currentChain, imageTakesAt, resolveMapView, sceneToShow } from "./story-map-view.js";

const words = ["w0", "w1", "w2", "w3", "w4", "w5"].map((id, i) => ({ id, value: `v${i}`, startSample: i * 10, endSample: i * 10 + 8 })) as unknown as ReadonlyArray<Word>;
const section = (id: string, kind: "act" | "beat", a: number, b: number) => ({ id, kind, title: id, startWordId: `w${a}`, endWordId: `w${b}` });
const map = {
  subjects: [],
  sections: [section("act-1", "act", 0, 5), section("beat-1", "beat", 0, 2), section("beat-2", "beat", 3, 5)],
} as unknown as StoryMapResponse;
const loaded: MapState = { status: "loaded", map };

test("the map view passes through a map that is not loaded, waits for words, and names a map that does not fit them", () => {
  assert.deepEqual(resolveMapView({ status: "loading" }, words), { status: "loading" });
  assert.deepEqual(resolveMapView({ status: "absent" }, words), { status: "absent" });
  assert.deepEqual(resolveMapView({ status: "error", message: "boom" }, words), { status: "error", message: "boom" });
  assert.deepEqual(resolveMapView(loaded, []), { status: "waiting" });
  const off = resolveMapView(loaded, words.slice(0, 2));
  assert.equal(off.status, "unresolvable");
  if (off.status === "unresolvable") assert.match(off.message, /not a run of transcript words/);
  const view = resolveMapView(loaded, words);
  assert.equal(view.status, "loaded");
  if (view.status === "loaded") assert.deepEqual(view.resolved.sections.map(s => s.id), ["act-1", "beat-1", "beat-2"]);
});

test("the scene shown is the selected one while the map holds it, else the innermost section under the playhead, else nothing", () => {
  const view = resolveMapView(loaded, words);
  assert.equal(view.status, "loaded");
  if (view.status !== "loaded") return;
  const { sections } = view.resolved;
  const chainAt = (sample: number) => currentChain(view, sample);
  assert.deepEqual(chainAt(35).map(s => s.id), ["act-1", "beat-2"]);
  assert.equal(sceneToShow(sections, null, chainAt(35))?.id, "beat-2");
  assert.equal(sceneToShow(sections, "beat-1", chainAt(35))?.id, "beat-1");
  assert.equal(sceneToShow(sections, "act-1", chainAt(35))?.id, "act-1");
  // A selection the map no longer names falls back to the playhead; with no chain either, there is no scene.
  assert.equal(sceneToShow(sections, "gone", chainAt(35))?.id, "beat-2");
  assert.equal(sceneToShow(sections, "gone", []), null);
  assert.deepEqual(currentChain({ status: "absent" }, 35), []);
});

test("the clock shows minutes and tenths of a second on the clip clock", () => {
  assert.equal(clock(0, 48000), "0:00.0");
  assert.equal(clock(48000 * 61.25, 48000), "1:01.3");
  assert.equal(clock(48000, 0), "800:00.0");
});

test("the image takes at a sample are one per track in track order: the shot held there by the preview's rule, only when it has an image", () => {
  const shot = (trackId: string, id: string, startSample: number, endSample: number, imageUrl?: string) =>
    ({ kind: "shot", trackId, id, startSample, endSample, mode: "graphic-illustration", createdAt: "2026-01-01T00:00:00.000Z", producer: { name: "t", version: "1" }, hidden: false, selected: true, ...(imageUrl === undefined ? {} : { imageUrl }) }) as unknown as StitchedEntry;
  const gap = (trackId: string, startSample: number, endSample: number) => ({ kind: "gap", trackId, startSample, endSample }) as StitchedEntry;
  const stitched = [
    gap("main", 0, 10), shot("main", "M1", 10, 40, "/m1"), shot("main", "M2", 40, 100),
    shot("qwen", "Q1", 0, 30, "/q1"), shot("qwen", "Q2", 30, 100, "/q2"),
    gap("gpt", 0, 30), shot("gpt", "G1", 30, 100, "/g1"),
  ];
  assert.deepEqual(imageTakesAt(stitched, 5, 0).map(t => [t.trackId, t.shot.id]), [["qwen", "Q1"]]);
  assert.deepEqual(imageTakesAt(stitched, 30, 0).map(t => [t.trackId, t.shot.id, t.shot.imageUrl]), [["main", "M1", "/m1"], ["qwen", "Q2", "/q2"], ["gpt", "G1", "/g1"]]);
  // A seek a hair before a start lands on the shot that starts there, as the preview does.
  assert.deepEqual(imageTakesAt(stitched, 29, 1).map(t => t.shot.id), ["M1", "Q2", "G1"]);
  // The main track's shot at 50 has no image, so it is not a take.
  assert.deepEqual(imageTakesAt(stitched, 50, 0).map(t => t.shot.id), ["Q2", "G1"]);
  assert.deepEqual(imageTakesAt([], 0, 0), []);
});
