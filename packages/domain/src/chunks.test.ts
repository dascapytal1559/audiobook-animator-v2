import assert from "node:assert/strict";
import test from "node:test";
import { computeChunks, listSentenceBreaks, retimeChunks, type ChunkElement } from "./chunks.js";

const word = (id: string, value: string, startSample: number, endSample: number): ChunkElement => ({ kind: "word", id, value, startSample, endSample });
const punctuation = (value: string): ChunkElement => ({ kind: "punctuation", value });
const summary = (chunks: ReturnType<typeof computeChunks>) => chunks.map(c => [c.id, c.text, c.breakReason, c.startSample, c.endSample, [...c.wordIds]]);

test("a period or question mark before the next word ends the chunk; the text keeps the trailing punctuation", () => {
  const chunks = computeChunks([
    word("w0", "The", 0, 10), punctuation(" "), word("w1", "great", 11, 20), punctuation(" "), word("w2", "silence", 21, 30), punctuation("."), punctuation(" "),
    word("w3", "Why", 31, 40), punctuation("?"), punctuation(" "), word("w4", "Because", 41, 50), punctuation("."),
  ], 1000);
  assert.deepEqual(summary(chunks), [
    ["c0", "The great silence.", "sentence", 0, 30, ["w0", "w1", "w2"]],
    ["c1", "Why?", "sentence", 31, 40, ["w3"]],
    ["c2", "Because.", "end", 41, 50, ["w4"]],
  ]);
});

test("a pause at least the threshold ends the chunk, a shorter pause does not, and a comma never does", () => {
  const chunks = computeChunks([
    word("w0", "One", 0, 10), punctuation(","), punctuation(" "), word("w1", "two", 15, 20), punctuation(" "),
    word("w2", "three", 120, 130), punctuation(" "), word("w3", "four", 229, 240), punctuation(" "), word("w4", "five", 340, 350),
  ], 100);
  assert.deepEqual(summary(chunks), [
    ["c0", "One, two", "pause", 0, 20, ["w0", "w1"]],
    ["c1", "three four", "pause", 120, 240, ["w2", "w3"]],
    ["c2", "five", "end", 340, 350, ["w4"]],
  ]);
  // Gaps: two→three is 100 (breaks), three→four is 99 (joins), four→five is 100 (breaks); the comma stays in the text and never breaks.
});

test("a pause exactly at the threshold breaks", () => {
  const chunks = computeChunks([word("a", "a", 0, 100), punctuation(" "), word("b", "b", 200, 300)], 100);
  assert.deepEqual(chunks.map(c => [c.text, c.breakReason]), [["a", "pause"], ["b", "end"]]);
});

test("sentence punctuation wins over a long pause after the same word, and the last chunk is always an end break", () => {
  const chunks = computeChunks([word("a", "Stop", 0, 10), punctuation("."), punctuation(" "), word("b", "Go", 5000, 5010), punctuation(".")], 100);
  assert.deepEqual(chunks.map(c => [c.text, c.breakReason]), [["Stop.", "sentence"], ["Go.", "end"]]);
});

test("a single-word transcript is one end chunk with its trailing punctuation and no leading whitespace", () => {
  const chunks = computeChunks([punctuation(" "), word("m2:e0", "Uncorrected", 13, 23), punctuation(". ")], 6);
  assert.deepEqual(summary(chunks), [["c0", "Uncorrected.", "end", 13, 23, ["m2:e0"]]]);
  assert.deepEqual(computeChunks([], 6), []);
  assert.deepEqual(computeChunks([punctuation(".")], 6), []);
});

test("every word lands in exactly one chunk, in order", () => {
  const elements: ChunkElement[] = [];
  for (let i = 0; i < 50; i++) {
    elements.push(word(`w${i}`, `w${i}`, i * 100, i * 100 + 40));
    elements.push(punctuation(i % 7 === 6 ? "." : i % 5 === 4 ? "?" : " "));
  }
  const chunks = computeChunks(elements, 61);
  assert.deepEqual(chunks.flatMap(c => [...c.wordIds]), elements.flatMap(e => e.kind === "word" ? [e.id] : []));
  assert.ok(chunks.every(c => c.wordIds.length >= 1 && c.startSample <= c.endSample));
  assert.throws(() => computeChunks(elements, 0), RangeError);
  assert.throws(() => computeChunks(elements, 1.5), RangeError);
});

test("a sentence mark with an inaudible gap does not end the chunk; at the threshold it does; a zero threshold keeps every mark", () => {
  const elements: ChunkElement[] = [
    word("w0", "lost", 0, 100), punctuation("."), punctuation(" "), word("w1", "As", 150, 200), punctuation(" "), word("w2", "my", 200, 250), punctuation("."), punctuation(" "),
    word("w3", "Next", 449, 500), punctuation("."),
  ];
  const merged = computeChunks(elements, 10_000, 200);
  assert.deepEqual(summary(merged), [["c0", "lost. As my. Next.", "end", 0, 500, ["w0", "w1", "w2", "w3"]]]);
  const kept = computeChunks(elements, 10_000, 199);
  assert.deepEqual(kept.map(c => [c.text, c.breakReason]), [["lost. As my.", "sentence"], ["Next.", "end"]]);
  assert.deepEqual(computeChunks(elements, 10_000, 0).map(c => c.text), ["lost.", "As my.", "Next."]);
  assert.deepEqual(computeChunks(elements, 10_000).map(c => c.text), ["lost.", "As my.", "Next."]);
  assert.deepEqual(listSentenceBreaks(elements), [
    { afterWordId: "w0", nextWordId: "w1", gapSamples: 50, text: "lost. As" },
    { afterWordId: "w2", nextWordId: "w3", gapSamples: 199, text: "my. Next" },
  ]);
  assert.throws(() => computeChunks(elements, 10_000, -1), RangeError);
});

test("retimeChunks keeps membership, text, and reasons and recomputes only the span from the members present", () => {
  const chunks = [
    { id: "c0", startSample: 0, endSample: 1, text: "The great silence.", wordIds: ["w1", "w2", "w3"], breakReason: "sentence" as const },
    { id: "c1", startSample: 0, endSample: 1, text: "The", wordIds: ["w4"], breakReason: "pause" as const },
  ];
  const words = [{ id: "w1", startSample: 1000, endSample: 2000 }, { id: "w3", startSample: 3100, endSample: 4000 }];
  assert.deepEqual(retimeChunks(chunks, words).map(c => [c.startSample, c.endSample, c.text]), [[1000, 4000, "The great silence."], [0, 1, "The"]]);
});
