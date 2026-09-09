import type { PointerEvent as ReactPointerEvent } from "react";
import type { CandidateGroup, StitchedEntry } from "./api.js";
import { GAP_COLOR, MODE_COLORS } from "./modes.js";
import type { Drag } from "./state.js";

type Props = {
  stitched: ReadonlyArray<StitchedEntry>; candidates: ReadonlyArray<CandidateGroup>; pxPerSample: number; currentId: string | null; drag: Drag | null;
  onMarkerPointerDown: (event: ReactPointerEvent<HTMLElement>, entry: Extract<StitchedEntry, { kind: "shot" }>) => void;
};

/** One marker per stitched shot with a hold bar to its end (Q18). Gaps render as dashed holds. Drag a marker to move its start (A34); an anchored marker (A51) carries a glyph. */
export function ShotLane({ stitched, candidates, pxPerSample, currentId, drag, onMarkerPointerDown }: Props) {
  const countAt = new Map(candidates.map(g => [g.startSample, g.shots.filter(s => !s.hidden).length]));
  return (
    <div className="lane lane-shots">
      {stitched.map(entry => {
        const left = entry.startSample * pxPerSample;
        const width = Math.max(1, (entry.endSample - entry.startSample) * pxPerSample);
        if (entry.kind === "gap") return <div key={`gap-${entry.startSample}`} className="hold gap" style={{ left, width, borderColor: GAP_COLOR }} />;
        const color = MODE_COLORS[entry.mode];
        const count = countAt.get(entry.startSample) ?? 1;
        const dragging = drag?.id === entry.id;
        return (
          <div key={entry.id} className={`shot${entry.id === currentId ? " current" : ""}${dragging ? " dragging" : ""}`} style={{ left, width }} data-shot-id={entry.id}>
            <div className="hold" style={{ background: `${color}55`, borderColor: color }} />
            <div className={`marker${entry.anchorWordId !== undefined ? " anchored" : ""}`} style={{ background: color }} onPointerDown={e => onMarkerPointerDown(e, entry)} title={`${entry.label ?? entry.id}${entry.anchorWordId !== undefined ? ` — anchored to word ${entry.anchorWordId}` : ""} — drag to move (Alt: no snap)`} data-marker-id={entry.id} data-anchor-word-id={entry.anchorWordId}>
              {entry.anchorWordId !== undefined && <span className="anchor-glyph" aria-label="Anchored to a word">⚓</span>}
              <span className="marker-label">{entry.label ?? entry.id.slice(-6)}</span>
              {count > 1 && <span className="badge" title={`${count} candidates`}>{count}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
