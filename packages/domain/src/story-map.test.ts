import assert from "node:assert/strict";
import test from "node:test";
import { currentSections, isInsidePath, resolveStoryMap, storyMapProblems, type Section, type Subject } from "./story-map.js";

const ids = ["w0", "w1", "w2", "w3", "w4", "w5"];
const words = ids.map((id, i) => ({ id, value: `v${i}`, startSample: i * 10, endSample: i * 10 + 8 }));
const section = (id: string, kind: Section["kind"], a: number, b: number): Section => ({ id, kind, title: id, startWordId: `w${a}`, endWordId: `w${b}` });
const subject = (id: string, mentions: ReadonlyArray<[number, number]>, extra: Partial<Subject> = {}): Subject => ({ id, kind: "character", name: id, mentions: mentions.map(([a, b]) => ({ startWordId: `w${a}`, endWordId: `w${b}` })), ...extra });

test("a usable map has no problems; unknown words, reversed ranges, duplicate ids, partial overlaps, identical spans, and escaping image paths are each named", () => {
  const good = { subjects: [subject("hero", [[0, 1], [4, 4]], { images: [{ path: "refs/hero.png", role: "canonical" }] })], sections: [section("act-1", "act", 0, 5), section("beat-1", "beat", 0, 2), section("beat-2", "beat", 3, 5)] };
  assert.deepEqual(storyMapProblems(good, ids), []);
  const bad = {
    subjects: [subject("hero", [[0, 9]], { images: [{ path: "../out.png", role: "x" }, { path: "/abs.png", role: "y" }] }), subject("hero", [[3, 1]])],
    sections: [section("a", "act", 0, 3), section("b", "beat", 2, 5), section("c", "beat", 2, 5), section("a", "scene", 0, 0), section("d", "beat", 0, 99)],
  };
  assert.deepEqual(storyMapProblems(bad, ids), [
    "subject hero mention 0 names an unknown word w9",
    "subject hero image 0 must be a relative path inside the story directory, not ../out.png",
    "subject hero image 1 must be a relative path inside the story directory, not /abs.png",
    "subject hero appears twice",
    "subject hero mention 0 ends at w1 before it starts at w3",
    "section a appears twice",
    "section d names an unknown word w99",
    "sections a and b overlap without one containing the other",
    "sections a and c overlap without one containing the other",
    "sections b and c cover the same words",
  ]);
  assert.deepEqual(["a/b.png", "a\\b.png", "./a.png", "a//b.png", "..", "a/../b.png", "C:\\x.png", "/x.png"].map(isInsidePath), [true, true, true, false, false, false, false, false]);
});

test("resolving orders sections with parents first, times ranges by earliest start and latest end, quotes the words, and cross-references subjects and sections", () => {
  const map = {
    subjects: [subject("hero", [[4, 5], [0, 0]]), subject("ship", [[2, 3]], { kind: "object" as const }), subject("nobody", [])],
    sections: [section("beat-2", "beat", 3, 5), section("act-1", "act", 0, 5), section("beat-1", "beat", 0, 2), section("moment", "scene", 4, 5)],
  };
  const inverted = words.map(w => (w.id === "w5" ? { ...w, startSample: 30, endSample: 100 } : w));
  const resolved = resolveStoryMap(map, inverted);
  assert.deepEqual(resolved.sections.map(s => [s.id, s.parentId, s.depth, s.startSample, s.endSample, s.wordCount, s.text, s.subjectIds]), [
    ["act-1", null, 0, 0, 100, 6, "v0 v1 v2 v3 v4 v5", ["hero", "ship"]],
    ["beat-1", "act-1", 1, 0, 28, 3, "v0 v1 v2", ["hero", "ship"]],
    ["beat-2", "act-1", 1, 30, 100, 3, "v3 v4 v5", ["hero", "ship"]],
    ["moment", "beat-2", 2, 30, 100, 2, "v4 v5", ["hero"]],
  ]);
  assert.deepEqual(resolved.subjects.map(s => [s.id, s.mentions.map(m => [m.startSample, m.endSample, m.text]), s.sectionIds]), [
    ["hero", [[0, 8, "v0"], [30, 100, "v4 v5"]], ["act-1", "beat-1", "beat-2", "moment"]],
    ["ship", [[20, 38, "v2 v3"]], ["act-1", "beat-1", "beat-2"]],
    ["nobody", [], []],
  ]);
  assert.throws(() => resolveStoryMap({ subjects: [], sections: [section("x", "act", 0, 9)] }, words), RangeError);
});

test("the current chain holds each depth's last started section until the next starts, and drops a child whose parent is no longer current", () => {
  const map = { subjects: [], sections: [section("act-1", "act", 0, 2), section("beat-1", "beat", 0, 0), section("beat-2", "beat", 2, 2), section("act-2", "act", 3, 5), section("beat-3", "beat", 4, 5)] };
  const sections = resolveStoryMap(map, words).sections;
  const chain = (sample: number) => currentSections(sections, sample).map(s => s.id);
  assert.deepEqual([chain(-1), chain(0), chain(9), chain(15), chain(20), chain(30), chain(35), chain(40), chain(500)],
    [[], ["act-1", "beat-1"], ["act-1", "beat-1"], ["act-1", "beat-1"], ["act-1", "beat-2"], ["act-2"], ["act-2"], ["act-2", "beat-3"], ["act-2", "beat-3"]]);
});
