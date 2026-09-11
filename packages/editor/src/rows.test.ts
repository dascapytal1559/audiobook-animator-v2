import { test } from "node:test";
import assert from "node:assert/strict";
import type { StoryResponse } from "./api.js";
import { referenceChunks, type RowWord } from "./rows.js";

const clip: StoryResponse["clip"] = { bookId: "b", storyId: "s", audioSha256: "a".repeat(64), transcriptSha256: "b".repeat(64), sampleRateHz: 48000, sampleCount: 96000 };
const story = (pauseBreakMs: number, minSentenceBreakMs: number): Pick<StoryResponse, "clip" | "elements" | "chunking"> => ({
  clip, chunking: { pauseBreakMs, minSentenceBreakMs, mergedSentenceBreaks: [] },
  elements: [{ kind: "word", id: "w1" }, { kind: "punctuation", value: "." }, { kind: "punctuation", value: " " }, { kind: "word", id: "w2" }, { kind: "punctuation", value: " " }, { kind: "word", id: "w3" }, { kind: "punctuation", value: "." }],
});
const row: RowWord[] = [
  { id: "w1", value: "Listen", startSample: 0, endSample: 4800 },
  { id: "w2", value: "we", startSample: 14400, endSample: 19200 },
  { id: "w3", value: "wait", startSample: 43200, endSample: 48000 }, // 500 ms after w2
];

test("a reference row is chunked by the server's rule on its own times: sentence marks, then pauses, then the end, with punctuation in the text", () => {
  assert.deepEqual(referenceChunks(row, story(300, 0)).map(c => [c.text, c.breakReason, c.wordIds]), [["Listen.", "sentence", ["w1"]], ["we", "pause", ["w2"]], ["wait.", "end", ["w3"]]]);
  assert.deepEqual(referenceChunks(row, story(600, 0)).map(c => c.breakReason), ["sentence", "end"], "a longer pause setting keeps we and wait together");
  assert.deepEqual(referenceChunks(row, story(600, 250)).map(c => c.breakReason), ["end"], "a 200 ms gap behind the period is under the sentence threshold, so the mark is ignored");
});

test("words the row lacks are skipped with the punctuation that follows them", () => {
  const partial = row.filter(w => w.id !== "w1");
  assert.deepEqual(referenceChunks(partial, story(300, 0)).map(c => [c.text, c.wordIds]), [["we", ["w2"]], ["wait.", ["w3"]]]);
});
