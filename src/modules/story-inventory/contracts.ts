import { Schema } from "effect";
import { errorsOf } from "../../core/error.js";
import { Positive } from "@animator/domain";

/** Settings for publishing the reading views: count and byte ceilings. Defaults live in code; a run file may override any of them. Where the stories and books live is the run's `storiesDirectory` and `booksDirectory`. */
export const StoryInventorySettings = Schema.Struct({
  limits: Schema.Struct({ maxBooks: Positive, maxStories: Positive, maxManifestBytes: Positive, maxTranscriptBytes: Positive, maxAudioManifestBytes: Positive, maxOutputBytes: Positive }),
});
export type StoryInventorySettings = typeof StoryInventorySettings.Type;
export const storyInventoryDefaults: StoryInventorySettings = { limits: { maxBooks: 16, maxStories: 512, maxManifestBytes: 65_536, maxTranscriptBytes: 134_217_728, maxAudioManifestBytes: 1_048_576, maxOutputBytes: 4_194_304 } };

export type InventoryCode = "InvalidConfig" | "InvalidManifest" | "TranscriptMismatch" | "ArtifactMismatch" | "IoFailed";
const errors = errorsOf<"inventory", InventoryCode>("inventory");
/** A inventory failure: the shared AnimatorError with this module's code union. */
export const inventoryError = errors.make;
export const isInventoryError = errors.is;
