/** Read-only timing rows (A52) regrouped with the server's own chunking rule, from the story's element order and the row's own times. */
import { type Chunk, type ChunkElement, computeChunks, millisecondsToSamples, type StoryResponse } from "@animator/domain";

export type RowWord = { readonly id: string; readonly value: string; readonly startSample: number; readonly endSample: number };

/**
 * The Original and Auto rows carry their own times for the same words, so their chunks come from the same rule the server applied to the
 * effective layer, on this row's times. Words the row lacks (the Auto row covers only aligned words) are skipped together with the punctuation
 * that follows them, so a gap in coverage never smears punctuation onto the previous chunk.
 */
export function referenceChunks(rowWords: ReadonlyArray<RowWord>, story: Pick<StoryResponse, "clip" | "elements" | "chunking">): ReadonlyArray<Chunk> {
  const byId = new Map(rowWords.map(w => [w.id, w]));
  const elements: ChunkElement[] = [];
  let skipping = false;
  for (const element of story.elements) {
    if (element.kind === "punctuation") { if (!skipping) elements.push(element); continue; }
    const word = byId.get(element.id);
    skipping = word === undefined;
    if (word !== undefined) elements.push({ kind: "word", id: word.id, value: word.value, startSample: word.startSample, endSample: word.endSample });
  }
  const rate = story.clip.sampleRateHz;
  return computeChunks(elements, millisecondsToSamples(story.chunking.pauseBreakMs, rate), millisecondsToSamples(story.chunking.minSentenceBreakMs, rate));
}
