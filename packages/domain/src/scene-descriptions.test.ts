import assert from "node:assert/strict";
import test from "node:test";
import { Schema } from "effect";
import { ModelId, SceneDescriptions, sceneDescriptionProblems, type SceneDescriptionTake, takesForShot } from "./scene-descriptions.js";

const clip = { bookId: "book", storyId: "pilot", audioSha256: "a".repeat(64), transcriptSha256: "b".repeat(64), sampleRateHz: 10, sampleCount: 100 };
const take = (id: string, anchorWordId: string, model: string, text: string, createdAt = "2026-09-22T10:00:00.000Z"): SceneDescriptionTake =>
  ({ id, anchorWordId, model, text, createdAt, producer: { name: "editor", version: "test" } });
const ID_A = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const ID_B = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const ID_C = "01ARZ3NDEKTSV4RRFFQ69G5FAX";

test("a model id is provider-style: lowercase segments with dots and hyphens, joined by slashes", () => {
  const is = Schema.is(ModelId);
  for (const good of ["deepseek/deepseek-v4.1-flash", "openai/gpt-6-astra", "anthropic/claude-fable-5.1", "local-qwen"]) assert.ok(is(good), good);
  for (const bad of ["", "Anthropic/Claude", "a//b", "/a", "a/", "a b", ".a"]) assert.ok(!is(bad), bad);
});

test("the file decodes strictly: a take needs its id, shot anchor, model, text, time, and producer, and the file is version 2, pinned to the clip", () => {
  const file = { schemaVersion: 2, kind: "scene-descriptions", clip, updatedAt: "2026-09-22T10:00:00.000Z", takes: [take(ID_A, "w0", "openai/gpt-6-astra", "Under the ice.")] };
  assert.deepEqual(Schema.decodeUnknownSync(SceneDescriptions)(file), file);
  assert.throws(() => Schema.decodeUnknownSync(SceneDescriptions)({ ...file, takes: [{ ...file.takes[0], text: "  " }] }));
  assert.throws(() => Schema.decodeUnknownSync(SceneDescriptions)({ ...file, takes: [{ ...file.takes[0], id: "not-a-ulid" }] }));
  assert.throws(() => Schema.decodeUnknownSync(SceneDescriptions)({ ...file, kind: "story-map" }));
  assert.throws(() => Schema.decodeUnknownSync(SceneDescriptions)({ ...file, schemaVersion: 1 }), "a section-keyed version 1 file is refused");
  assert.throws(() => Schema.decodeUnknownSync(SceneDescriptions, { onExcessProperty: "error" })({ ...file, takes: [{ ...file.takes[0], sectionId: "beat-1" }] }));
  assert.throws(() => Schema.decodeUnknownSync(SceneDescriptions, { onExcessProperty: "error" })({ ...file, picked: ID_A }));
});

test("duplicate ids and a repeated (shot, model, text) triple are named; distinct takes by one model for one shot are fine", () => {
  const a = take(ID_A, "w0", "openai/gpt-6-astra", "Under the ice.");
  assert.deepEqual(sceneDescriptionProblems([a, take(ID_B, "w0", "openai/gpt-6-astra", "Under the ice, again."), take(ID_C, "w7", "openai/gpt-6-astra", "Under the ice.")]), []);
  assert.deepEqual(sceneDescriptionProblems([a, take(ID_A, "w7", "x", "y"), take(ID_B, "w0", "openai/gpt-6-astra", "Under the ice.")]), [
    `take ${ID_A} appears twice`,
    `take ${ID_B} repeats an earlier take by openai/gpt-6-astra for the shot at w0`,
  ]);
});

test("the takes for a shot come back oldest first, ties broken by id, other shots left out", () => {
  const takes = [take(ID_C, "w0", "m", "third", "2026-09-22T12:00:00.000Z"), take(ID_B, "w7", "m", "other"), take(ID_A, "w0", "m", "first", "2026-09-22T09:00:00.000Z"), take(ID_B, "w0", "m", "second", "2026-09-22T09:00:00.000Z")];
  assert.deepEqual(takesForShot(takes, "w0").map(t => t.text), ["first", "second", "third"]);
  assert.deepEqual(takesForShot(takes, "w9"), []);
});
