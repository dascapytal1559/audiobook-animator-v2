import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { fixture } from "./context.fixture.js";
import { loadStoryContext, StoryError } from "./index.js";
const run = (configPath: string) => Effect.runPromise(loadStoryContext({ configPath }).pipe(Effect.provide(NodeServices.layer)));
const code = (value: string) => (error: unknown) => error instanceof StoryError && error.code === value;
test("planning context preserves complete paired input including raw words, punctuation and nonzero timing offset without writes", async t => {
  const f = await fixture(t);
  const before = await readFile(join(f.dir, "transcript.json"));
  const result = await run(f.configPath);
  assert.deepEqual(result.transcript, f.transcript);
  assert.equal(result.story.durationSeconds, 10);
  assert.deepEqual([result.bookId, result.bookTitle, result.story.synopsis, result.storyDirectory], ["book", "Book", "A synthetic pilot story.", f.dir]);
  assert.equal(result.paths.audioPath, join(f.dir, "audio.flac"));
  assert.deepEqual(await readFile(join(f.dir, "transcript.json")), before);
});
test("an explicit storyDirectory replaces the config's default story while the config still supplies the limits", async t => {
  const f = await fixture(t);
  f.config.storyDirectory = "nowhere";
  await f.save();
  await assert.rejects(run(f.configPath), code("IoFailed"), "the config's story does not exist");
  const result = await Effect.runPromise(loadStoryContext({ configPath: f.configPath, storyDirectory: f.dir }).pipe(Effect.provide(NodeServices.layer)));
  assert.deepEqual([result.story.id, result.storyDirectory], ["pilot", f.dir]);
  await assert.rejects(Effect.runPromise(loadStoryContext({ configPath: f.configPath, storyDirectory: "" }).pipe(Effect.provide(NodeServices.layer))), code("InvalidConfig"));
});
test("a manifest whose id, duration, links, or origin disagree with its directory and transcript fails; so do stale or malformed files", async t => {
  const cases: ReadonlyArray<[string, string]> = [["id", "InvalidManifest"], ["duration", "InvalidManifest"], ["outside", "InvalidManifest"], ["origin", "TranscriptMismatch"], ["kind", "TranscriptMismatch"], ["manifest", "InvalidManifest"], ["transcript", "TranscriptMismatch"]];
  for (const [issue, expected] of cases) {
    const f = await fixture(t);
    if (issue === "id") f.story.id = "missing";
    if (issue === "duration") f.story.durationSeconds = 11;
    if (issue === "outside") f.story.audioPath = "../audio.flac";
    if (issue === "origin") f.story.origin.providerJobId = "other";
    if (issue === "kind") f.transcript.segment.kind = "author-note";
    await f.save();
    if (issue === "manifest") await writeFile(join(f.dir, "story.json"), "{}");
    if (issue === "transcript") await writeFile(join(f.dir, "transcript.json"), "{}");
    await assert.rejects(run(f.configPath), code(expected), issue);
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
    await assert.rejects(run(f.configPath), code("TranscriptMismatch"), issue);
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
  f.config.limits.maxTranscriptBytes = 65536; f.config.limits.maxManifestBytes = 10; await f.save();
  await assert.rejects(run(f.configPath), code("IoFailed"));
});
