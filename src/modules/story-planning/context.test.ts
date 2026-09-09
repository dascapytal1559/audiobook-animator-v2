import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { fixture } from "./context.fixture.js";
import { loadStoryContext, StoryPlanningError } from "./index.js";
const run = (configPath: string) => Effect.runPromise(loadStoryContext({ configPath }).pipe(Effect.provide(NodeServices.layer)));
const code = (value: string) => (error: unknown) => error instanceof StoryPlanningError && error.code === value;
test("planning context preserves complete paired input including raw words, punctuation and nonzero timing offset without writes", async t => {
  const f = await fixture(t);
  const before = await readFile(join(f.dir, "transcript.json"));
  const result = await run(f.configPath);
  assert.deepEqual(result.transcript, f.transcript);
  assert.equal(result.story.durationSeconds, 10);
  assert.equal(result.paths.audioPath, join(f.dir, "audio.flac"));
  assert.deepEqual(await readFile(join(f.dir, "transcript.json")), before);
});
test("wrong story, book, kind and stale inventory or transcript fail", async t => {
  for (const issue of ["story", "book", "kind", "inventory", "transcript"]) {
    const f = await fixture(t);
    if (issue === "story") f.config.storyId = "missing";
    if (issue === "book") f.config.bookTitle = "Wrong book";
    if (issue === "kind") f.transcript.segment.kind = "author-note";
    await f.save();
    if (issue === "inventory" || issue === "transcript") await writeFile(join(f.dir, `${issue}.json`), "{}");
    await assert.rejects(run(f.configPath), code(issue === "kind" || issue === "transcript" ? "TranscriptMismatch" : "InvalidInventory"));
  }
});
test("malformed stable references, timing, word count and audio links fail even with updated document hashes", async t => {
  for (const issue of ["id", "order", "index", "timing", "count", "link"]) {
    const f = await fixture(t);
    if (issue === "id") f.transcript.elements[1]!.id = "m2:e0";
    if (issue === "order") f.transcript.elements[1]!.id = "m1:e1";
    if (issue === "index") f.transcript.elements[1]!.bookElementIndex = 4;
    if (issue === "timing") f.transcript.elements[0]!.approximateSegmentStartSeconds = 2;
    if (issue === "count") f.transcript.wordCount = 2;
    if (issue === "link") f.transcript.audio.path = "different.flac";
    await f.save();
    await assert.rejects(run(f.configPath), code("TranscriptMismatch"));
  }
});
test("missing linked files, changed audio size, and explicit read limits fail", async t => {
  const f = await fixture(t);
  await writeFile(join(f.dir, "audio.flac"), "changed");
  await assert.rejects(run(f.configPath), code("ArtifactMismatch"));
  await rm(join(f.dir, "audio.flac"));
  await assert.rejects(run(f.configPath), code("IoFailed"));
  f.config.limits.maxTranscriptBytes = 10; await f.save();
  await assert.rejects(run(f.configPath), code("IoFailed"));
});
