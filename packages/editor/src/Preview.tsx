import { useState } from "react";
import { subtitleDefaults, type StoryResponse, type StoryWord } from "@animator/domain";
import type { StitchedEntry } from "./api.js";
import { GAP_COLOR, MODE_COLORS, MODE_LABELS } from "./modes.js";
import { Subtitles } from "./Subtitles.js";

type Props = {
  entry: StitchedEntry | null; aspect: { width: number; height: number };
  story: StoryResponse | null; words: ReadonlyArray<StoryWord>; sample: number; currentWordId: string | null;
};

const VISIBLE_KEY = "animator.editor.subtitles.visible";
const HIGHLIGHT_KEY = "animator.editor.subtitles.highlight";
const readToggle = (key: string, fallback: boolean) => {
  try { const value = window.localStorage.getItem(key); return value === "true" ? true : value === "false" ? false : fallback; }
  catch { return fallback; }
};
const rememberToggle = (key: string, value: boolean) => {
  try { window.localStorage.setItem(key, String(value)); } catch { /* Browser storage is optional; the toggle still works for this visit. */ }
};

/** A true aspect-ratio frame contains the shot (A31) and optional subtitles; each subtitle toggle is remembered by the browser (A61). */
export function Preview({ entry, aspect, story, words, sample, currentWordId }: Props) {
  const [visible, setVisible] = useState(() => readToggle(VISIBLE_KEY, subtitleDefaults.visible));
  const [highlight, setHighlight] = useState(() => readToggle(HIGHLIGHT_KEY, subtitleDefaults.highlight));
  const style = { aspectRatio: `${aspect.width} / ${aspect.height}`, maxWidth: `${42 * aspect.width / aspect.height}vh` };
  return (
    <>
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
      <div className="preview-controls" role="group" aria-label="Subtitle controls">
        <button type="button" className={`toggle ${visible ? "on" : ""}`} aria-pressed={visible} data-testid="toggle-subtitles"
          onClick={() => { rememberToggle(VISIBLE_KEY, !visible); setVisible(!visible); }}>Subtitles</button>
        <button type="button" className={`toggle ${highlight ? "on" : ""}`} aria-pressed={highlight} disabled={!visible} data-testid="toggle-subtitle-highlight"
          onClick={() => { rememberToggle(HIGHLIGHT_KEY, !highlight); setHighlight(!highlight); }}>Highlight word</button>
      </div>
    </>
  );
}
