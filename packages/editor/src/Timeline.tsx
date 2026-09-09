import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import type { CandidateGroup, PeaksResponse, StitchedEntry, Word } from "./api.js";
import { ShotLane } from "./ShotLane.js";
import { computeSnapTargets, findSnapTarget, type SnapTarget } from "./snap.js";
import type { Drag } from "./state.js";
import { clampSample, formatClock, millisecondsToSamples } from "./time.js";
import { Waveform } from "./Waveform.js";
import { WordLane } from "./WordLane.js";

const SNAP_RADIUS_PX = 8;
const MIN_PAUSE_MS = 300;
const MAX_PX_PER_SECOND = 2000;
const DEFAULT_PX_PER_SECOND = 120;
const LANE_HEIGHTS = { ruler: 20, waveform: 72, words: 36, shots: 44 } as const;

type ShotEntry = Extract<StitchedEntry, { kind: "shot" }>;
type Props = {
  words: ReadonlyArray<Word>; sampleRateHz: number; sampleCount: number; peaks: PeaksResponse | null;
  stitched: ReadonlyArray<StitchedEntry>; candidates: ReadonlyArray<CandidateGroup>;
  playhead: number; playing: boolean; follow: boolean; currentWordId: string | null; currentShotId: string | null;
  working: { start: number; end: number } | null; drag: Drag | null;
  onSeek: (sample: number, play: boolean) => void;
  onDragStart: (id: string, startSample: number) => void; onDragMove: (startSample: number, snap: SnapTarget | null) => void;
  onDragEnd: () => void; onDragCancel: () => void;
};

const MemoWaveform = memo(Waveform);
const MemoWordLane = memo(WordLane);
const MemoShotLane = memo(ShotLane);

/** Horizontally scrollable, zoomable strip with ruler, waveform, word, and shot lanes. Only the visible window is drawn. */
export function Timeline(p: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SECOND);
  const [view, setView] = useState({ scrollLeft: 0, width: 0 });
  const pxPerSample = pxPerSecond / p.sampleRateHz;
  const totalWidth = Math.ceil(p.sampleCount * pxPerSample);
  const viewStartSample = view.scrollLeft / pxPerSample;
  const viewEndSample = (view.scrollLeft + view.width) / pxPerSample;
  const snapTargets = useMemo(() => computeSnapTargets(p.words, millisecondsToSamples(MIN_PAUSE_MS, p.sampleRateHz)), [p.words, p.sampleRateHz]);
  const minPxPerSecond = view.width > 0 ? Math.min(DEFAULT_PX_PER_SECOND, (view.width / p.sampleCount) * p.sampleRateHz) : 1;
  const fittedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current || view.width === 0) return;
    fittedRef.current = true;
    const fit = (view.width / p.sampleCount) * p.sampleRateHz;
    if (fit > DEFAULT_PX_PER_SECOND) setPxPerSecond(Math.min(MAX_PX_PER_SECOND, fit));
  }, [view.width, p.sampleCount, p.sampleRateHz]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const update = () => setView({ scrollLeft: el.scrollLeft, width: el.clientWidth });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => { observer.disconnect(); el.removeEventListener("scroll", update); };
  }, []);

  // Follow playback: keep the playhead in view while it is on.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null || !p.follow || p.drag !== null || view.width === 0) return;
    const x = p.playhead * pxPerSample;
    if (x < el.scrollLeft + view.width * 0.05 || x > el.scrollLeft + view.width * 0.9) el.scrollLeft = Math.max(0, x - view.width * 0.2);
  }, [p.playhead, p.follow, p.drag, pxPerSample, view.width]);

  const zoomTo = useCallback((next: number, anchorClientX: number | null) => {
    const el = scrollRef.current;
    const clamped = Math.min(MAX_PX_PER_SECOND, Math.max(minPxPerSecond, next));
    if (el === null || clamped === pxPerSecond) return;
    const rect = el.getBoundingClientRect();
    const anchorX = anchorClientX === null ? view.width / 2 : anchorClientX - rect.left;
    const anchorSample = (el.scrollLeft + anchorX) / pxPerSample;
    setPxPerSecond(clamped);
    requestAnimationFrame(() => { el.scrollLeft = anchorSample * (clamped / p.sampleRateHz) - anchorX; });
  }, [minPxPerSecond, pxPerSecond, pxPerSample, view.width, p.sampleRateHz]);

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomTo(pxPerSecond * Math.exp(-e.deltaY * 0.002), e.clientX);
  };

  const sampleAtClientX = useCallback((clientX: number) => {
    const content = contentRef.current;
    if (content === null) return 0;
    return clampSample((clientX - content.getBoundingClientRect().left) / pxPerSample, p.sampleCount);
  }, [pxPerSample, p.sampleCount]);

  const onBackgroundClick = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(".marker, .word") !== null) return;
    p.onSeek(sampleAtClientX(e.clientX), false);
  };

  const dragOffsetRef = useRef(0);
  const onMarkerPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>, entry: ShotEntry) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragOffsetRef.current = sampleAtClientX(e.clientX) - entry.startSample;
    p.onDragStart(entry.id, entry.startSample);
  }, [sampleAtClientX, p.onDragStart]);

  useEffect(() => {
    if (p.drag === null) return;
    const move = (e: PointerEvent) => {
      const raw = clampSample(sampleAtClientX(e.clientX) - dragOffsetRef.current, p.sampleCount);
      const snap = e.altKey ? null : findSnapTarget(snapTargets, raw, SNAP_RADIUS_PX / pxPerSample);
      p.onDragMove(snap === null ? raw : snap.sample, snap);
    };
    const up = () => p.onDragEnd();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") p.onDragCancel(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("keydown", key); };
  }, [p.drag !== null, sampleAtClientX, snapTargets, pxPerSample, p.sampleCount, p.onDragMove, p.onDragEnd, p.onDragCancel]);

  const ticks = useMemo(() => rulerTicks(viewStartSample, Math.min(viewEndSample, p.sampleCount), p.sampleRateHz, pxPerSecond), [viewStartSample, viewEndSample, p.sampleCount, p.sampleRateHz, pxPerSecond]);
  const playheadX = p.playhead * pxPerSample;
  const laneTotal = LANE_HEIGHTS.ruler + LANE_HEIGHTS.waveform + LANE_HEIGHTS.words + LANE_HEIGHTS.shots;

  return (
    <div className="timeline">
      <div className="timeline-toolbar">
        <button type="button" onClick={() => zoomTo(pxPerSecond / 1.5, null)} aria-label="Zoom out">−</button>
        <span className="zoom-value">{pxPerSecond.toFixed(0)} px/s</span>
        <button type="button" onClick={() => zoomTo(pxPerSecond * 1.5, null)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomTo(minPxPerSecond, null)}>Fit</button>
        {p.drag?.snap && <span className="snap-hint">snap: {describeSnap(p.drag.snap, p.sampleRateHz)}</span>}
        {p.drag && !p.drag.snap && <span className="snap-hint">{formatClock(p.drag.currentStart / p.sampleRateHz)}</span>}
      </div>
      <div ref={scrollRef} className={`timeline-scroll${p.drag ? " dragging" : ""}`} onWheel={onWheel} onPointerDown={onBackgroundClick}>
        <div ref={contentRef} className="timeline-content" style={{ width: totalWidth, height: laneTotal }}>
          <div className="lane lane-ruler" style={{ height: LANE_HEIGHTS.ruler }}>
            {ticks.map(t => <span key={t.sample} className="tick" style={{ left: t.sample * pxPerSample }}>{t.label}</span>)}
          </div>
          <div className="lane lane-waveform" style={{ height: LANE_HEIGHTS.waveform }}>
            <div className="sticky" style={{ left: 0, width: view.width }}>
              <MemoWaveform peaks={p.peaks} viewStartSample={viewStartSample} pxPerSample={pxPerSample} width={view.width} height={LANE_HEIGHTS.waveform} />
            </div>
          </div>
          <div style={{ height: LANE_HEIGHTS.words, position: "relative" }}>
            <MemoWordLane words={p.words} viewStartSample={viewStartSample} viewEndSample={viewEndSample} pxPerSample={pxPerSample} currentWordId={p.currentWordId} onWordClick={w => p.onSeek(w.startSample, true)} />
          </div>
          <div style={{ height: LANE_HEIGHTS.shots, position: "relative" }}>
            <MemoShotLane stitched={p.stitched} candidates={p.candidates} pxPerSample={pxPerSample} currentId={p.currentShotId} drag={p.drag} onMarkerPointerDown={onMarkerPointerDown} />
          </div>
          {p.working && <>
            <div className="working-shade" style={{ left: 0, width: p.working.start * pxPerSample }} />
            <div className="working-shade" style={{ left: p.working.end * pxPerSample, width: Math.max(0, totalWidth - p.working.end * pxPerSample) }} />
          </>}
          {p.drag?.snap && <div className="snap-line" style={{ left: p.drag.snap.sample * pxPerSample }} />}
          <div className="playhead" style={{ left: playheadX }} data-testid="playhead" />
        </div>
      </div>
    </div>
  );
}

function describeSnap(snap: SnapTarget, sampleRateHz: number): string {
  const at = formatClock(snap.sample / sampleRateHz);
  return snap.kind === "word-start" ? `start of “${snap.value}” (${at})` : `pause midpoint (${at})`;
}

const TICK_STEPS_SECONDS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600];
function rulerTicks(viewStart: number, viewEnd: number, rate: number, pxPerSecond: number): ReadonlyArray<{ sample: number; label: string }> {
  const step = TICK_STEPS_SECONDS.find(s => s * pxPerSecond >= 70) ?? 600;
  const first = Math.floor(viewStart / rate / step) * step;
  const out: { sample: number; label: string }[] = [];
  for (let t = Math.max(0, first); t * rate <= viewEnd; t += step) out.push({ sample: Math.round(t * rate), label: formatClock(t).replace(/^0:/, "").replace(/\.\d{3}$/, m => (step < 1 ? m : "")) });
  return out;
}
