import { formatSampleClock } from "@animator/domain";
import type { SaveStatus, WorkingRegion } from "./state.js";

type Props = {
  playing: boolean; playhead: number; sampleRateHz: number; sourceStartSample: number;
  loop: boolean; follow: boolean; working: WorkingRegion; save: { status: SaveStatus; message?: string }; dirty: boolean; connected: boolean;
  onTogglePlay: () => void; onToggleLoop: () => void; onToggleFollow: () => void;
  onToggleWorking: () => void; onSetIn: () => void; onSetOut: () => void; onClearWorking: () => void; onSave: () => void;
};

export function Transport(p: Props) {
  const clock = (sample: number) => formatSampleClock(sample, p.sampleRateHz);
  return (
    <div className="transport">
      <button type="button" className="transport-play" onClick={p.onTogglePlay} aria-label={p.playing ? "Pause" : "Play"}>{p.playing ? "Pause" : "Play"}</button>
      <div className="clocks">
        <div className="clock"><span className="clock-label">clip</span><span className="clock-value" data-testid="clip-clock">{clock(p.playhead)}</span></div>
        <div className="clock"><span className="clock-label">book</span><span className="clock-value" data-testid="book-clock">{clock(p.sourceStartSample + p.playhead)}</span></div>
      </div>
      <div className="transport-group">
        <button type="button" className={p.loop ? "toggle on" : "toggle"} onClick={p.onToggleLoop} aria-pressed={p.loop}>Loop shot</button>
        <button type="button" className={p.follow ? "toggle on" : "toggle"} onClick={p.onToggleFollow} aria-pressed={p.follow}>Follow</button>
      </div>
      <div className="transport-group working">
        <button type="button" className={p.working.enabled ? "toggle on" : "toggle"} onClick={p.onToggleWorking} aria-pressed={p.working.enabled}>Working region</button>
        <button type="button" onClick={p.onSetIn} title="Set region in-point at the playhead">In</button>
        <span className="region-value">{p.working.inSample === null ? "start" : clock(p.working.inSample)}</span>
        <button type="button" onClick={p.onSetOut} title="Set region out-point at the playhead">Out</button>
        <span className="region-value">{p.working.outSample === null ? "end" : clock(p.working.outSample)}</span>
        <button type="button" onClick={p.onClearWorking} disabled={p.working.inSample === null && p.working.outSample === null && !p.working.enabled}>Clear</button>
      </div>
      <div className="transport-group save">
        <span className={`status status-${p.connected ? "on" : "off"}`} title={p.connected ? "Live updates connected" : "Live updates disconnected"}>{p.connected ? "live" : "offline"}</span>
        <button type="button" className={`save-button save-${saveLabelStatus(p)}`} onClick={p.onSave} disabled={p.save.status === "saving"} title={p.save.message ?? ""} data-testid="save-button">
          {saveLabelStatus(p) === "saved" ? "Saved" : saveLabelStatus(p) === "saving" ? "Saving…" : "Save failed — retry"}
        </button>
      </div>
    </div>
  );
}

/** Unsaved edits read as "saving" even before the debounce fires, so the button never claims a stale state. */
function saveLabelStatus(p: Pick<Props, "save" | "dirty">): SaveStatus {
  if (p.save.status === "error") return "error";
  return p.dirty ? "saving" : "saved";
}
