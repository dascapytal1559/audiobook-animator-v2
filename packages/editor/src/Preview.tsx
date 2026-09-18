import type { StoryResponse, StoryWord } from "@animator/domain";
import type { StitchedEntry } from "./api.js";
import { GAP_COLOR, MODE_COLORS, MODE_LABELS } from "./modes.js";
import { Subtitles } from "./Subtitles.js";

type Props = {
  entry: StitchedEntry | null; aspect: { width: number; height: number };
  story: StoryResponse | null; words: ReadonlyArray<StoryWord>; sample: number; currentWordId: string | null;
  /** The subtitle toggles (A61); the owner keeps them and shows the buttons in the timeline's text group. */
  subtitles: { visible: boolean; highlight: boolean };
};

/** A true aspect-ratio frame contains the shot (A31) and optional subtitles (A61). */
export function Preview({ entry, aspect, story, words, sample, currentWordId, subtitles: { visible, highlight } }: Props) {
  const style = { aspectRatio: `${aspect.width} / ${aspect.height}`, maxWidth: `${42 * aspect.width / aspect.height}vh` };
  return (
      <div className="preview" data-testid="preview">
        <div className="preview-frame" style={style} data-testid="preview-frame">
          {entry === null || entry.kind === "gap" ? (
            <div className="preview-card" style={{ borderColor: GAP_COLOR }}>
              <div className="preview-card-title">{entry === null ? "No timeline" : "Gap"}</div>
              <div className="preview-card-body">{entry === null ? "Waiting for the story to load." : "No shot starts before this point."}</div>
            </div>
          ) : entry.imageUrl !== undefined ? (
            <img className="preview-image" src={entry.imageUrl} alt={entry.label ?? entry.id} draggable={false} />
          ) : (
            <div className="preview-card" style={{ borderColor: MODE_COLORS[entry.mode], background: `${MODE_COLORS[entry.mode]}22` }}>
              <div className="preview-card-mode" style={{ color: MODE_COLORS[entry.mode] }}>{MODE_LABELS[entry.mode]}</div>
              <div className="preview-card-title">{entry.label ?? "Untitled shot"}</div>
              {entry.notes !== undefined && <div className="preview-card-body">{entry.notes}</div>}
            </div>
          )}
          {visible && story !== null && <Subtitles story={story} words={words} sample={sample} highlightedWordId={highlight ? currentWordId : null} />}
        </div>
      </div>
  );
}
