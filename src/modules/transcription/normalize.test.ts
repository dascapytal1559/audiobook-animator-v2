import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { normalizeRevProviderTranscript, TranscriptionError } from "./index.js";

const transcript = { monologues: [{ speaker: 0, elements: [
  { type: "text", value: "Hello", ts: 0.75, end_ts: 1.1, confidence: 0.98 },
  { type: "punct", value: " " },
  { type: "text", value: "world", ts: 1.2, end_ts: 1.7 },
  { type: "punct", value: "." },
] }] };

test("Rev normalization preserves provider times, confidence, element IDs, and untimed punctuation", async () => {
  const result = await Effect.runPromise(normalizeRevProviderTranscript(transcript, 120, 0.1));
  assert.deepEqual(result, {
    text: "Hello world.", wordCount: 2,
    elements: [
      { kind: "word", id: "m0:e0", speaker: 0, value: "Hello", confidence: 0.98, providerStartSeconds: 0.75, providerEndSeconds: 1.1 },
      { kind: "punctuation", id: "m0:e1", speaker: 0, value: " " },
      { kind: "word", id: "m0:e2", speaker: 0, value: "world", confidence: null, providerStartSeconds: 1.2, providerEndSeconds: 1.7 },
      { kind: "punctuation", id: "m0:e3", speaker: 0, value: "." },
    ],
  });
});

test("missing, negative, reversed, nonfinite, out-of-range, and unordered provider word times fail", async () => {
  const invalid = (error: unknown): boolean => error instanceof TranscriptionError && error.code === "InvalidTimestamps";
  for (const times of [{}, { ts: -1, end_ts: 0 }, { ts: 2, end_ts: 1 }, { ts: NaN, end_ts: 1 }, { ts: 119, end_ts: 121 }]) {
    const malformed = { monologues: [{ speaker: 0, elements: [{ type: "text", value: "bad", ...times }] }] };
    await assert.rejects(Effect.runPromise(normalizeRevProviderTranscript(malformed, 120, 0.1)), invalid);
  }
  const unordered = { monologues: [{ speaker: 0, elements: [
    { type: "text", value: "first", ts: 2, end_ts: 3 },
    { type: "text", value: "second", ts: 1, end_ts: 1.5 },
  ] }] };
  await assert.rejects(Effect.runPromise(normalizeRevProviderTranscript(unordered, 120, 0.1)), invalid);
});
