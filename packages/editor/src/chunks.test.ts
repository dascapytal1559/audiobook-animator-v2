import { test } from "node:test";
import assert from "node:assert/strict";
import type { Chunk, StoryResponse } from "./api.js";
import { computeChunks, referenceChunks, retimeChunks, sentenceEndIds, type ChunkWord } from "./chunks.js";

const words: ChunkWord[] = [
  { id: "w1", value: "The", startSample: 1000, endSample: 2000 },
  { id: "w2", value: "great", startSample: 2100, endSample: 3000 },
  { id: "w3", value: "silence", startSample: 3100, endSample: 4000 },
  { id: "w4", value: "The", startSample: 4100, endSample: 5000 },
  { id: "w5", value: "humans", startSample: 40000, endSample: 41000 },
  { id: "w6", value: "use", startSample: 41100, endSample: 42000 },
];

test("chunks break on sentence ends, then on pauses of at least the threshold, then at the end", () => {
  const chunks = computeChunks(words, new Set(["w3"]), 28800, 0);
  assert.deepEqual(chunks.map(c => [c.id, c.breakReason, c.text, c.startSample, c.endSample, c.wordIds]), [
    ["c0", "sentence", "The great silence", 1000, 4000, ["w1", "w2", "w3"]],
    ["c1", "pause", "The", 4100, 5000, ["w4"]],
    ["c2", "end", "humans use", 40000, 42000, ["w5", "w6"]],
  ]);
  assert.equal(computeChunks(words, new Set(), 100000, 0).length, 1, "no sentence ends and no long pause: one chunk");
  assert.equal(computeChunks([], new Set(), 1, 0).length, 0);
  assert.throws(() => computeChunks(words, new Set(), 0, 0), RangeError);
  assert.throws(() => computeChunks(words, new Set(), 1, -1), RangeError);
  assert.throws(() => computeChunks(words, new Set(), 1, 1.5), RangeError);
});

test("a sentence end on the last word does not produce an empty trailing chunk", () => {
  const chunks = computeChunks(words.slice(0, 3), new Set(["w3"]), 28800, 0);
  assert.deepEqual(chunks.map(c => c.breakReason), ["end"]);
});

test("sentence ends are read off the server's chunks and survive re-timing", () => {
  const server: Chunk[] = [
    { id: "c0", startSample: 0, endSample: 1, text: "The great silence.", wordIds: ["w1", "w2", "w3"], breakReason: "sentence" },
    { id: "c1", startSample: 0, endSample: 1, text: "The", wordIds: ["w4"], breakReason: "pause" },
    { id: "c2", startSample: 0, endSample: 1, text: "humans use", wordIds: ["w5", "w6"], breakReason: "end" },
  ];
  assert.deepEqual([...sentenceEndIds(server)], ["w3"]);
  const retimed = retimeChunks(server, words);
  assert.deepEqual(retimed.map(c => [c.startSample, c.endSample, c.text]), [[1000, 4000, "The great silence."], [4100, 5000, "The"], [40000, 42000, "humans use"]]);
});

const clip: StoryResponse["clip"] = { bookId: "b", storyId: "s", audioSha256: "a".repeat(64), transcriptSha256: "b".repeat(64), sampleRateHz: 48000, sampleCount: 96000 };

test("reference rows use the server's configured pause and sample rate instead of a fixed 600 ms", () => {
  const row = [
    { id: "w1", value: "we", startSample: 0, endSample: 4800 },
    { id: "w2", value: "listen", startSample: 24000, endSample: 28800 },
  ]; // 400 ms gap, as in the mock server.
  const server: Pick<StoryResponse, "clip" | "chunks" | "chunking"> = {
    clip, chunking: { pauseBreakMs: 300, minSentenceBreakMs: 150, mergedSentenceBreaks: [] }, chunks: [
      { id: "c0", startSample: 0, endSample: 4800, text: "we", wordIds: ["w1"], breakReason: "pause" },
      { id: "c1", startSample: 24000, endSample: 28800, text: "listen", wordIds: ["w2"], breakReason: "end" },
    ],
  };
  const grouping = (chunks: ReadonlyArray<Chunk>) => chunks.map(c => [c.wordIds, c.breakReason]);
  assert.deepEqual(grouping(referenceChunks(row, server)), grouping(server.chunks), "matching timing layers have the same grouping");
  assert.equal(referenceChunks(row, { ...server, chunking: { ...server.chunking, pauseBreakMs: 500 } }).length, 1, "a changed server setting changes reference grouping");
  assert.equal(referenceChunks(row, { ...server, clip: { ...clip, sampleRateHz: 96000 } }).length, 1, "the same samples at twice the rate make a 200 ms gap");
});

test("reference rows apply the configured sentence gap to kept and merged sentence marks using their own times", () => {
  const row = [
    { id: "w1", value: "Listen", startSample: 0, endSample: 4800 },
    { id: "w2", value: "Look", startSample: 14400, endSample: 19200 },
  ]; // 200 ms gap in this reference row; the effective layer merged the same sentence mark at 50 ms.
  const server: Pick<StoryResponse, "clip" | "chunks" | "chunking"> = {
    clip,
    chunks: [{ id: "c0", startSample: 0, endSample: 12000, text: "Listen. Look.", wordIds: ["w1", "w2"], breakReason: "end" }],
    chunking: { pauseBreakMs: 600, minSentenceBreakMs: 200, mergedSentenceBreaks: [{ afterWordId: "w1", nextWordId: "w2", gapSamples: 2400, gapMs: 50, text: "Listen. Look" }] },
  };
  assert.deepEqual(referenceChunks(row, server).map(c => c.breakReason), ["sentence", "end"], "a merged mark still exists and a reference gap exactly at the threshold qualifies");
  const stricter = { ...server, chunking: { ...server.chunking, minSentenceBreakMs: 201 } };
  assert.equal(referenceChunks(row, stricter).length, 1, "the sentence stays merged below the configured minimum");
  const kept = { ...stricter, chunks: [...referenceChunks(row, server)], chunking: { ...stricter.chunking, mergedSentenceBreaks: [] } };
  assert.equal(referenceChunks(row, kept).length, 1, "a kept sentence mark must also satisfy this row's gap threshold");
});
