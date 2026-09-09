import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { renderStoryInventory } from "./index.js";
import type { StoryInventoryConfig } from "./contracts.js";

const encode = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const run = (configPath: string) => Effect.runPromise(renderStoryInventory({ configPath }).pipe(Effect.provide(NodeServices.layer)));
const hasCode = (code: string) => (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error && error.code === code;
const h = "a".repeat(64);

/** Two books' worth of stories under one stories directory whose name needs URL encoding, plus each book's extras inventory. */
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "animator-inventory-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "config"));
  const storiesDirectory = join(directory, "my stories (v2)");
  const inputPaths: string[] = [];
  const manifestPaths: string[] = [];
  const books: Array<StoryInventoryConfig["books"][number]> = [];
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
        schemaVersion: 1, kind: "story-manifest", id, title, book: { id: bookId, title: `Collection ${index + 1}` }, spoilerPolicy: "premise-only",
        synopsis: "Someone explores [memory] | identity & <time>. A machine raises questions.",
        wordCount: 3, sampleCount: duration * 10, sampleRateHz: 10, durationSeconds: duration,
        durationDisplay: duration === 90 ? "00:01:30.000" : duration === 20 ? "00:00:20.000" : "00:01:01.500",
        audioPath: "audio/audio.flac", audioSha256: hash(audio), audioManifestPath: "audio/manifest.json", audioManifestSha256: hash(audioManifestBytes),
        transcriptPath: "transcript.json", transcriptSha256: hash(transcriptBytes), textPath: "transcript.txt", textSha256: hash(text),
        origin: { splitInventoryPath: `../../books/${bookId}/split/inventory.json`, splitInventorySha256: h, segmentPath: `../../books/${bookId}/split/segments/${id}`, planSha256: h, transcriptSha256: h, sourceSha256: h, providerJobId: "job" },
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
    books.push({ bookId, extrasInventoryPath: `../books/${bookId}/split/inventory.md`, outputMarkdownPath: `../books/${bookId}/inventory.md` });
  }
  const config: StoryInventoryConfig = {
    schemaVersion: 1, storiesDirectory: "../my stories (v2)", books, outputMarkdownPath: "../my stories (v2)/inventory.md", outputJsonPath: "../my stories (v2)/inventory.json",
    limits: { maxBooks: 2, maxStories: 3, maxManifestBytes: 65_536, maxTranscriptBytes: 65_536, maxAudioManifestBytes: 65_536, maxOutputBytes: 65_536 },
  };
  const configPath = join(directory, "config", "inventory.json");
  await writeFile(configPath, encode(config));
  const outputPaths = [...books.map((book) => resolve(dirname(configPath), book.outputMarkdownPath)), resolve(dirname(configPath), config.outputMarkdownPath), resolve(dirname(configPath), config.outputJsonPath)];
  return { directory, storiesDirectory, config, configPath, manifests, manifestPaths, inputPaths, outputPaths };
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
  const result = await run(f.configPath);
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

test("a manifest that disagrees with its directory, transcript, or configured books rejects without changing any views", async (t) => {
  const f = await fixture(t);
  await run(f.configPath);
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
    await assert.rejects(run(f.configPath), hasCode(code), JSON.stringify(change));
    await unchanged(outputs);
  }
  await writeFile(f.manifestPaths[0]!, encode(original));
  await mkdir(join(f.storiesDirectory, "stray"));
  await assert.rejects(run(f.configPath), hasCode("InvalidManifest"));
  await unchanged(outputs);
});

test("stale paired files and inconsistent duration evidence stop before publication", async (t) => {
  const f = await fixture(t);
  await run(f.configPath);
  const outputs = await capture(f.outputPaths);
  const manifestPath = f.manifestPaths[0]!;
  const manifestBytes = await readFile(manifestPath);
  await writeFile(manifestPath, encode({ ...f.manifests[0]!, durationSeconds: f.manifests[0]!["durationSeconds"] + 1 }));
  await assert.rejects(run(f.configPath), hasCode("InvalidManifest"));
  await unchanged(outputs);
  await writeFile(manifestPath, manifestBytes);
  const transcriptPath = join(dirname(manifestPath), "transcript.json");
  const transcriptBytes = await readFile(transcriptPath);
  await writeFile(transcriptPath, `${transcriptBytes.toString()} `);
  await assert.rejects(run(f.configPath), hasCode("TranscriptMismatch"));
  await unchanged(outputs);
  await writeFile(transcriptPath, transcriptBytes);
  await writeFile(join(dirname(manifestPath), "audio", "audio.flac"), "truncated");
  await assert.rejects(run(f.configPath), hasCode("ArtifactMismatch"));
  await unchanged(outputs);
});

test("output collisions, including symlinked story directories, cannot overwrite inputs or other views", async (t) => {
  const f = await fixture(t);
  await run(f.configPath);
  const outputs = await capture(f.outputPaths);
  const inputs = await capture([...f.inputPaths, ...f.manifestPaths]);
  await symlink(join(f.storiesDirectory, "first-book-story-0"), join(f.directory, "story-link"));
  for (const outputMarkdownPath of ["inventory.json", f.config.books[0]!.extrasInventoryPath, f.config.outputJsonPath,
    "../my stories (v2)/first-book-story-0/story.json", "../my stories (v2)/first-book-story-0/new-reader-view.md", "../story-link/inventory.md"]) {
    await writeFile(f.configPath, encode({ ...f.config, outputMarkdownPath }));
    await assert.rejects(run(f.configPath), hasCode("InvalidConfig"), outputMarkdownPath);
    await unchanged(outputs);
    await unchanged(inputs);
  }
});

test("repeated renders and synopsis edits leave the verified files untouched", async (t) => {
  const f = await fixture(t);
  const inputs = await capture(f.inputPaths);
  await run(f.configPath);
  const outputs = await Promise.all(f.outputPaths.map((path) => readFile(path)));
  await run(f.configPath);
  for (const [index, path] of f.outputPaths.entries()) assert.deepEqual(await readFile(path), outputs[index]);
  const synopsis = "A visitor investigates a machine that remembers everyone it meets.";
  await writeFile(f.manifestPaths[0]!, encode({ ...f.manifests[0]!, synopsis }));
  await run(f.configPath);
  assert.ok((await readFile(f.outputPaths[0]!, "utf8")).includes(synopsis));
  assert.ok((await readFile(f.outputPaths[2]!, "utf8")).includes(synopsis));
  assert.ok((await readFile(f.outputPaths[3]!, "utf8")).includes(synopsis));
  assert.deepEqual(await readFile(f.outputPaths[1]!), outputs[1]);
  await unchanged(inputs);
});

test("explicit read, count, and output limits reject oversized work before any view changes", async (t) => {
  const f = await fixture(t);
  await run(f.configPath);
  const outputs = await capture(f.outputPaths);
  for (const key of ["maxManifestBytes", "maxTranscriptBytes", "maxAudioManifestBytes", "maxOutputBytes", "maxStories"] as const) {
    await writeFile(f.configPath, encode({ ...f.config, limits: { ...f.config.limits, [key]: 1 } }));
    await assert.rejects(run(f.configPath), hasCode(key === "maxOutputBytes" || key === "maxStories" ? "InvalidConfig" : "IoFailed"), key);
    await unchanged(outputs);
  }
});
