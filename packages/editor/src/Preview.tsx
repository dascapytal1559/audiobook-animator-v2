import type { StitchedEntry } from "./api.js";
import { GAP_COLOR, MODE_COLORS, MODE_LABELS } from "./modes.js";

type Props = { entry: StitchedEntry | null; aspect: { width: number; height: number } };

/** The frame at the playhead: the stitched shot's image letterboxed inside the story's aspect, or a placeholder card (A31). */
export function Preview({ entry, aspect }: Props) {
  const style = { aspectRatio: `${aspect.width} / ${aspect.height}` };
  if (entry === null || entry.kind === "gap") {
    return (
      <div className="preview" style={style} data-testid="preview">
        <div className="preview-card" style={{ borderColor: GAP_COLOR }}>
          <div className="preview-card-title">{entry === null ? "No timeline" : "Gap"}</div>
          <div className="preview-card-body">{entry === null ? "Waiting for the story to load." : "No shot starts before this point."}</div>
        </div>
      </div>
    );
  }
  if (entry.imageUrl !== undefined) {
    return (
      <div className="preview" style={style} data-testid="preview">
        <img className="preview-image" src={entry.imageUrl} alt={entry.label ?? entry.id} draggable={false} />
      </div>
    );
  }
  return (
    <div className="preview" style={style} data-testid="preview">
      <div className="preview-card" style={{ borderColor: MODE_COLORS[entry.mode], background: `${MODE_COLORS[entry.mode]}22` }}>
        <div className="preview-card-mode" style={{ color: MODE_COLORS[entry.mode] }}>{MODE_LABELS[entry.mode]}</div>
        <div className="preview-card-title">{entry.label ?? "Untitled shot"}</div>
        {entry.notes !== undefined && <div className="preview-card-body">{entry.notes}</div>}
      </div>
    </div>
  );
}
