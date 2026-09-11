/**
 * A run: the settings a tool actually uses. Defaults live in each module; an optional run file overrides any of them; the merged, validated
 * result is what the tool works with and what its outputs record. No settings file is read unless a run names one.
 */
import { dirname, resolve } from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { AnimatorError } from "./core/error.js";
import { errorsOf } from "./core/error.js";
import { Path } from "@animator/domain";
import { decodeJson, readBounded } from "./core/io.js";
import { EditorSettings, editorDefaults } from "./modules/editor-server/index.js";
import { StoryInventorySettings, storyInventoryDefaults } from "./modules/story-inventory/index.js";
import { TranscriptionSettings, transcriptionDefaults } from "./modules/story-transcription/contracts.js";
import { DEFAULT_BOOKS_DIRECTORY, DEFAULT_STORIES_DIRECTORY, requireStory, StorySettings, storyDefaults } from "./modules/story/index.js";
import { VisualTimelineSettings, visualTimelineDefaults } from "./modules/visual-timeline/index.js";

export const RunSettings = Schema.Struct({
  storiesDirectory: Path, booksDirectory: Path,
  story: StorySettings, timeline: VisualTimelineSettings, editor: EditorSettings, inventory: StoryInventorySettings, transcription: TranscriptionSettings,
});
export type RunSettings = typeof RunSettings.Type;
export const runDefaults: RunSettings = {
  storiesDirectory: DEFAULT_STORIES_DIRECTORY, booksDirectory: DEFAULT_BOOKS_DIRECTORY,
  story: storyDefaults, timeline: visualTimelineDefaults, editor: editorDefaults, inventory: storyInventoryDefaults, transcription: transcriptionDefaults,
};
export type RunCode = "InvalidRun" | "IoFailed";
const errors = errorsOf<"run", RunCode>("run");
/** A run failure: the shared AnimatorError with this module's code union. */
export const runError = errors.make;
export const isRunError = errors.is;
const MAX_RUN_BYTES = 1_048_576;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Objects merge key by key; anything else in the override replaces the default. Keys the defaults do not have are kept so strict decoding can reject them by name. */
function deepMerge(defaults: unknown, override: unknown): unknown {
  if (!isObject(defaults) || !isObject(override)) return override;
  const merged: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(override)) merged[key] = deepMerge(defaults[key], value);
  return merged;
}

/** The defaults, or the defaults with the run file's values laid over them and the whole checked strictly. Directory paths in a run file resolve from the file. */
export function loadRun(runPath: string | undefined): Effect.Effect<RunSettings, AnimatorError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    if (runPath === undefined) return runDefaults;
    if (runPath === "" || runPath.includes("\0")) return yield* Effect.fail(runError({ code: "InvalidRun", message: "A run file path must be a non-empty path." }));
    const path = resolve(runPath);
    const bytes = yield* readBounded(path, MAX_RUN_BYTES).pipe(Effect.mapError(e => runError({ code: "IoFailed", message: e.message })));
    const raw = yield* Effect.try({ try: () => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown, catch: () => runError({ code: "InvalidRun", message: `Run file is not valid UTF-8 JSON: ${path}.` }) });
    if (!isObject(raw)) return yield* Effect.fail(runError({ code: "InvalidRun", message: `Run file must be a JSON object: ${path}.` }));
    const merged = yield* decodeJson(RunSettings, Buffer.from(JSON.stringify(deepMerge(runDefaults, raw))), path, true).pipe(Effect.mapError(e => runError({ code: "InvalidRun", message: e.message })));
    const from = dirname(path);
    return { ...merged,
      storiesDirectory: "storiesDirectory" in raw ? resolve(from, merged.storiesDirectory) : merged.storiesDirectory,
      booksDirectory: "booksDirectory" in raw ? resolve(from, merged.booksDirectory) : merged.booksDirectory };
  });
}

/** The story directory a run and a `--story` id name, or NotFound listing what is there. */
export const selectStory = (run: RunSettings, storyId: string | undefined) => requireStory(run.storiesDirectory, storyId);
