import assert from "node:assert/strict";
import test from "node:test";
import type { StoryMapResponse, Word } from "./api.js";
import type { MapState } from "./state.js";
import { clock, currentChain, resolveMapView, sceneToShow } from "./story-map-view.js";

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
