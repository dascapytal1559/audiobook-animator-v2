import assert from "node:assert/strict";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { fixture } from "../story-planning/context.fixture.js";
import { StoryPlanningError } from "../story-planning/index.js";
import { addShot, type DecisionsBody, loadVisualTimeline, mintUlid, ULID_PATTERN, VisualTimelineError, writeDecisions } from "./index.js";
const provide = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>) => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
const encode = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const failsWith = (code: string, pattern?: RegExp) => (error: unknown) =>
  error instanceof VisualTimelineError && error.code === code && (pattern === undefined || pattern.test(error.message));
const T = (ms: number) => new Date(Date.UTC(2026, 8, 8, 0, 0, 0, ms)).toISOString();

/** A planning directory beside the synthetic story (10 Hz, 100 samples) with helpers for hand-written records. */
async function planning(t: TestContext) {
  const story = await fixture(t);
  const planningDirectory = join(story.dir, "planning");
  await mkdir(join(planningDirectory, "shots"), { recursive: true });
  const configPath = join(story.dir, "visual-timeline.json");
  const config = { schemaVersion: 1, storyPlanningConfigPath: "config.json", planningDirectory: "planning", limits: { maxRecordBytes: 65536, maxDecisionsBytes: 65536, maxRecords: 100, maxImageBytes: 1024 } };
  await writeFile(configPath, encode(config));
  const clip = { bookId: "book", storyId: "pilot", audioSha256: story.inventory.stories[0]!.audioSha256, transcriptSha256: story.inventory.stories[0]!.transcriptSha256, sampleRateHz: 10, sampleCount: 100 };
  const producer = { name: "test", version: "0" };
  let counter = 0;
  async function record(fields: Record<string, unknown>, directoryName?: string) {
    const id = mintUlid(1_700_000_000_000 + counter++);
    const body = { schemaVersion: 1, kind: "visual-shot-generation", id, clip, startSample: 0, mode: "graphic-illustration", createdAt: T(counter), producer, ...fields };
    const directory = join(planningDirectory, "shots", directoryName ?? id);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "record.json"), encode(body));
    return body;
  }
  const decisions = (shots: DecisionsBody["shots"], extra: Record<string, unknown> = {}) =>
    writeFile(join(planningDirectory, "decisions.json"), encode({ schemaVersion: 1, kind: "visual-timeline-decisions", clip, updatedAt: T(0), settings: { frameAspect: { width: 16, height: 9 } }, shots, ...extra }));
  return { story, configPath, planningDirectory, clip, producer, record, decisions, load: () => provide(loadVisualTimeline({ configPath })) };
}

test("ULIDs are 26 Crockford characters, timestamp-prefixed, and unique", () => {
  const ids = Array.from({ length: 2000 }, () => mintUlid());
  for (const id of ids) assert.match(id, ULID_PATTERN);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(mintUlid(0).slice(0, 10), "0000000000");
  const [a, b] = [mintUlid(1_000), mintUlid(2_000)];
  assert.ok(a.slice(0, 10) < b.slice(0, 10));
  assert.throws(() => mintUlid(2 ** 48));
});

test("an empty planning directory yields no records, default settings, and one gap over the whole clip", async t => {
  const p = await planning(t);
  const result = await p.load();
  assert.deepEqual(result.records, []);
  assert.deepEqual(result.decisions.settings, { frameAspect: { width: 16, height: 9 } });
  assert.deepEqual(result.decisions.clip, p.clip);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.stitched, [{ kind: "gap", startSample: 0, endSample: 100 }]);
});

test("records with a bad id, wrong directory, out-of-range start, escaping image path, missing image, wrong mode, or extra field are rejected by name", async t => {
  const cases: Array<[Record<string, unknown>, string | undefined, RegExp]> = [
    [{ id: "not-a-ulid" }, "01ARZ3NDEKTSV4RRFFQ69G5FAV", /schema/],
    [{}, "01ARZ3NDEKTSV4RRFFQ69G5FAV", /does not match its directory name/],
    [{ startSample: 100 }, undefined, /outside the clip/],
    [{ startSample: -1 }, undefined, /schema/],
    [{ imagePath: "../escape.png" }, undefined, /schema/],
    [{ imagePath: "sub/image.png" }, undefined, /schema/],
    [{ imagePath: "/etc/passwd" }, undefined, /schema/],
    [{ imagePath: "missing.png" }, undefined, /does not exist/],
    [{ mode: "watercolour" }, undefined, /schema/],
    [{ unexpected: true }, undefined, /excess property/],
  ];
  for (const [fields, directoryName, pattern] of cases) {
    const p = await planning(t);
    const body = await p.record(fields, directoryName);
    await assert.rejects(p.load(), failsWith("InvalidRecord", new RegExp(`${pattern.source}|${body.id}`)), `case ${JSON.stringify(fields)}`);
    await assert.rejects(p.load(), (e: unknown) => e instanceof VisualTimelineError && e.message.includes(join(p.planningDirectory, "shots", directoryName ?? body.id, "record.json")));
  }
});

test("a record or decisions file pinned to a different clip fails loudly, naming the file", async t => {
  const p = await planning(t);
  const body = await p.record({ clip: { ...p.clip, audioSha256: "b".repeat(64) } });
  await assert.rejects(p.load(), failsWith("IdentityMismatch", new RegExp(`shots/${body.id}/record.json`)));
  const q = await planning(t);
  await q.decisions({}, { clip: { ...q.clip, sampleCount: 99 } });
  await assert.rejects(q.load(), failsWith("IdentityMismatch", /decisions\.json/));
});

test("merge holds each shot until the next start, the last until the clip end, and opens with a gap when nothing starts at zero", async t => {
  const p = await planning(t);
  const a = await p.record({ startSample: 40 });
  const b = await p.record({ startSample: 10, imagePath: "image.png" });
  await writeFile(join(p.planningDirectory, "shots", b.id, "image.png"), "png");
  const c = await p.record({ startSample: 70, mode: "poetic-abstraction" });
  const result = await p.load();
  assert.deepEqual(result.stitched.map(e => [e.kind, e.kind === "shot" ? e.id : null, e.startSample, e.endSample]),
    [["gap", null, 0, 10], ["shot", b.id, 10, 40], ["shot", a.id, 40, 70], ["shot", c.id, 70, 100]]);
  assert.equal(result.candidates.length, 3);
  assert.equal(result.records.length, 3);
});

test("candidates at one start default to the newest createdAt; an explicit decision overrides; two selections are rejected", async t => {
  const p = await planning(t);
  const older = await p.record({ startSample: 0, createdAt: T(1) });
  const newer = await p.record({ startSample: 0, createdAt: T(2) });
  let result = await p.load();
  assert.deepEqual(result.candidates.map(g => [g.startSample, g.selectedId, g.selectionSource]), [[0, newer.id, "default"]]);
  assert.deepEqual(result.candidates[0]!.shots.map(s => [s.id, s.selected]), [[newer.id, true], [older.id, false]]);
  assert.equal(result.stitched.length, 1);
  await p.decisions({ [older.id]: { selected: true } });
  result = await p.load();
  assert.deepEqual(result.candidates.map(g => [g.selectedId, g.selectionSource]), [[older.id, "decision"]]);
  const first = result.stitched[0]!;
  assert.equal(first.kind === "shot" ? first.id : null, older.id);
  await p.decisions({ [older.id]: { selected: true }, [newer.id]: { selected: true } });
  await assert.rejects(p.load(), failsWith("InvalidDecisions", /More than one shot selected at sample 0/));
});

test("decision overrides move a shot into another group; hidden shots are never selected or stitched; unknown ids and selected+hidden are rejected", async t => {
  const p = await planning(t);
  const a = await p.record({ startSample: 0, createdAt: T(1) });
  const b = await p.record({ startSample: 50, createdAt: T(2), notes: "generated" });
  await p.decisions({ [b.id]: { startSample: 0, mode: "poetic-abstraction", notes: "moved" } });
  let result = await p.load();
  assert.deepEqual(result.candidates.map(g => [g.startSample, g.selectedId]), [[0, b.id]]);
  const moved = result.candidates[0]!.shots.find(s => s.id === b.id)!;
  assert.deepEqual([moved.mode, moved.notes, moved.startSample], ["poetic-abstraction", "moved", 0]);
  await p.decisions({ [b.id]: { hidden: true } });
  result = await p.load();
  assert.deepEqual(result.candidates.map(g => [g.startSample, g.selectedId, g.selectionSource]), [[0, a.id, "default"], [50, null, null]]);
  assert.deepEqual(result.stitched.map(e => [e.kind, e.startSample, e.endSample]), [["shot", 0, 100]]);
  await p.decisions({ [a.id]: { hidden: true }, [b.id]: { hidden: true } });
  result = await p.load();
  assert.deepEqual(result.stitched, [{ kind: "gap", startSample: 0, endSample: 100 }]);
  await p.decisions({ ["01ARZ3NDEKTSV4RRFFQ69G5FAV"]: { hidden: true } });
  await assert.rejects(p.load(), failsWith("InvalidDecisions", /no generation record: 01ARZ3NDEKTSV4RRFFQ69G5FAV/));
  await p.decisions({ [a.id]: { hidden: true, selected: true } });
  await assert.rejects(p.load(), failsWith("InvalidDecisions", /both selected and hidden/));
  await p.decisions({ [a.id]: { startSample: 100 } });
  await assert.rejects(p.load(), failsWith("InvalidDecisions", /outside the clip/));
});

test("addShot mints a record, copies the image, converts seconds to samples, and refuses an existing directory or oversized image", async t => {
  const p = await planning(t);
  const source = join(p.story.dir, "source.PNG");
  await writeFile(source, "image bytes");
  const record = await provide(addShot({ configPath: p.configPath, startSeconds: 2.36, mode: "graphic-illustration", label: "Opening", prompt: "A parrot", imageSourcePath: source, notes: "n", producer: p.producer }));
  assert.equal(record.startSample, 24);
  assert.equal(record.imagePath, "image.png");
  assert.deepEqual(record.clip, p.clip);
  assert.match(record.id, ULID_PATTERN);
  const directory = join(p.planningDirectory, "shots", record.id);
  assert.equal(await readFile(join(directory, "image.png"), "utf8"), "image bytes");
  assert.deepEqual(JSON.parse(await readFile(join(directory, "record.json"), "utf8")), record);
  const loaded = await p.load();
  assert.deepEqual(loaded.records, [record]);
  assert.deepEqual(loaded.stitched.map(e => [e.kind, e.startSample, e.endSample]), [["gap", 0, 24], ["shot", 24, 100]]);
  const imageless = await provide(addShot({ configPath: p.configPath, startSample: 99, mode: "poetic-abstraction", producer: p.producer }));
  assert.equal(imageless.imagePath, undefined);
  assert.equal((await p.load()).records.length, 2);
  for (const bad of [{ startSample: 100 }, { startSeconds: 10 }, { startSample: 1, startSeconds: 1 }, {}, { startSeconds: Number.NaN }]) {
    await assert.rejects(provide(addShot({ configPath: p.configPath, mode: "graphic-illustration", producer: p.producer, ...bad })), failsWith("InvalidRequest"));
  }
  await writeFile(source, Buffer.alloc(2048));
  await assert.rejects(provide(addShot({ configPath: p.configPath, startSample: 0, mode: "graphic-illustration", imageSourcePath: source, producer: p.producer })), failsWith("IoFailed", /source\.PNG/));
  assert.equal((await p.load()).records.length, 2);
});

test("addShot never overwrites: an explicit id whose directory already exists is a RecordExists error, and a malformed id is rejected", async t => {
  const p = await planning(t);
  const id = mintUlid();
  const directory = join(p.planningDirectory, "shots", id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "record.json"), "untouched");
  await assert.rejects(provide(addShot({ configPath: p.configPath, id, startSample: 0, mode: "graphic-illustration", producer: p.producer })), failsWith("RecordExists", new RegExp(id)));
  assert.equal(await readFile(join(directory, "record.json"), "utf8"), "untouched");
  await assert.rejects(provide(addShot({ configPath: p.configPath, id: "not-a-ulid", startSample: 0, mode: "graphic-illustration", producer: p.producer })), failsWith("InvalidRequest", /not a ULID/));
  const explicit = await provide(addShot({ configPath: p.configPath, id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", startSample: 3, mode: "graphic-illustration", producer: p.producer }));
  assert.equal(explicit.id, "01ARZ3NDEKTSV4RRFFQ69G5FAV");
  assert.deepEqual((await readdir(join(p.planningDirectory, "shots"))).sort(), [explicit.id, id].sort());
});

test("writeDecisions round-trips through load, sets updatedAt, and rejects invalid overlays without touching the file", async t => {
  const p = await planning(t);
  const a = await p.record({ startSample: 5 });
  const body: DecisionsBody = { settings: { frameAspect: { width: 4, height: 3 } }, shots: { [a.id]: { startSample: 0, selected: true, notes: "pinned" } } };
  const written = await provide(writeDecisions({ configPath: p.configPath, decisions: body }));
  assert.deepEqual(written.clip, p.clip);
  assert.ok(!Number.isNaN(Date.parse(written.updatedAt)));
  const result = await p.load();
  assert.deepEqual(result.decisions, written);
  assert.deepEqual(JSON.parse(await readFile(join(p.planningDirectory, "decisions.json"), "utf8")), written);
  assert.deepEqual(result.stitched.map(e => [e.kind, e.startSample, e.endSample]), [["shot", 0, 100]]);
  await assert.rejects(provide(writeDecisions({ configPath: p.configPath, decisions: { ...body, shots: { "01ARZ3NDEKTSV4RRFFQ69G5FAV": {} } } })), failsWith("InvalidDecisions", /no generation record/));
  await assert.rejects(provide(writeDecisions({ configPath: p.configPath, decisions: { settings: { frameAspect: { width: 0, height: 9 } }, shots: {} } })), failsWith("InvalidDecisions", /schema/));
  assert.deepEqual(JSON.parse(await readFile(join(p.planningDirectory, "decisions.json"), "utf8")), written);
});

test("a broken story identity surfaces as the story-planning error, not a timeline error", async t => {
  const p = await planning(t);
  await writeFile(join(p.story.dir, "transcript.json"), "{}");
  await assert.rejects(p.load(), (e: unknown) => e instanceof StoryPlanningError && e.code === "TranscriptMismatch");
});

test("show on The Great Silence loads the real verified clip", async t => {
  const configPath = fileURLToPath(new URL("../../../config/visual-timeline.json", import.meta.url));
  const storyPlanningPath = fileURLToPath(new URL("../../../config/story-planning.json", import.meta.url));
  const inventory = fileURLToPath(new URL("../../../data/books/exhalation/split/inventory.json", import.meta.url));
  if (!(await access(inventory).then(() => true, () => false))) return t.skip("local story data is not present");
  assert.ok(await access(storyPlanningPath).then(() => true, () => false));
  const result = await provide(loadVisualTimeline({ configPath }));
  assert.deepEqual([result.clip.bookId, result.clip.storyId, result.clip.sampleRateHz, result.clip.sampleCount], ["exhalation", "the-great-silence", 44100, 21608368]);
  assert.match(result.planningDirectory, /data\/books\/exhalation\/planning\/the-great-silence$/);
  const last = result.stitched.at(-1)!;
  assert.equal(last.endSample, 21608368);
  assert.equal(result.stitched[0]!.startSample, 0);
});
