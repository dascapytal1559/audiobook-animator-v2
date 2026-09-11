import { Data, Schema } from "effect";
import { Id, Path, Positive } from "../../core/schema.js";


/**
 * `config/story-inventory.json`. Every directory under `storiesDirectory` is a story with a `story.json`; each story's book must be listed
 * here with the book's extras inventory (notes and credits stay with the book) and the per-book reading view to write. Paths resolve from
 * the config file.
 */
export const StoryInventoryConfig = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  storiesDirectory: Path,
  books: Schema.Array(Schema.Struct({ bookId: Id, extrasInventoryPath: Path, outputMarkdownPath: Path })),
  outputMarkdownPath: Path,
  outputJsonPath: Path,
  limits: Schema.Struct({
    maxBooks: Positive,
    maxStories: Positive,
    maxManifestBytes: Positive,
    maxTranscriptBytes: Positive,
    maxAudioManifestBytes: Positive,
    maxOutputBytes: Positive,
  }),
});
export type StoryInventoryConfig = typeof StoryInventoryConfig.Type;

export class StoryInventoryError extends Data.TaggedError("StoryInventoryError")<{
  readonly code: "InvalidConfig" | "InvalidManifest" | "TranscriptMismatch" | "ArtifactMismatch" | "IoFailed";
  readonly message: string;
}> {}
