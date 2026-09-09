/**
 * Client-side chunking for the read-only timing rows (A52). The server's chunks are the source for the Edited row; the Original and Auto
 * rows regroup their own times with the same rule: a sentence mark ends a chunk when the gap reaches `minSentenceBreakSamples`,
 * otherwise a pause of at least `pauseBreakSamples` ends it, otherwise it ends at the last word. The server's chunks and merged-break
 * audit identify the sentence marks; the client words do not include punctuation.
 */
import type { Chunk, Span, StoryResponse } from "./api.js";
import { millisecondsToSamples } from "./time.js";

export type ChunkWord = Span & { readonly id: string; readonly value: string };

export function computeChunks(words: ReadonlyArray<ChunkWord>, sentenceEndIds: ReadonlySet<string>, pauseBreakSamples: number, minSentenceBreakSamples: number): ReadonlyArray<Chunk> {
  if (!Number.isInteger(pauseBreakSamples) || pauseBreakSamples < 1) throw new RangeError(`pauseBreakSamples must be a positive integer, got ${pauseBreakSamples}.`);
  if (!Number.isInteger(minSentenceBreakSamples) || minSentenceBreakSamples < 0) throw new RangeError(`minSentenceBreakSamples must be a non-negative integer, got ${minSentenceBreakSamples}.`);
  const chunks: Chunk[] = [];
  let open: { startSample: number; endSample: number; values: string[]; wordIds: string[] } | null = null;
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (open === null) open = { startSample: word.startSample, endSample: word.endSample, values: [], wordIds: [] };
    open.values.push(word.value);
    open.wordIds.push(word.id);
    open.endSample = word.endSample;
    const next = words[i + 1];
    const gap = next === undefined ? 0 : next.startSample - word.endSample;
    const breakReason: Chunk["breakReason"] | null =
      next === undefined ? "end" : sentenceEndIds.has(word.id) && gap >= minSentenceBreakSamples ? "sentence" : gap >= pauseBreakSamples ? "pause" : null;
    if (breakReason === null) continue;
    chunks.push({ id: `c${chunks.length}`, startSample: open.startSample, endSample: open.endSample, text: open.values.join(" "), wordIds: open.wordIds, breakReason });
    open = null;
  }
  return chunks;
}

/** Word ids that close a sentence, read off the server's chunks: the last word of every chunk that broke on punctuation. */
export function sentenceEndIds(chunks: ReadonlyArray<Chunk>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const chunk of chunks) {
    const last = chunk.wordIds[chunk.wordIds.length - 1];
    if (chunk.breakReason === "sentence" && last !== undefined) ids.add(last);
  }
  return ids;
}

/** Regroup a reference row using the story's settings, including sentence marks suppressed on the effective timing layer. */
export function referenceChunks(words: ReadonlyArray<ChunkWord>, story: Pick<StoryResponse, "clip" | "chunks" | "chunking">): ReadonlyArray<Chunk> {
  const sentenceEnds = new Set(sentenceEndIds(story.chunks));
  for (const merged of story.chunking.mergedSentenceBreaks) sentenceEnds.add(merged.afterWordId);
  return computeChunks(words, sentenceEnds, millisecondsToSamples(story.chunking.pauseBreakMs, story.clip.sampleRateHz), millisecondsToSamples(story.chunking.minSentenceBreakMs, story.clip.sampleRateHz));
}

/**
 * The server's chunk grouping re-timed from the words as they currently are, so the Edited row's boxes follow local edits before the
 * server confirms them. Membership, text, and break reasons are the server's; only `startSample`/`endSample` are recomputed.
 */
export function retimeChunks(chunks: ReadonlyArray<Chunk>, words: ReadonlyArray<ChunkWord>): ReadonlyArray<Chunk> {
  const byId = new Map(words.map(w => [w.id, w]));
  return chunks.map(chunk => {
    const members = chunk.wordIds.map(id => byId.get(id)).filter((w): w is ChunkWord => w !== undefined);
    if (members.length === 0) return chunk;
    return { ...chunk, startSample: Math.min(...members.map(w => w.startSample)), endSample: Math.max(...members.map(w => w.endSample)) };
  });
}
