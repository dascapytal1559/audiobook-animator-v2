import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { renderStoryInventory } from "./index.js";
import type { StoryInventorySettings } from "./contracts.js";

const encode = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
type Fixture = { readonly storiesDirectory: string; readonly booksDirectory: string; readonly settings: StoryInventorySettings };
const run = (f: Fixture, settings: StoryInventorySettings = f.settings) => Effect.runPromise(renderStoryInventory({ storiesDirectory: f.storiesDirectory, booksDirectory: f.booksDirectory, settings }).pipe(Effect.provide(NodeServices.layer)));
const hasCode = (code: string) => (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error && error.code === code;
const h = "a".repeat(64);

/** Two books' worth of stories under one stories directory whose name needs URL encoding, plus each book's extras inventory. */
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "animator-inventory-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storiesDirectory = join(directory, "my stories (v2)");
  const inputPaths: string[] = [];
  const manifestPaths: string[] = [];
  const booksDirectory = join(directory, "books");
  const manifests: Array<Record<string, any>> = [];
  for (const [index, bookId] of ["first-book", "second-book"].entries()) {
    const bookDirectory = join(directory, "books", bookId);
    await mkdir(join(bookDirectory, "split"), { recursive: true });
    for (const [storyIndex, duration] of (index === 0 ? [90, 20] : [61.5]).entries()) {
      const id = `${bookId}-story-${storyIndex}`;
      const title = index === 0 && storyIndex === 1 ? "[Short] | <story> *two*" : `${bookId} story ${storyIndex}`;
      const storyDirectory = join(storiesDirectory, id);
      await mkdir(join(storyDirectory, "audio"), { recursive: true });
      const audio = Buffer.from(`opaque test audio ${bookId} ${id}`);
      const text = Buffer.from(`${title}. Narration.\n`);
      const audioManifest = { schemaVersion: 1, kind: "verified-story-audio", output: { filename: "audio.flac", sha256: hash(audio), byteLength: audio.byteLength, sampleRateHz: 10, sampleCount: duration * 10 } };
      const audioManifestBytes = encode(audioManifest);
      const transcript = {
        schemaVersion: 1, kind: "paired-story-segment-transcript",
        segment: { id, title, kind: "story", startSample: 100, endSample: 100 + duration * 10 },
        provenance: { planSha256: h, transcriptSha256: h, sourceSha256: h, providerJobId: "job" },
        audio: { path: "audio/audio.flac", manifestPath: "audio/manifest.json", manifestSha256: hash(audioManifestBytes), sha256: hash(audio), sampleRateHz: 10, sampleCount: duration * 10, durationSeconds: duration },
        wordCount: 3, text: text.toString().trimEnd(), elements: [],
      };
      const transcriptBytes = encode(transcript);
      const manifest = {
        schemaVersion: 1, kind: "story-manifest", transcriptProvider: "rev-ai", id, title, book: { id: bookId, title: `Collection ${index + 1}` }, spoilerPolicy: "premise-only",
        synopsis: "Someone explores [memory] | identity & <time>. A machine raises questions.",
        wordCount: 3, sampleCount: duration * 10, sampleRateHz: 10, durationSeconds: duration,
        durationDisplay: duration === 90 ? "00:01:30.000" : duration === 20 ? "00:00:20.000" : "00:01:01.500",
        audioPath: "audio/audio.flac", audioSha256: hash(audio), audioManifestPath: "audio/manifest.json", audioManifestSha256: hash(audioManifestBytes),
        transcriptPath: "transcript.json", transcriptSha256: hash(transcriptBytes), textPath: "transcript.txt", textSha256: hash(text),
        origin: { splitInventoryPath: `../../books/${bookId}/split/inventory.json`, splitInventorySha256: h, originalSegmentPath: `../../books/${bookId}/split/segments/${id}`, planSha256: h, transcriptSha256: h, sourceSha256: h, providerJobId: "job" },
      };
      for (const [name, bytes] of [["audio/audio.flac", audio], ["audio/manifest.json", audioManifestBytes], ["transcript.json", transcriptBytes], ["transcript.txt", text]] as const) {
        const path = join(storyDirectory, name);
        await writeFile(path, bytes);
        inputPaths.push(path);
      }
      await writeFile(join(storyDirectory, "story.json"), encode(manifest));
      manifestPaths.push(join(storyDirectory, "story.json"));
      manifests.push(manifest);
    }
    await writeFile(join(bookDirectory, "split", "inventory.md"), "# Original inventory\n\n## Extras\n\nNotes.\n");
    inputPaths.push(join(bookDirectory, "split", "inventory.md"));
  }
  const settings: StoryInventorySettings = { limits: { maxBooks: 2, maxStories: 3, maxManifestBytes: 65_536, maxTranscriptBytes: 65_536, maxAudioManifestBytes: 65_536, maxOutputBytes: 65_536 } };
  const outputPaths = [join(booksDirectory, "first-book", "inventory.md"), join(booksDirectory, "second-book", "inventory.md"), join(storiesDirectory, "inventory.md"), join(storiesDirectory, "inventory.json")];
  return { directory, storiesDirectory, booksDirectory, settings, manifests, manifestPaths, inputPaths, outputPaths };
}

const capture = async (paths: ReadonlyArray<string>) => Promise.all(paths.map(async (path) => ({ path, bytes: await readFile(path), mtime: (await stat(path)).mtimeMs })));
const unchanged = async (files: Awaited<ReturnType<typeof capture>>) => {
  for (const file of files) {
    assert.deepEqual(await readFile(file.path), file.bytes, file.path);
    assert.equal((await stat(file.path)).mtimeMs, file.mtime, `Unexpected write: ${file.path}`);
  }
};

test("inventories sort across collections and preserve exact durations, escaped prose, and working artifact links", async (t) => {
  const f = await fixture(t);
  const originals = await capture([...f.inputPaths, ...f.manifestPaths]);
  const result = await run(f);
  assert.equal(result.storyCount, 3);
  assert.equal(result.bookCount, 2);
  assert.deepEqual(result.outputPaths, f.outputPaths);
  const combined = JSON.parse(await readFile(f.outputPaths[3]!, "utf8"));
  assert.deepEqual(combined.stories.map((story: { durationSeconds: number }) => story.durationSeconds), [20, 61.5, 90]);
  assert.deepEqual(combined.books.map((book: { bookId: string; storyCount: number }) => [book.bookId, book.storyCount]), [["first-book", 2], ["second-book", 1]]);
  for (const entry of combined.stories) {
    const source = f.manifests.find((manifest) => manifest["id"] === entry.id)!;
    assert.equal(entry.bookId, source["book"].id);
    assert.equal(entry.sampleCount, source["sampleCount"]);
    assert.equal(entry.sampleRateHz, source["sampleRateHz"]);
    assert.equal(entry.durationSeconds, source["durationSeconds"]);
    assert.equal(entry.durationDisplay, source["durationDisplay"]);
    assert.equal(entry.synopsis, source["synopsis"]);
    for (const [pathKey, hashKey] of [["manifestPath", "manifestSha256"], ["audioPath", "audioSha256"], ["audioManifestPath", "audioManifestSha256"], ["transcriptPath", "transcriptSha256"], ["textPath", "textSha256"]]) {
      assert.equal(hash(await readFile(resolve(dirname(f.outputPaths[3]!), entry[pathKey!]))), entry[hashKey!]);
    }
  }
  for (const path of f.outputPaths.slice(0, 3)) {
    const markdown = await readFile(path, "utf8");
    assert.ok(markdown.includes("premise and avoid major spoilers"));
    assert.ok(!markdown.includes("sha256"));
    for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
      const destination = decodeURIComponent(match[1]!.split("#")[0]!);
      assert.ok((await stat(resolve(dirname(path), destination))).isFile());
    }
  }
  const markdown = await readFile(f.outputPaths[2]!, "utf8");
  assert.ok(markdown.includes("\\[Short\\] \\| &lt;story&gt; \\*two\\*"));
  assert.ok(markdown.includes("\\[memory\\] \\| identity &amp; &lt;time&gt;"));
  assert.ok(markdown.includes(" | 0:01:02 | "), "reader duration rounds to the nearest second");
  assert.ok((await readFile(f.outputPaths[0]!, "utf8")).includes("my%20stories%20%28v2%29"));
  await unchanged(originals);
});

test("a manifest that disagrees with its directory, transcript, or the books on disk rejects without changing any views", async (t) => {
  const f = await fixture(t);
  await run(f);
  const outputs = await capture(f.outputPaths);
  const original = f.manifests[0]!;
  const changes: ReadonlyArray<[Record<string, unknown>, string]> = [
    [{ ...original, id: "renamed" }, "InvalidManifest"],
    [{ ...original, title: "Different title" }, "TranscriptMismatch"],
    [{ ...original, transcriptSha256: "b".repeat(64) }, "TranscriptMismatch"],
    [{ ...original, origin: { ...original["origin"], providerJobId: "other" } }, "TranscriptMismatch"],
    [{ ...original, book: { id: "another-book", title: "Other" } }, "InvalidConfig"],
    [{ ...original, book: { id: "first-book", title: "Renamed collection" } }, "InvalidManifest"],
    [{ ...original, synopsis: " " }, "InvalidManifest"],
    [{ ...original, extra: true }, "InvalidManifest"],
  ];
  for (const [change, code] of changes) {
    await writeFile(f.manifestPaths[0]!, encode(change));
    await assert.rejects(run(f), hasCode(code), JSON.stringify(change));
    await unchanged(outputs);
  }
  await writeFile(f.manifestPaths[0]!, encode(original));
  await mkdir(join(f.storiesDirectory, "stray"));
  await assert.rejects(run(f), hasCode("InvalidManifest"));
  await unchanged(outputs);
});

test("stale paired files and inconsistent duration evidence stop before publication", async (t) => {
  const f = await fixture(t);
  await run(f);
  const outputs = await capture(f.outputPaths);
  const manifestPath = f.manifestPaths[0]!;
  const manifestBytes = await readFile(manifestPath);
  await writeFile(manifestPath, encode({ ...f.manifests[0]!, durationSeconds: f.manifests[0]!["durationSeconds"] + 1 }));
  await assert.rejects(run(f), hasCode("InvalidManifest"));
  await unchanged(outputs);
  await writeFile(manifestPath, manifestBytes);
  const transcriptPath = join(dirname(manifestPath), "transcript.json");
  const transcriptBytes = await readFile(transcriptPath);
  await writeFile(transcriptPath, `${transcriptBytes.toString()} `);
  await assert.rejects(run(f), hasCode("TranscriptMismatch"));
  await unchanged(outputs);
  await writeFile(transcriptPath, transcriptBytes);
  await writeFile(join(dirname(manifestPath), "audio", "audio.flac"), "truncated");
  await assert.rejects(run(f), hasCode("ArtifactMismatch"));
  await unchanged(outputs);
});

test("a directory under the stories directory that is not a story of its own name is refused before any view changes", async (t) => {
  const f = await fixture(t);
  await run(f);
  const outputs = await capture(f.outputPaths);
  const inputs = await capture([...f.inputPaths, ...f.manifestPaths]);
  await symlink(join(f.storiesDirectory, "first-book-story-0"), join(f.storiesDirectory, "story-link"));
  await assert.rejects(run(f), hasCode("InvalidManifest"), "a symlink to another story carries that story's id, not its own name");
  await unchanged(outputs);
  await unchanged(inputs);
});

test("repeated renders and synopsis edits leave the verified files untouched", async (t) => {
  const f = await fixture(t);
  const inputs = await capture(f.inputPaths);
  await run(f);
  const outputs = await Promise.all(f.outputPaths.map((path) => readFile(path)));
  await run(f);
  for (const [index, path] of f.outputPaths.entries()) assert.deepEqual(await readFile(path), outputs[index]);
  const synopsis = "A visitor investigates a machine that remembers everyone it meets.";
  await writeFile(f.manifestPaths[0]!, encode({ ...f.manifests[0]!, synopsis }));
  await run(f);
  assert.ok((await readFile(f.outputPaths[0]!, "utf8")).includes(synopsis));
  assert.ok((await readFile(f.outputPaths[2]!, "utf8")).includes(synopsis));
  assert.ok((await readFile(f.outputPaths[3]!, "utf8")).includes(synopsis));
  assert.deepEqual(await readFile(f.outputPaths[1]!), outputs[1]);
  await unchanged(inputs);
});

test("explicit read, count, and output limits reject oversized work before any view changes", async (t) => {
  const f = await fixture(t);
  await run(f);
  const outputs = await capture(f.outputPaths);
  for (const key of ["maxManifestBytes", "maxTranscriptBytes", "maxAudioManifestBytes", "maxOutputBytes", "maxStories", "maxBooks"] as const) {
    await assert.rejects(run(f, { limits: { ...f.settings.limits, [key]: 1 } }), hasCode(key === "maxOutputBytes" || key === "maxStories" || key === "maxBooks" ? "InvalidConfig" : "IoFailed"), key);
    await unchanged(outputs);
  }
});
