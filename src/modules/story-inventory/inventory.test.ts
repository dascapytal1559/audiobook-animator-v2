import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { renderStoryInventory } from "./index.js";
import type { StoryInventoryConfig, StorySynopses, VerifiedStory } from "./contracts.js";

const encode = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const run = (configPath: string) => Effect.runPromise(renderStoryInventory({ configPath }).pipe(Effect.provide(NodeServices.layer)));
const hasCode = (code: string) => (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error && error.code === code;

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "animator-inventory-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "config"));
  const inputPaths: string[] = [];
  const books: Array<StoryInventoryConfig["books"][number]> = [];
  const sourceStories: Array<VerifiedStory & { bookId: string }> = [];
  const sidecars: StorySynopses[] = [];
  for (const [index, bookId] of ["first-book", "second-book"].entries()) {
    const bookDirectory = join(directory, "books", bookId);
    const split = join(bookDirectory, "split");
    const stories: VerifiedStory[] = [];
    for (const [storyIndex, duration] of (index === 0 ? [90, 20] : [61.5]).entries()) {
      const id = `story-${storyIndex}`;
      const title = index === 0 && storyIndex === 1 ? "[Short] | <story> *two*" : `${bookId} story ${storyIndex}`;
      const pairDirectory = join(split, "segments", `${id} # (audio)`);
      await mkdir(pairDirectory, { recursive: true });
      const audio = Buffer.from(`opaque test audio ${bookId} ${id}`);
      const text = Buffer.from(`${title}. Narration.\n`);
      const manifest = {
        schemaVersion: 1, kind: "verified-story-audio", output: {
          filename: "audio.flac", sha256: hash(audio), byteLength: audio.byteLength,
          sampleRateHz: 10, sampleCount: duration * 10,
        },
      };
      const manifestBytes = encode(manifest);
      const transcript = {
        schemaVersion: 1, kind: "paired-story-segment-transcript",
        segment: { id, title, kind: "story", startSample: 100, endSample: 100 + duration * 10 },
        audio: { path: "audio.flac", manifestPath: "manifest.json", manifestSha256: hash(manifestBytes), sha256: hash(audio),
          sampleRateHz: 10, sampleCount: duration * 10, durationSeconds: duration },
        wordCount: 3, text: text.toString().trimEnd(), elements: [],
      };
      const transcriptBytes = encode(transcript);
      const entry: VerifiedStory = {
        id, title, kind: "story", wordCount: 3, sampleCount: duration * 10, sampleRateHz: 10, durationSeconds: duration,
        durationDisplay: duration === 90 ? "00:01:30.000" : duration === 20 ? "00:00:20.000" : "00:01:01.500",
        audioPath: `segments/${id} # (audio)/audio.flac`, audioSha256: hash(audio),
        audioManifestPath: `segments/${id} # (audio)/manifest.json`, audioManifestSha256: hash(manifestBytes),
        transcriptPath: `segments/${id} # (audio)/transcript.json`, transcriptSha256: hash(transcriptBytes),
        textPath: `segments/${id} # (audio)/transcript.txt`, textSha256: hash(text),
      };
      for (const [name, bytes] of [["audio.flac", audio], ["manifest.json", manifestBytes], ["transcript.json", transcriptBytes], ["transcript.txt", text]] as const) {
        const path = join(pairDirectory, name);
        await writeFile(path, bytes);
        inputPaths.push(path);
      }
      stories.push(entry);
      sourceStories.push({ ...entry, bookId });
    }
    const inventory = {
      schemaVersion: 1, kind: "verified-story-inventory", status: "complete", bookTitle: `Collection ${index + 1}`,
      checks: { everyElementAssignedExactlyOnce: true, everySegmentAudioVerified: true, durationBasis: "verified-sample-count-divided-by-sample-rate", wordTiming: "approximate" },
      storyCount: stories.length, extraCount: 1, stories, extras: [{ id: "notes" }],
    };
    const synopses: StorySynopses = {
      schemaVersion: 1, kind: "story-synopses", bookId, spoilerPolicy: "premise-only",
      stories: stories.map((story) => ({ storyId: story.id, title: story.title, synopsis: "Someone explores [memory] | identity & <time>. A machine raises questions.", transcriptSha256: story.transcriptSha256 })),
    };
    sidecars.push(synopses);
    await writeFile(join(split, "inventory.json"), encode(inventory));
    await writeFile(join(split, "inventory.md"), "# Original inventory\n\n## Extras\n\nNotes.\n");
    await writeFile(join(bookDirectory, "synopses.json"), encode(synopses));
    inputPaths.push(join(split, "inventory.json"), join(split, "inventory.md"));
    books.push({ bookId, inventoryPath: `../books/${bookId}/split/inventory.json`, synopsisPath: `../books/${bookId}/synopses.json`, outputMarkdownPath: `../books/${bookId}/inventory.md` });
  }
  const config: StoryInventoryConfig = {
    schemaVersion: 1, books, outputMarkdownPath: "../books/inventory.md", outputJsonPath: "../books/inventory.json",
    limits: { maxBooks: 2, maxStoriesPerBook: 2, maxInventoryBytes: 65_536, maxSynopsisBytes: 65_536,
      maxTranscriptBytes: 65_536, maxAudioManifestBytes: 65_536, maxOutputBytes: 65_536 },
  };
  const configPath = join(directory, "config", "inventory.json");
  await writeFile(configPath, encode(config));
  const outputPaths = [...books.map((book) => resolve(dirname(configPath), book.outputMarkdownPath)), resolve(dirname(configPath), config.outputMarkdownPath), resolve(dirname(configPath), config.outputJsonPath)];
  return { directory, config, configPath, sidecars, sourceStories, inputPaths, outputPaths,
    synopsisPath: (bookIndex: number) => resolve(dirname(configPath), books[bookIndex]!.synopsisPath) };
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
  const originals = await capture(f.inputPaths);
  const result = await run(f.configPath);
  assert.equal(result.storyCount, 3);
  assert.equal(result.bookCount, 2);
  assert.deepEqual(result.outputPaths, f.outputPaths);
  const combined = JSON.parse(await readFile(f.outputPaths[3]!, "utf8"));
  assert.deepEqual(combined.stories.map((story: { durationSeconds: number }) => story.durationSeconds), [20, 61.5, 90]);
  for (const entry of combined.stories) {
    const source = f.sourceStories.find((story) => story.bookId === entry.bookId && story.id === entry.id)!;
    assert.equal(entry.sampleCount, source.sampleCount);
    assert.equal(entry.sampleRateHz, source.sampleRateHz);
    assert.equal(entry.durationSeconds, source.durationSeconds);
    assert.equal(entry.durationDisplay, source.durationDisplay);
    for (const [pathKey, hashKey] of [["audioPath", "audioSha256"], ["audioManifestPath", "audioManifestSha256"], ["transcriptPath", "transcriptSha256"], ["textPath", "textSha256"]]) {
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
  assert.ok(markdown.includes("%20%23%20%28audio%29"));
  await unchanged(originals);
});

test("missing, duplicate, unknown, or stale synopsis associations reject without changing any views", async (t) => {
  const f = await fixture(t);
  await run(f.configPath);
  const outputs = await capture(f.outputPaths);
  const original = f.sidecars[0]!;
  const changes = [
    { ...original, stories: original.stories.slice(1) },
    { ...original, stories: [original.stories[0]!, original.stories[0]!] },
    { ...original, stories: [{ ...original.stories[0]!, storyId: "unknown" }, original.stories[1]!] },
    { ...original, stories: [{ ...original.stories[0]!, title: "Different title" }, original.stories[1]!] },
    { ...original, stories: [{ ...original.stories[0]!, transcriptSha256: "a".repeat(64) }, original.stories[1]!] },
    { ...original, bookId: "another-book" },
  ];
  for (const change of changes) {
    await writeFile(f.synopsisPath(0), encode(change));
    await assert.rejects(run(f.configPath), hasCode("InvalidSynopses"));
    await unchanged(outputs);
  }
});

test("stale paired files and inconsistent duration evidence stop before publication", async (t) => {
  const f = await fixture(t);
  await run(f.configPath);
  const outputs = await capture(f.outputPaths);
  const entry = f.sourceStories[0]!;
  const inventoryPath = resolve(dirname(f.configPath), f.config.books[0]!.inventoryPath);
  const inventoryBytes = await readFile(inventoryPath);
  const inventory = JSON.parse(inventoryBytes.toString());
  inventory.stories[0].durationSeconds += 1;
  await writeFile(inventoryPath, encode(inventory));
  await assert.rejects(run(f.configPath), hasCode("InvalidInventory"));
  await unchanged(outputs);
  await writeFile(inventoryPath, inventoryBytes);
  const transcriptPath = resolve(dirname(inventoryPath), entry.transcriptPath);
  const transcriptBytes = await readFile(transcriptPath);
  await writeFile(transcriptPath, `${transcriptBytes.toString()} `);
  await assert.rejects(run(f.configPath), hasCode("TranscriptMismatch"));
  await unchanged(outputs);
  await writeFile(transcriptPath, transcriptBytes);
  const audioPath = resolve(dirname(inventoryPath), entry.audioPath);
  await writeFile(audioPath, "truncated");
  await assert.rejects(run(f.configPath), hasCode("ArtifactMismatch"));
  await unchanged(outputs);
});

test("output collisions, including symlinked split directories, cannot overwrite inputs or other views", async (t) => {
  const f = await fixture(t);
  await run(f.configPath);
  const outputs = await capture(f.outputPaths);
  const inputs = await capture(f.inputPaths);
  await symlink(join(f.directory, "books", "first-book", "split"), join(f.directory, "split-link"));
  for (const outputMarkdownPath of [f.config.books[0]!.inventoryPath, f.config.books[0]!.synopsisPath, f.config.outputJsonPath,
    "../books/first-book/split/new-reader-view.md", "../split-link/inventory.md"]) {
    await writeFile(f.configPath, encode({ ...f.config, outputMarkdownPath }));
    await assert.rejects(run(f.configPath), hasCode("InvalidConfig"));
    await unchanged(outputs);
    await unchanged(inputs);
  }
});

test("repeated renders and synopsis edits leave split acceptance artifacts untouched", async (t) => {
  const f = await fixture(t);
  const inputs = await capture(f.inputPaths);
  await run(f.configPath);
  const outputs = await Promise.all(f.outputPaths.map((path) => readFile(path)));
  await run(f.configPath);
  for (const [index, path] of f.outputPaths.entries()) assert.deepEqual(await readFile(path), outputs[index]);
  const original = f.sidecars[0]!;
  const synopsis = "A visitor investigates a machine that remembers everyone it meets.";
  await writeFile(f.synopsisPath(0), encode({ ...original, stories: [{ ...original.stories[0]!, synopsis }, original.stories[1]!] }));
  await run(f.configPath);
  assert.ok((await readFile(f.outputPaths[0]!, "utf8")).includes(synopsis));
  assert.ok((await readFile(f.outputPaths[2]!, "utf8")).includes(synopsis));
  assert.ok((await readFile(f.outputPaths[3]!, "utf8")).includes(synopsis));
  assert.deepEqual(await readFile(f.outputPaths[1]!), outputs[1]);
  await unchanged(inputs);
});

test("explicit read and output limits reject oversized work before any view changes", async (t) => {
  const f = await fixture(t);
  await run(f.configPath);
  const outputs = await capture(f.outputPaths);
  for (const key of ["maxSynopsisBytes", "maxTranscriptBytes", "maxAudioManifestBytes", "maxOutputBytes"] as const) {
    await writeFile(f.configPath, encode({ ...f.config, limits: { ...f.config.limits, [key]: 1 } }));
    await assert.rejects(run(f.configPath), hasCode(key === "maxOutputBytes" ? "InvalidConfig" : "IoFailed"));
    await unchanged(outputs);
  }
});
