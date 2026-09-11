import { dirname, join, relative, resolve, sep } from "node:path";
import { Effect, FileSystem } from "effect";
import { durationDisplay, type LoadedStoryManifest, loadStoryManifest, StoryError } from "../story/index.js";
import { type StoryInventorySettings, StoryInventoryError, storyInventoryDefaults } from "./contracts.js";

export { StoryInventoryError, StoryInventorySettings, storyInventoryDefaults } from "./contracts.js";

const fail = (code: StoryInventoryError["code"], message: string) => Effect.fail(new StoryInventoryError({ code, message }));
/** story's reader and manifest loader use the same code names; only the error type changes. */
const own = <A, R>(effect: Effect.Effect<A, StoryError, R>) => effect.pipe(Effect.mapError(e => new StoryInventoryError({ code: e.code === "NotFound" ? "InvalidManifest" : e.code, message: e.message })));
const jsonBytes = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

const markdown = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replace(/[\\`*_[\]{}()#!|]/g, "\\$&").replace(/[\r\n]+/g, " ");
const pathFrom = (output: string, target: string): string => relative(dirname(output), target).split(sep).join("/");
const link = (label: string, output: string, target: string, fragment = ""): string => {
  const path = pathFrom(output, target).split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
  return `[${markdown(label)}](${path}${fragment})`;
};

type LoadedStory = LoadedStoryManifest;
interface LoadedBook {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly extrasPath: string;
  readonly outputMarkdownPath: string;
  readonly stories: ReadonlyArray<LoadedStory>;
}

const sorted = (stories: ReadonlyArray<LoadedStory>): Array<LoadedStory> => [...stories].sort((a, b) =>
  a.manifest.durationSeconds - b.manifest.durationSeconds || a.manifest.book.id.localeCompare(b.manifest.book.id) || a.manifest.id.localeCompare(b.manifest.id));

function renderMarkdown(output: string, books: ReadonlyArray<LoadedBook>, combined: boolean): string {
  const stories = sorted(books.flatMap((book) => book.stories));
  const columns = combined ? "Story | Collection | Duration | Synopsis | Files" : "Story | Duration | Synopsis | Files";
  const separator = combined ? "--- | --- | ---: | --- | ---" : "--- | ---: | --- | ---";
  const rows = stories.map(({ manifest, paths }) => {
    const files = `${link("Audio", output, paths.audioPath)} · ${link(manifest.transcriptProvider === "openai" ? "GPT text" : "Rev split text", output, paths.textPath)} · ${link("Timed JSON", output, paths.transcriptPath)}`;
    return `| ${markdown(manifest.title)} | ${combined ? `${markdown(manifest.book.title)} | ` : ""}${durationDisplay(manifest.sampleCount, manifest.sampleRateHz, false)} | ${markdown(manifest.synopsis)} | ${files} |`;
  });
  const collectionLinks = combined ? `\n\nCollections: ${books.map((book) => link(book.bookTitle, output, book.outputMarkdownPath)).join(" · ")}.` : "";
  const extras = books.map((book) => link(book.bookTitle, output, book.extrasPath, "#extras")).join(" · ");
  return `# ${combined ? "Story inventory" : markdown(books[0]!.bookTitle)}\n\n${stories.length} stories, shortest first. Durations are rounded to the nearest second. Synopses describe the premise and avoid major spoilers.${collectionLinks}\n\n| ${columns} |\n| ${separator} |\n${rows.join("\n")}\n\nNotes and credits are available separately: ${extras}. Word timestamps remain approximate.\n`;
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

function checkOutputs(paths: ReadonlyArray<string>, inputs: ReadonlyArray<string>, storyDirectories: ReadonlyArray<string>) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const protectedPaths = new Set<string>();
    for (const path of inputs) protectedPaths.add(yield* canonicalPath(path));
    const protectedDirectories = [];
    for (const path of storyDirectories) protectedDirectories.push(yield* canonicalPath(path));
    const seen = new Set<string>();
    for (const path of paths) {
      const canonical = yield* canonicalPath(path);
      if (seen.has(canonical) || protectedPaths.has(canonical) || protectedDirectories.some((directory) => canonical === directory || canonical.startsWith(`${directory}${sep}`))) {
        return yield* fail("InvalidConfig", `Output collides with an input, a story directory, or another output: ${path}.`);
      }
      if ((yield* fs.exists(path)) && (yield* fs.stat(path)).type !== "File") return yield* fail("InvalidConfig", `Output is not a regular file: ${path}.`);
      seen.add(canonical);
    }
  });
}

/** Every directory under the stories directory, each verified through its manifest. Files beside the story directories (the published views) are not stories. */
function loadStories(storiesDirectory: string, config: StoryInventorySettings) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const entries = (yield* fs.readDirectory(storiesDirectory)).filter((name) => !name.startsWith(".")).sort();
    const stories: LoadedStory[] = [];
    for (const name of entries) {
      const storyDirectory = join(storiesDirectory, name);
      if ((yield* fs.stat(storyDirectory)).type !== "Directory") continue;
      if (!(yield* fs.exists(join(storyDirectory, "story.json")))) return yield* fail("InvalidManifest", `Story directory has no story.json: ${storyDirectory}.`);
      stories.push(yield* own(loadStoryManifest({ storyDirectory, limits: config.limits })));
    }
    if (stories.length === 0) return yield* fail("InvalidConfig", `No story directories under ${storiesDirectory}.`);
    if (stories.length > config.limits.maxStories) return yield* fail("InvalidConfig", `${stories.length} stories exceed the configured limit of ${config.limits.maxStories}.`);
    return stories;
  });
}

/**
 * Replace only mutable reader views after every input and complete output has passed validation. Books are discovered from the story
 * manifests; each book must have its extras inventory at `<booksDirectory>/<bookId>/split/inventory.md`. Outputs are fixed by layout:
 * `<booksDirectory>/<bookId>/inventory.md` per book, `inventory.md` and `inventory.json` beside the stories.
 */
export function renderStoryInventory(options: { readonly storiesDirectory: string; readonly booksDirectory: string; readonly settings?: StoryInventorySettings }) {
  return Effect.scoped(Effect.gen(function* () {
    const config = options.settings ?? storyInventoryDefaults;
    if (!options.storiesDirectory || !options.booksDirectory || options.storiesDirectory.includes("\0") || options.booksDirectory.includes("\0")) return yield* fail("InvalidConfig", "Supply the stories and books directories.");
    const fs = yield* FileSystem.FileSystem;
    const storiesDirectory = resolve(options.storiesDirectory);
    const booksDirectory = resolve(options.booksDirectory);
    const stories = yield* loadStories(storiesDirectory, config);
    const bookIds = [...new Set(stories.map((story) => story.manifest.book.id))].sort();
    if (bookIds.length > config.limits.maxBooks) return yield* fail("InvalidConfig", `${bookIds.length} books exceed the configured limit of ${config.limits.maxBooks}.`);
    const books: LoadedBook[] = [];
    for (const bookId of bookIds) {
      const own = stories.filter((story) => story.manifest.book.id === bookId);
      const titles = new Set(own.map((story) => story.manifest.book.title));
      if (titles.size !== 1) return yield* fail("InvalidManifest", `Stories of book ${bookId} disagree on its title: ${[...titles].join(" / ")}.`);
      const extrasPath = join(booksDirectory, bookId, "split", "inventory.md");
      if (!(yield* fs.exists(extrasPath))) return yield* fail("InvalidConfig", `Book ${bookId} has no extras inventory at ${extrasPath}.`);
      yield* requireFile(extrasPath);
      books.push({ bookId, bookTitle: own[0]!.manifest.book.title, extrasPath, outputMarkdownPath: join(booksDirectory, bookId, "inventory.md"), stories: own });
    }
    const outputMarkdownPath = join(storiesDirectory, "inventory.md");
    const outputJsonPath = join(storiesDirectory, "inventory.json");
    const outputPaths = [...books.map((book) => book.outputMarkdownPath), outputMarkdownPath, outputJsonPath];
    yield* checkOutputs(outputPaths, books.map((book) => book.extrasPath), stories.map((story) => story.storyDirectory));
    const ordered = sorted(stories);
    const combined = {
      schemaVersion: 1, kind: "story-selection-inventory", spoilerPolicy: "premise-only", storyCount: ordered.length, storiesDirectory: pathFrom(outputJsonPath, storiesDirectory),
      booksDirectory: pathFrom(outputJsonPath, booksDirectory), settings: config,
      books: books.map((book) => ({ bookId: book.bookId, bookTitle: book.bookTitle, storyCount: book.stories.length,
        extrasInventoryPath: pathFrom(outputJsonPath, book.extrasPath), inventoryMarkdownPath: pathFrom(outputJsonPath, book.outputMarkdownPath) })),
      stories: ordered.map(({ manifest, manifestSha256, storyDirectory, paths }) => ({
        id: manifest.id, title: manifest.title, bookId: manifest.book.id, bookTitle: manifest.book.title, synopsis: manifest.synopsis,
        wordCount: manifest.wordCount, sampleCount: manifest.sampleCount, sampleRateHz: manifest.sampleRateHz, durationSeconds: manifest.durationSeconds, durationDisplay: manifest.durationDisplay,
        storyDirectory: pathFrom(outputJsonPath, storyDirectory), manifestPath: pathFrom(outputJsonPath, paths.manifestPath), manifestSha256,
        audioPath: pathFrom(outputJsonPath, paths.audioPath), audioSha256: manifest.audioSha256, audioManifestPath: pathFrom(outputJsonPath, paths.audioManifestPath), audioManifestSha256: manifest.audioManifestSha256,
        transcriptProvider: manifest.transcriptProvider, transcriptPath: pathFrom(outputJsonPath, paths.transcriptPath), transcriptSha256: manifest.transcriptSha256, textPath: pathFrom(outputJsonPath, paths.textPath), textSha256: manifest.textSha256 })),
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
    return { bookCount: books.length, storyCount: ordered.length, outputPaths };
  })).pipe(Effect.mapError((error) => error instanceof StoryInventoryError ? error
    : new StoryInventoryError({ code: "IoFailed", message: "Cannot read or publish the story inventory files." })));
}
