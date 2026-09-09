import type { Word } from "./api.js";

type Props = { words: ReadonlyArray<Word>; viewStartSample: number; viewEndSample: number; pxPerSample: number; currentWordId: string | null; onWordClick: (word: Word) => void };

/** Words positioned by their samples; only the visible window is rendered. Clicking seeks and plays (A24). */
export function WordLane({ words, viewStartSample, viewEndSample, pxPerSample, currentWordId, onWordClick }: Props) {
  const margin = (viewEndSample - viewStartSample) / 2;
  const visible = words.filter(w => w.endSample >= viewStartSample - margin && w.startSample <= viewEndSample + margin);
  return (
    <div className="lane lane-words">
      {visible.map(word => {
        const left = word.startSample * pxPerSample;
        const width = Math.max(2, (word.endSample - word.startSample) * pxPerSample);
        return (
          <button
            type="button" key={word.id} className={word.id === currentWordId ? "word current" : "word"} style={{ left, width }}
            title={`${word.value} @ ${word.startSample}`} onClick={() => onWordClick(word)} data-word-id={word.id}
          >
            {word.value}
          </button>
        );
      })}
    </div>
  );
}
