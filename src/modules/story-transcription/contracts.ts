import { Schema } from "effect";
import { Sha256 } from "../transcription/contracts.js";
const Text = Schema.String.check(Schema.isMinLength(1));
const Sample = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const Positive = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));

/** The working story transcript. Timing overlays refer to these GPT word IDs, never Rev's book IDs. */
export const StoryTranscript = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("story-transcript"), storyId: Text,
  provider: Schema.Struct({ name: Schema.Literal("openai"), model: Text }),
  audio: Schema.Struct({ sha256: Sha256, sampleRateHz: Positive, sampleCount: Positive, sourceStartSample: Sample }),
  provenance: Schema.Struct({ runPath: Text, runSha256: Sha256, bookSourceSha256: Sha256 }),
  timing: Schema.Struct({ method: Schema.Literal("rev-seeded"), seedTranscriptSha256: Sha256 }),
  wordCount: Positive, text: Schema.String,
  elements: Schema.Array(Schema.Union([
    Schema.Struct({ kind: Schema.Literal("word"), id: Text, value: Text, startSample: Sample, endSample: Sample }),
    Schema.Struct({ kind: Schema.Literal("punctuation"), value: Schema.String }),
  ])),
});
export type StoryTranscript = typeof StoryTranscript.Type;

export function validateStoryTranscript(transcript: StoryTranscript, maxElements: number): void {
  if (transcript.elements.length > maxElements) throw new Error("Story transcript exceeds its element limit.");
  const ids = new Set<string>();
  let previous = -1;
  for (const e of transcript.elements) {
    if (e.kind !== "word") continue;
    if (!/^gpt:w\d+$/.test(e.id) || ids.has(e.id) || e.startSample < previous || e.endSample <= e.startSample || e.endSample > transcript.audio.sampleCount) {
      throw new Error(`Invalid GPT word identity or timing: ${e.id}.`);
    }
    ids.add(e.id); previous = e.startSample;
  }
  if (ids.size !== transcript.wordCount || transcript.elements.map(e => e.value).join("") !== transcript.text) throw new Error("GPT text or word count differs from its elements.");
}
