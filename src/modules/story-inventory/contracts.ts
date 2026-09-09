import { Data, Schema } from "effect";

const Text = Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/\S/));
const Path = Text.check(Schema.isPattern(/^[^\0]+$/));
const Id = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,100}$/));
const PositiveInteger = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));

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
    maxBooks: PositiveInteger,
    maxStories: PositiveInteger,
    maxManifestBytes: PositiveInteger,
    maxTranscriptBytes: PositiveInteger,
    maxAudioManifestBytes: PositiveInteger,
    maxOutputBytes: PositiveInteger,
  }),
});
export type StoryInventoryConfig = typeof StoryInventoryConfig.Type;

export class StoryInventoryError extends Data.TaggedError("StoryInventoryError")<{
  readonly code: "InvalidConfig" | "InvalidManifest" | "TranscriptMismatch" | "ArtifactMismatch" | "IoFailed";
  readonly message: string;
}> {}
