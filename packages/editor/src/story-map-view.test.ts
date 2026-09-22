import assert from "node:assert/strict";
import test from "node:test";
import type { SceneDescriptionTake, StitchedEntry, StoryMapResponse, Word } from "./api.js";
import type { MapState } from "./state.js";
import { clock, currentChain, imageTakesAt, resolveMapView, sceneShots, sceneToShow } from "./story-map-view.js";

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

test("a scene's shots are the declared shot holding at its start, then each declared shot inside it, each with its own takes; no map section is involved", () => {
  const shot = (trackId: string, id: string, startSample: number, endSample: number, anchorWordId?: string) =>
    ({ kind: "shot", trackId, id, startSample, endSample, mode: "graphic-illustration", createdAt: "2026-01-01T00:00:00.000Z", producer: { name: "t", version: "1" }, hidden: false, selected: true, imageUrl: `/${id}`, ...(anchorWordId === undefined ? {} : { anchorWordId }) }) as unknown as StitchedEntry;
  const take = (id: string, anchorWordId: string, model: string, createdAt: string) => ({ id, anchorWordId, model, text: `${model} on ${anchorWordId}`, createdAt, producer: { name: "t", version: "1" } }) as SceneDescriptionTake;
  // Two tracks: gpt declares shots at w1 (10), w5 (50), and w8 (80); qwen holds its w1 image throughout; main has an unanchored shot at 60.
  const stitched = [
    shot("gpt", "G1", 10, 50, "w1"), shot("gpt", "G2", 50, 80, "w5"), shot("gpt", "G3", 80, 200, "w8"),
    shot("qwen", "Q1", 10, 200, "w1"),
    { kind: "gap", trackId: "main", startSample: 0, endSample: 60 } as StitchedEntry, shot("main", "M1", 60, 200),
  ];
  const takes = [take("T3", "w5", "b", "2026-01-02T00:00:00.000Z"), take("T1", "w1", "a", "2026-01-01T00:00:00.000Z"), take("T2", "w5", "a", "2026-01-01T00:00:00.000Z"), take("T4", "w9", "a", "2026-01-01T00:00:00.000Z")];
  const summary = (scene: { startSample: number; endSample: number }) => sceneShots(stitched, takes, scene, 0).map(s => [s.anchorWordId, s.startSample, s.images.map(i => i.shot.id), s.descriptions.map(d => d.id)]);
  // A beat opening on the first declared shot and holding all three: each shot shows the images that start with it, qwen's under shot one
  // only; takes follow their anchor word, and one for an undeclared word shows nowhere. Main's unanchored shot starts mid-shot and is no one's take.
  assert.deepEqual(summary({ startSample: 10, endSample: 100 }), [["w1", 10, ["G1", "Q1"], ["T1"]], ["w5", 50, ["G2"], ["T2", "T3"]], ["w8", 80, ["G3"], []]]);
  // A beat starting mid-shot opens with the shot holding there, then what else the tracks show at its start: qwen's held image and main's unanchored shot.
  assert.deepEqual(summary({ startSample: 65, endSample: 120 }), [["w5", 50, ["G2"], ["T2", "T3"]], [null, 65, ["Q1", "M1"], []], ["w8", 80, ["G3"], []]]);
  // Before any declared shot, the scene lists the declared shots inside it, and an empty group only when nothing else is listed.
  assert.deepEqual(summary({ startSample: 0, endSample: 60 }), [["w1", 10, ["G1", "Q1"], ["T1"]], ["w5", 50, ["G2"], ["T2", "T3"]]]);
  assert.deepEqual(summary({ startSample: 0, endSample: 5 }), [[null, 0, [], []]]);
  const unanchored = [{ kind: "gap", trackId: "main", startSample: 0, endSample: 60 } as StitchedEntry, shot("main", "M1", 60, 200)];
  assert.deepEqual(sceneShots(unanchored, takes, { startSample: 70, endSample: 90 }, 0).map(s => [s.anchorWordId, s.images.map(i => i.shot.id)]), [[null, ["M1"]]]);
});
