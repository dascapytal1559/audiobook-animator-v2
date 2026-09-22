import assert from "node:assert/strict";
import test from "node:test";
import { Schema } from "effect";
import { ModelId, SceneDescriptions, sceneDescriptionProblems, type SceneDescriptionTake, takesForSection } from "./scene-descriptions.js";

const clip = { bookId: "book", storyId: "pilot", audioSha256: "a".repeat(64), transcriptSha256: "b".repeat(64), sampleRateHz: 10, sampleCount: 100 };
const take = (id: string, sectionId: string, model: string, text: string, createdAt = "2026-09-22T10:00:00.000Z"): SceneDescriptionTake =>
  ({ id, sectionId, model, text, startWordId: "w0", endWordId: "w2", createdAt, producer: { name: "editor", version: "test" } });
const ID_A = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const ID_B = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const ID_C = "01ARZ3NDEKTSV4RRFFQ69G5FAX";

test("a model id is provider-style: lowercase segments with dots and hyphens, joined by slashes", () => {
  const is = Schema.is(ModelId);
  for (const good of ["deepseek/deepseek-v4.1-flash", "openai/gpt-6-astra", "anthropic/claude-fable-5.1", "local-qwen"]) assert.ok(is(good), good);
  for (const bad of ["", "Anthropic/Claude", "a//b", "/a", "a/", "a b", ".a"]) assert.ok(!is(bad), bad);
});

test("the sidecar decodes strictly: a take needs its id, section, model, text, word range, time, and producer, and the file is pinned to the clip", () => {
  const file = { schemaVersion: 1, kind: "scene-descriptions", clip, updatedAt: "2026-09-22T10:00:00.000Z", takes: [take(ID_A, "beat-1", "openai/gpt-6-astra", "Under the ice.")] };
  assert.deepEqual(Schema.decodeUnknownSync(SceneDescriptions)(file), file);
  assert.throws(() => Schema.decodeUnknownSync(SceneDescriptions)({ ...file, takes: [{ ...file.takes[0], text: "  " }] }));
  assert.throws(() => Schema.decodeUnknownSync(SceneDescriptions)({ ...file, takes: [{ ...file.takes[0], id: "not-a-ulid" }] }));
  assert.throws(() => Schema.decodeUnknownSync(SceneDescriptions)({ ...file, kind: "story-map" }));
  assert.throws(() => Schema.decodeUnknownSync(SceneDescriptions, { onExcessProperty: "error" })({ ...file, picked: ID_A }));
});

test("duplicate ids and a repeated (section, model, text) triple are named; distinct takes by one model for one section are fine", () => {
  const a = take(ID_A, "beat-1", "openai/gpt-6-astra", "Under the ice.");
  assert.deepEqual(sceneDescriptionProblems([a, take(ID_B, "beat-1", "openai/gpt-6-astra", "Under the ice, again."), take(ID_C, "beat-2", "openai/gpt-6-astra", "Under the ice.")]), []);
  assert.deepEqual(sceneDescriptionProblems([a, take(ID_A, "beat-2", "x", "y"), take(ID_B, "beat-1", "openai/gpt-6-astra", "Under the ice.")]), [
    `take ${ID_A} appears twice`,
    `take ${ID_B} repeats an earlier take by openai/gpt-6-astra for section beat-1`,
  ]);
});

test("the takes for a section come back oldest first, ties broken by id, other sections left out", () => {
  const takes = [take(ID_C, "beat-1", "m", "third", "2026-09-22T12:00:00.000Z"), take(ID_B, "beat-2", "m", "other"), take(ID_A, "beat-1", "m", "first", "2026-09-22T09:00:00.000Z"), take(ID_B, "beat-1", "m", "second", "2026-09-22T09:00:00.000Z")];
  assert.deepEqual(takesForSection(takes, "beat-1").map(t => t.text), ["first", "second", "third"]);
  assert.deepEqual(takesForSection(takes, "beat-9"), []);
});
