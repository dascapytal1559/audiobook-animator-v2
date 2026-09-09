import { Effect, Schema } from "effect";
import { TranscriptionError, type Punctuation } from "./contracts.js";

const Element = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("text"),
    value: Schema.String,
    ts: Schema.Finite,
    end_ts: Schema.Finite,
    confidence: Schema.optionalKey(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
  }),
  Schema.Struct({ type: Schema.Literal("punct"), value: Schema.String }),
]);
const Transcript = Schema.Struct({
  monologues: Schema.Array(Schema.Struct({
    speaker: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    elements: Schema.Array(Element),
  })),
});

export const ProviderTimedWord = Schema.Struct({
  kind: Schema.Literal("word"), id: Schema.String, speaker: Schema.Int,
  value: Schema.String, confidence: Schema.NullOr(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
  providerStartSeconds: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  providerEndSeconds: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type ProviderTimedWord = typeof ProviderTimedWord.Type;

export interface ParsedProviderTranscript {
  readonly elements: ReadonlyArray<ProviderTimedWord | Punctuation>;
  readonly text: string;
  readonly wordCount: number;
}

/** Retain punctuation as untimed evidence; never invent word times or clamp them. */
export function normalizeRevProviderTranscript(
  raw: unknown,
  durationSeconds: number,
  toleranceSeconds: number,
): Effect.Effect<ParsedProviderTranscript, TranscriptionError> {
  return Effect.gen(function* () {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) {
      return yield* Effect.fail(new TranscriptionError({ code: "InvalidConfig", message: "Timestamp validation requires a positive finite duration and a nonnegative finite tolerance." }));
    }
    const transcript = yield* Schema.decodeUnknownEffect(Transcript)(raw).pipe(
      Effect.mapError(() => new TranscriptionError({ code: "InvalidTimestamps", message: "Rev transcript contains malformed elements, missing word times, or invalid confidence values. Raw evidence is retained." })),
    );
    const elements: Array<ProviderTimedWord | Punctuation> = [];
    let wordCount = 0;
    let previousMonologueStart = -Infinity;
    for (const [monologueIndex, monologue] of transcript.monologues.entries()) {
      let previousStart = -Infinity;
      let firstWord = true;
      for (const [elementIndex, element] of monologue.elements.entries()) {
        const common = { id: `m${monologueIndex}:e${elementIndex}`, speaker: monologue.speaker, value: element.value };
        if (element.type === "punct") {
          elements.push({ ...common, kind: "punctuation" });
          continue;
        }
        if (element.ts < 0 || element.end_ts < element.ts || element.ts < previousStart
          || element.end_ts > durationSeconds + toleranceSeconds
          || (firstWord && element.ts < previousMonologueStart)) {
          return yield* Effect.fail(new TranscriptionError({ code: "InvalidTimestamps", message: `Rev word ${common.id} has reversed, unordered, negative, or out-of-input times. Raw evidence is retained.` }));
        }
        if (firstWord) previousMonologueStart = element.ts;
        firstWord = false;
        elements.push({
          ...common, kind: "word", confidence: element.confidence ?? null,
          providerStartSeconds: element.ts, providerEndSeconds: element.end_ts,
        });
        previousStart = element.ts;
        wordCount++;
      }
    }
    if (wordCount === 0) return yield* Effect.fail(new TranscriptionError({ code: "InvalidResponse", message: "The spoken-audio input returned no timed words. Raw evidence is retained." }));
    return { elements, wordCount, text: transcript.monologues.map((monologue) => monologue.elements.map((element) => element.value).join("")).join("\n") };
  });
}
