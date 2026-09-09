import { createHash } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Effect, FileSystem, Option, Schema } from "effect";
import { AudioManifest, PairedTranscript, StoryInventoryConfig, StoryInventoryError, StorySynopses, VerifiedInventory, type VerifiedStory } from "./contracts.js";

export { StoryInventoryConfig, StoryInventoryError, StorySynopses } from "./contracts.js";

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const fail = (code: StoryInventoryError["code"], message: string) => Effect.fail(new StoryInventoryError({ code, message }));
const jsonBytes = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

/** Enforce the byte limit on one handle, including files that grow while being read. */
function readBounded(path: string, limit: number) {
  return Effect.scoped(Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* fs.open(path, { flag: "r" });
    const before = yield* file.stat;
    if (before.type !== "File" || before.size > BigInt(limit)) return yield* fail("IoFailed", `Input is not a bounded regular file: ${path}.`);
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const chunk = yield* file.readAlloc(Math.min(65_536, limit - length + 1));
      if (Option.isNone(chunk)) break;
      length += chunk.value.byteLength;
      if (length > limit) return yield* fail("IoFailed", `Input exceeds its configured byte limit: ${path}.`);
      chunks.push(chunk.value);
    }
    const after = yield* file.stat;
    if (before.size !== BigInt(length) || after.size !== before.size
      || Option.getOrNull(before.mtime)?.getTime() !== Option.getOrNull(after.mtime)?.getTime()) {
      return yield* fail("IoFailed", `Input changed while being read: ${path}.`);
    }
    return Buffer.concat(chunks, length);
  })).pipe(Effect.mapError((error) => error instanceof StoryInventoryError ? error
    : new StoryInventoryError({ code: "IoFailed", message: `Cannot read input: ${path}.` })));
}

function decode<S extends Schema.Top>(schema: S, bytes: Uint8Array, code: StoryInventoryError["code"], path: string, strict: boolean) {
  return Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: () => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown,
      catch: () => new StoryInventoryError({ code, message: `Input is not valid UTF-8 JSON: ${path}.` }),
    });
    return yield* Schema.decodeUnknownEffect(schema, { onExcessProperty: strict ? "error" : "ignore" })(raw).pipe(
      Effect.mapError(() => new StoryInventoryError({ code, message: `Input does not match the required schema: ${path}.` })),
    );
  });
}

function durationDisplay(samples: number, rate: number, milliseconds: boolean): string {
  const unit = milliseconds ? 1000 : 1;
  const total = Math.round(samples / rate * unit);
  const seconds = Math.floor(total / unit);
  const clock = `${Math.floor(seconds / 3600).toString().padStart(milliseconds ? 2 : 1, "0")}:${Math.floor(seconds % 3600 / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  return milliseconds ? `${clock}.${(total % 1000).toString().padStart(3, "0")}` : clock;
}

const markdown = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replace(/[\\`*_[\]{}()#!|]/g, "\\$&").replace(/[\r\n]+/g, " ");
const pathFrom = (output: string, target: string): string => relative(dirname(output), target).split(sep).join("/");
const link = (label: string, output: string, target: string, fragment = ""): string => {
  const path = pathFrom(output, target).split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
  return `[${markdown(label)}](${path}${fragment})`;
};

interface LoadedStory extends VerifiedStory {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly synopsis: string;
}
interface LoadedBook {
  readonly bookId: string;
  readonly inventory: VerifiedInventory;
  readonly inventoryPath: string;
  readonly inventorySha256: string;
  readonly synopsisPath: string;
  readonly synopsisSha256: string;
  readonly outputMarkdownPath: string;
  readonly extrasPath: string;
  readonly stories: ReadonlyArray<LoadedStory>;
}

const sorted = (stories: ReadonlyArray<LoadedStory>): Array<LoadedStory> => [...stories].sort((a, b) =>
  a.durationSeconds - b.durationSeconds || a.bookId.localeCompare(b.bookId) || a.id.localeCompare(b.id));

function renderMarkdown(output: string, books: ReadonlyArray<LoadedBook>, combined: boolean): string {
  const stories = sorted(books.flatMap((book) => book.stories));
  const columns = combined ? "Story | Collection | Duration | Synopsis | Files" : "Story | Duration | Synopsis | Files";
  const separator = combined ? "--- | --- | ---: | --- | ---" : "--- | ---: | --- | ---";
  const rows = stories.map((story) => {
    const files = `${link("Audio", output, story.audioPath)} · ${link("Text", output, story.textPath)} · ${link("Timed JSON", output, story.transcriptPath)}`;
    return `| ${markdown(story.title)} | ${combined ? `${markdown(story.bookTitle)} | ` : ""}${durationDisplay(story.sampleCount, story.sampleRateHz, false)} | ${markdown(story.synopsis)} | ${files} |`;
  });
  const collectionLinks = combined ? `\n\nCollections: ${books.map((book) => link(book.inventory.bookTitle, output, book.outputMarkdownPath)).join(" · ")}.` : "";
  const extras = books.map((book) => link(book.inventory.bookTitle, output, book.extrasPath, "#extras")).join(" · ");
  return `# ${combined ? "Story inventory" : markdown(books[0]!.inventory.bookTitle)}\n\n${stories.length} stories, shortest first. Durations are rounded to the nearest second. Synopses describe the premise and avoid major spoilers.${collectionLinks}\n\n| ${columns} |\n| ${separator} |\n${rows.join("\n")}\n\nNotes and credits are available separately: ${extras}. Word timestamps remain approximate.\n`;
}

function requireFile(path: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const info = yield* fs.stat(path);
    if (info.type !== "File") return yield* fail("ArtifactMismatch", `Linked artifact is not a regular file: ${path}.`);
    return info;
  });
}

/** Resolve existing parent symlinks even when an output does not exist yet. */
function canonicalPath(path: string): Effect.Effect<string, import("effect/PlatformError").PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (yield* fs.exists(path)) return yield* fs.realPath(path);
    const parent = dirname(path);
    if (parent === path) return path;
    return resolve(yield* canonicalPath(parent), relative(parent, path));
  });
}

function checkOutputs(paths: ReadonlyArray<string>, inputs: ReadonlyArray<string>, splitDirectories: ReadonlyArray<string>) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const protectedPaths = new Set<string>();
    for (const path of inputs) protectedPaths.add(yield* canonicalPath(path));
    const protectedDirectories = [];
    for (const path of splitDirectories) protectedDirectories.push(yield* canonicalPath(path));
    const seen = new Set<string>();
    for (const path of paths) {
      const canonical = yield* canonicalPath(path);
      if (seen.has(canonical) || protectedPaths.has(canonical) || protectedDirectories.some((directory) => canonical === directory || canonical.startsWith(`${directory}${sep}`))) {
        return yield* fail("InvalidConfig", `Output collides with an input, a split artifact, or another output: ${path}.`);
      }
      if ((yield* fs.exists(path)) && (yield* fs.stat(path)).type !== "File") return yield* fail("InvalidConfig", `Output is not a regular file: ${path}.`);
      seen.add(canonical);
    }
  });
}

function loadBook(book: StoryInventoryConfig["books"][number], config: StoryInventoryConfig, configDirectory: string) {
  return Effect.gen(function* () {
    const inventoryPath = resolve(configDirectory, book.inventoryPath);
    const synopsisPath = resolve(configDirectory, book.synopsisPath);
    const base = dirname(inventoryPath);
    const inventoryBytes = yield* readBounded(inventoryPath, config.limits.maxInventoryBytes);
    const inventory = yield* decode(VerifiedInventory, inventoryBytes, "InvalidInventory", inventoryPath, false);
    if (inventory.storyCount !== inventory.stories.length || inventory.extraCount !== inventory.extras.length || inventory.storyCount > config.limits.maxStoriesPerBook) {
      return yield* fail("InvalidInventory", `Story or extra counts do not match the inventory or configured limit: ${inventoryPath}.`);
    }
    const synopsisBytes = yield* readBounded(synopsisPath, config.limits.maxSynopsisBytes);
    const synopses = yield* decode(StorySynopses, synopsisBytes, "InvalidSynopses", synopsisPath, true);
    if (synopses.bookId !== book.bookId || synopses.stories.length !== inventory.storyCount) return yield* fail("InvalidSynopses", `Provide exactly one synopsis for every story in ${book.bookId}.`);
    const descriptions = new Map(synopses.stories.map((story) => [story.storyId, story]));
    const ids = new Set(inventory.stories.map((story) => story.id));
    if (descriptions.size !== synopses.stories.length || ids.size !== inventory.storyCount || [...descriptions.keys()].some((id) => !ids.has(id))) {
      return yield* fail("InvalidSynopses", `Duplicate, missing, or unknown story IDs in ${book.bookId}.`);
    }
    const stories: LoadedStory[] = [];
    for (const story of inventory.stories) {
      const description = descriptions.get(story.id)!;
      if (description.title !== story.title || description.transcriptSha256 !== story.transcriptSha256) return yield* fail("InvalidSynopses", `Synopsis title or transcript hash does not match story ${story.id}.`);
      if (story.durationSeconds !== story.sampleCount / story.sampleRateHz || story.durationDisplay !== durationDisplay(story.sampleCount, story.sampleRateHz, true)) {
        return yield* fail("InvalidInventory", `Duration does not match the verified samples for ${story.id}.`);
      }
      const transcriptPath = resolve(base, story.transcriptPath);
      const audioPath = resolve(base, story.audioPath);
      const audioManifestPath = resolve(base, story.audioManifestPath);
      const textPath = resolve(base, story.textPath);
      const transcriptBytes = yield* readBounded(transcriptPath, config.limits.maxTranscriptBytes);
      if (sha256(transcriptBytes) !== story.transcriptSha256) return yield* fail("TranscriptMismatch", `Paired transcript changed for ${story.id}.`);
      const transcript = yield* decode(PairedTranscript, transcriptBytes, "TranscriptMismatch", transcriptPath, false);
      if (transcript.segment.id !== story.id || transcript.segment.title !== story.title || transcript.wordCount !== story.wordCount
        || transcript.segment.endSample - transcript.segment.startSample !== story.sampleCount
        || transcript.audio.sampleCount !== story.sampleCount || transcript.audio.sampleRateHz !== story.sampleRateHz || transcript.audio.durationSeconds !== story.durationSeconds
        || transcript.audio.sha256 !== story.audioSha256 || transcript.audio.manifestSha256 !== story.audioManifestSha256
        || resolve(dirname(transcriptPath), transcript.audio.path) !== audioPath || resolve(dirname(transcriptPath), transcript.audio.manifestPath) !== audioManifestPath) {
        return yield* fail("TranscriptMismatch", `Paired transcript identity, audio links, or sample counts do not match ${story.id}.`);
      }
      const manifestBytes = yield* readBounded(audioManifestPath, config.limits.maxAudioManifestBytes);
      if (sha256(manifestBytes) !== story.audioManifestSha256) return yield* fail("ArtifactMismatch", `Audio manifest changed for ${story.id}.`);
      const manifest = yield* decode(AudioManifest, manifestBytes, "ArtifactMismatch", audioManifestPath, false);
      const audioInfo = yield* requireFile(audioPath);
      if (manifest.output.sampleCount !== story.sampleCount || manifest.output.sampleRateHz !== story.sampleRateHz || manifest.output.sha256 !== story.audioSha256
        || audioInfo.size !== BigInt(manifest.output.byteLength) || resolve(dirname(audioManifestPath), manifest.output.filename) !== audioPath) {
        return yield* fail("ArtifactMismatch", `Audio manifest or file length does not match ${story.id}.`);
      }
      if (sha256(yield* readBounded(textPath, config.limits.maxTranscriptBytes)) !== story.textSha256) return yield* fail("ArtifactMismatch", `Plain transcript changed for ${story.id}.`);
      stories.push({ ...story, bookId: book.bookId, bookTitle: inventory.bookTitle, synopsis: description.synopsis, transcriptPath, audioPath, audioManifestPath, textPath });
    }
    const extrasPath = join(base, "inventory.md");
    yield* requireFile(extrasPath);
    return { bookId: book.bookId, inventory, inventoryPath, inventorySha256: sha256(inventoryBytes), synopsisPath, synopsisSha256: sha256(synopsisBytes),
      outputMarkdownPath: resolve(configDirectory, book.outputMarkdownPath), extrasPath, stories } satisfies LoadedBook;
  });
}

/** Replace only mutable reader views after every input and complete output has passed validation. */
export function renderStoryInventory(options: { readonly configPath: string }) {
  return Effect.scoped(Effect.gen(function* () {
    if (!options.configPath || options.configPath.includes("\0")) return yield* fail("InvalidConfig", "Supply an explicit inventory configuration path.");
    const fs = yield* FileSystem.FileSystem;
    const configPath = resolve(options.configPath);
    const configBytes = yield* readBounded(configPath, 65_536);
    const config = yield* decode(StoryInventoryConfig, configBytes, "InvalidConfig", configPath, true);
    if (config.books.length === 0 || config.books.length > config.limits.maxBooks || new Set(config.books.map((book) => book.bookId)).size !== config.books.length) {
      return yield* fail("InvalidConfig", "Supply unique books within the configured book limit.");
    }
    const books: LoadedBook[] = [];
    for (const book of config.books) books.push(yield* loadBook(book, config, dirname(configPath)));
    const outputMarkdownPath = resolve(dirname(configPath), config.outputMarkdownPath);
    const outputJsonPath = resolve(dirname(configPath), config.outputJsonPath);
    const outputPaths = [...books.map((book) => book.outputMarkdownPath), outputMarkdownPath, outputJsonPath];
    yield* checkOutputs(outputPaths, [configPath, ...books.flatMap((book) => [book.inventoryPath, book.synopsisPath, book.extrasPath,
      ...book.stories.flatMap((story) => [story.audioPath, story.audioManifestPath, story.transcriptPath, story.textPath])])], books.map((book) => dirname(book.inventoryPath)));
    const stories = sorted(books.flatMap((book) => book.stories));
    const combined = {
      schemaVersion: 1, kind: "story-selection-inventory", spoilerPolicy: "premise-only", storyCount: stories.length,
      books: books.map((book) => ({ bookId: book.bookId, bookTitle: book.inventory.bookTitle, storyCount: book.inventory.storyCount, extraCount: book.inventory.extraCount,
        splitInventoryPath: pathFrom(outputJsonPath, book.inventoryPath), splitInventorySha256: book.inventorySha256,
        synopsisPath: pathFrom(outputJsonPath, book.synopsisPath), synopsisSha256: book.synopsisSha256,
        inventoryMarkdownPath: pathFrom(outputJsonPath, book.outputMarkdownPath), extrasInventoryPath: pathFrom(outputJsonPath, book.extrasPath) })),
      stories: stories.map((story) => ({ ...story, audioPath: pathFrom(outputJsonPath, story.audioPath), audioManifestPath: pathFrom(outputJsonPath, story.audioManifestPath),
        transcriptPath: pathFrom(outputJsonPath, story.transcriptPath), textPath: pathFrom(outputJsonPath, story.textPath) })),
    };
    const outputs = [
      ...books.map((book) => ({ path: book.outputMarkdownPath, bytes: Buffer.from(renderMarkdown(book.outputMarkdownPath, [book], false)) })),
      { path: outputMarkdownPath, bytes: Buffer.from(renderMarkdown(outputMarkdownPath, books, true)) },
      { path: outputJsonPath, bytes: jsonBytes(combined) },
    ];
    if (outputs.some((output) => output.bytes.byteLength > config.limits.maxOutputBytes)) return yield* fail("InvalidConfig", "A generated inventory exceeds the configured output byte limit.");
    const staged = [];
    for (const output of outputs) {
      yield* fs.makeDirectory(dirname(output.path), { recursive: true });
      const temporary = yield* fs.makeTempDirectoryScoped({ directory: dirname(output.path), prefix: ".story-inventory-" });
      const path = join(temporary, "view");
      yield* Effect.scoped(Effect.gen(function* () {
        const file = yield* fs.open(path, { flag: "wx", mode: 0o644 });
        yield* file.writeAll(output.bytes);
        yield* file.sync;
      }));
      staged.push({ path, destination: output.path });
    }
    // Every file is complete before any view changes; each rename is atomic on its filesystem.
    for (const output of staged) yield* fs.rename(output.path, output.destination);
    return { bookCount: books.length, storyCount: stories.length, outputPaths };
  })).pipe(Effect.mapError((error) => error instanceof StoryInventoryError ? error
    : new StoryInventoryError({ code: "IoFailed", message: "Cannot read or publish the story inventory files." })));
}
