/** Transcript chunking for the editor's chunk lane: a chunk is a maximal run of words ended by sentence punctuation, a long pause, or the end of the transcript. */

export type ChunkElement =
  | { readonly kind: "word"; readonly id: string; readonly value: string; readonly startSample: number; readonly endSample: number }
  | { readonly kind: "punctuation"; readonly value: string };
export type ChunkBreakReason = "sentence" | "pause" | "end";
export type Chunk = {
  readonly id: string; readonly startSample: number; readonly endSample: number; readonly text: string;
  readonly wordIds: ReadonlyArray<string>; readonly breakReason: ChunkBreakReason;
};

const SENTENCE_END = /[.?!]/;

export type SentenceBreak = { readonly afterWordId: string; readonly nextWordId: string; readonly gapSamples: number; readonly text: string };

/** Every transcriber sentence mark that is followed by another word, with the gap to that word, so a threshold can be audited. */
export function listSentenceBreaks(elements: ReadonlyArray<ChunkElement>): ReadonlyArray<SentenceBreak> {
  const breaks: SentenceBreak[] = [];
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!;
    if (element.kind !== "word") continue;
    let j = i + 1;
    let punctuation = "";
    for (; j < elements.length && elements[j]!.kind === "punctuation"; j++) punctuation += (elements[j] as { value: string }).value;
    const next = elements[j];
    if (next === undefined || next.kind !== "word" || !SENTENCE_END.test(punctuation)) continue;
    breaks.push({ afterWordId: element.id, nextWordId: next.id, gapSamples: next.startSample - element.endSample, text: `${element.value}${punctuation.trimEnd()} ${next.value}` });
  }
  return breaks;
}

/**
 * Walks `elements` in order. A chunk ends after a word when any punctuation before the next word contains `.`, `?`, or `!` (sentence),
 * else when the gap to the next word is at least `pauseBreakSamples` (pause), else at the last word (end). `text` concatenates every
 * element value from the chunk's first word through the last punctuation before the next chunk's first word, trimmed. Every word belongs
 * to exactly one chunk; punctuation before the first word is dropped.
 */
export function computeChunks(elements: ReadonlyArray<ChunkElement>, pauseBreakSamples: number, minSentenceBreakSamples = 0): ReadonlyArray<Chunk> {
  if (!Number.isInteger(pauseBreakSamples) || pauseBreakSamples < 1) throw new RangeError(`pauseBreakSamples must be a positive integer, got ${pauseBreakSamples}.`);
  if (!Number.isInteger(minSentenceBreakSamples) || minSentenceBreakSamples < 0) throw new RangeError(`minSentenceBreakSamples must be a non-negative integer, got ${minSentenceBreakSamples}.`);
  const chunks: Chunk[] = [];
  let open: { startSample: number; endSample: number; text: string; wordIds: string[] } | null = null;
  const close = (breakReason: ChunkBreakReason) => {
    if (open === null) return;
    chunks.push({ id: `c${chunks.length}`, startSample: open.startSample, endSample: open.endSample, text: open.text.trim(), wordIds: open.wordIds, breakReason });
    open = null;
  };
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!;
    if (element.kind === "punctuation") {
      if (open !== null) open.text += element.value;
      continue;
    }
    if (open === null) open = { startSample: element.startSample, endSample: element.endSample, text: "", wordIds: [] };
    open.text += element.value;
    open.endSample = element.endSample;
    open.wordIds.push(element.id);
    // Look ahead to the next word, absorbing the punctuation in between into this chunk's text before deciding whether it ends here.
    let j = i + 1;
    let sentence = false;
    for (; j < elements.length && elements[j]!.kind === "punctuation"; j++) {
      const punctuation = elements[j]!;
      open.text += punctuation.value;
      if (SENTENCE_END.test(punctuation.value)) sentence = true;
    }
    i = j - 1;
    const next = elements[j];
    // A transcriber's sentence mark only counts when the narrator audibly paused: a gap under `minSentenceBreakSamples` is treated as
    // a misplaced period and the sentence continues (confirmed on the pilot, where such gaps were 0–60 ms against a 1 s median).
    const audible = next === undefined || next.kind !== "word" || next.startSample - element.endSample >= minSentenceBreakSamples;
    if (next === undefined) close("end");
    else if (sentence && audible) close("sentence");
    else if (next.kind === "word" && next.startSample - element.endSample >= pauseBreakSamples) close("pause");
  }
  return chunks;
}
