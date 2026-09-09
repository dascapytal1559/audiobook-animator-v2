import { useMemo, type PointerEvent as ReactPointerEvent } from "react";
import type { Chunk, Word } from "./api.js";
import type { SelectionItem } from "./selection.js";

/** Minimum empty space kept between a chunk box that grew into a pause and the next chunk's box. */
const CHUNK_GAP_PX = 4;

export type TextLaneMode = "sentences" | "words";
/** Which timing layer the row shows (A52). Only the Edited row is interactive beyond seeking. */
export type RowVariant = "original" | "auto" | "edited";

type Props = {
  variant: RowVariant; mode: TextLaneMode; chunks: ReadonlyArray<Chunk>; words: ReadonlyArray<Word>; viewStartSample: number; viewEndSample: number; pxPerSample: number;
  /** The clip's sample count: the last box may grow into the trailing silence only this far, so no box extends the scroll area past the clip. */
  clipEndSample: number;
  currentWordId: string | null;
  /** Word ids in the selection; only the Edited row receives a non-empty set. */
  selectedIds: ReadonlySet<string>;
  onWordClick: (word: Word) => void; onChunkClick: (chunk: Chunk) => void;
  /**
   * Edited row only: pointer down on a word or sentence box, with the selection item it stands for and the sample a plain click seeks
   * to. When set, click handling (seek and select) is the owner's, since a drag and a click start the same way.
   */
  onItemPointerDown?: (event: ReactPointerEvent<HTMLElement>, item: SelectionItem, seekSample: number, play: boolean) => void;
};

/**
 * One timing row: one box per chunk (a sentence, or a run cut by a long pause) positioned by its samples; only the visible window is
 * rendered. Each word inside is an inline span so the current word can be highlighted and clicked (seek and play, A24); clicking the
 * chunk's padding seeks to the chunk start. A box is at least as wide as its spoken duration and may grow into the silence after it, up
 * to the next chunk's start (the clip end for the last one); only when even that is narrower than the text is it clipped with an
 * ellipsis (the title carries the full text). In the Edited row, selected boxes are highlighted and a word carries marks for its manual and auto layers (CSS only).
 */
export function ChunkLane({ variant, mode, chunks, words, viewStartSample, viewEndSample, pxPerSample, clipEndSample, currentWordId, selectedIds, onWordClick, onChunkClick, onItemPointerDown }: Props) {
  const wordsById = useMemo(() => new Map(words.map(w => [w.id, w])), [words]);
  const chunkIdByWordId = useMemo(() => new Map(chunks.flatMap(c => c.wordIds.map(id => [id, c.id] as const))), [chunks]);
  const currentChunkId = currentWordId === null ? null : chunkIdByWordId.get(currentWordId) ?? null;
  const interactive = onItemPointerDown !== undefined;
  // All hooks run above this line so the hook order is identical in both modes.
  if (mode === "words") {
    return <WordBoxes variant={variant} words={words} viewStartSample={viewStartSample} viewEndSample={viewEndSample} pxPerSample={pxPerSample} clipEndSample={clipEndSample} currentWordId={currentWordId} selectedIds={selectedIds} onWordClick={onWordClick} {...(onItemPointerDown !== undefined ? { onItemPointerDown } : {})} />;
  }
  const margin = (viewEndSample - viewStartSample) / 2;
  const visible = chunks.map((chunk, index) => ({ chunk, next: chunks[index + 1] }))
    .filter(({ chunk }) => chunk.endSample >= viewStartSample - margin && chunk.startSample <= viewEndSample + margin);
  return (
    <div className={`lane lane-chunks row-${variant}`} data-row={variant}>
      <span className="row-label">{variant}</span>
      {visible.map(({ chunk, next }) => {
        const left = chunk.startSample * pxPerSample;
        const minWidth = Math.max(2, (chunk.endSample - chunk.startSample) * pxPerSample);
        const maxWidth = boxMaxWidth(chunk.startSample, next?.startSample, clipEndSample, pxPerSample, minWidth);
        const item: SelectionItem | null = chunk.wordIds.length > 0 ? { first: chunk.wordIds[0]!, last: chunk.wordIds[chunk.wordIds.length - 1]! } : null;
        const selected = item !== null && chunk.wordIds.every(id => selectedIds.has(id));
        return (
          <div
            key={chunk.id} className={classes("chunk", chunk.id === currentChunkId && "current-chunk", selected && "selected")} style={{ left, minWidth, maxWidth }}
            title={chunk.text} data-chunk-id={chunk.id} data-break-reason={chunk.breakReason}
            onClick={interactive ? undefined : () => onChunkClick(chunk)}
            onPointerDown={interactive && item !== null ? e => onItemPointerDown(e, item, chunk.startSample, false) : undefined}
          >
            {chunk.wordIds.map(id => {
              const word = wordsById.get(id);
              if (word === undefined) return null;
              return (
                <span
                  key={id} className={classes("word", id === currentWordId && "current", selectedIds.has(id) && "selected", ...marks(variant, word))} data-word-id={id}
                  onClick={interactive ? undefined : e => { e.stopPropagation(); onWordClick(word); }}
                  onPointerDown={interactive && item !== null ? e => { e.stopPropagation(); onItemPointerDown(e, item, word.startSample, true); } : undefined}
                >
                  {word.value}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

type WordProps = Omit<Props, "mode" | "chunks" | "onChunkClick">;

/** Word mode: one box per word, sized like a chunk box (at least its duration, growing into the pause before the next word). */
function WordBoxes({ variant, words, viewStartSample, viewEndSample, pxPerSample, clipEndSample, currentWordId, selectedIds, onWordClick, onItemPointerDown }: WordProps) {
  const interactive = onItemPointerDown !== undefined;
  const margin = (viewEndSample - viewStartSample) / 2;
  const visible = words.map((word, index) => ({ word, next: words[index + 1] }))
    .filter(({ word }) => word.endSample >= viewStartSample - margin && word.startSample <= viewEndSample + margin);
  return (
    <div className={`lane lane-chunks lane-words row-${variant}`} data-row={variant}>
      <span className="row-label">{variant}</span>
      {visible.map(({ word, next }) => {
        const left = word.startSample * pxPerSample;
        const minWidth = Math.max(2, (word.endSample - word.startSample) * pxPerSample);
        const maxWidth = boxMaxWidth(word.startSample, next?.startSample, clipEndSample, pxPerSample, minWidth);
        return (
          <div
            key={word.id} className={classes("chunk", "word-box", word.id === currentWordId && "current-chunk", selectedIds.has(word.id) && "selected", ...marks(variant, word))} style={{ left, minWidth, maxWidth }}
            title={`${word.value} @ ${word.startSample}`} data-word-id={word.id}
            onClick={interactive ? undefined : () => onWordClick(word)}
            onPointerDown={interactive ? e => onItemPointerDown(e, { first: word.id, last: word.id }, word.startSample, true) : undefined}
          >
            {word.value}
          </div>
        );
      })}
    </div>
  );
}

/**
 * How far a box may grow past its spoken duration: to the next box's start (minus the gap), or to the clip end when it is the last. The
 * sticky waveform canvas is confined to the content width, so a box that ran past the clip end would shift the waveform (A22).
 */
function boxMaxWidth(startSample: number, nextStartSample: number | undefined, clipEndSample: number, pxPerSample: number, minWidth: number): number {
  const bound = nextStartSample === undefined ? clipEndSample * pxPerSample : (nextStartSample * pxPerSample) - CHUNK_GAP_PX;
  return Math.max(minWidth, bound - startSample * pxPerSample);
}

/** Layer marks are only meaningful on the Edited row, where the effective time may come from either overlay. */
function marks(variant: RowVariant, word: Word): ReadonlyArray<string | false> {
  return variant === "edited" ? [word.manual !== undefined && "has-manual", word.auto !== undefined && "has-auto"] : [];
}

const classes = (...names: ReadonlyArray<string | false>) => names.filter((n): n is string => n !== false).join(" ");
