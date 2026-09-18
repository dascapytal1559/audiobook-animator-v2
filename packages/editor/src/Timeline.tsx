import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from "react";
import { booleanFlags, useViewPreference } from "./preferences.js";
import { clampSample, formatClock, millisecondsToSamples, timelineForTrack } from "@animator/domain";
import type { AlignReport, CandidateGroup, Chunk, PeaksResponse, Span, StitchedEntry, TimingMeasure, Word } from "./api.js";
import { ChunkLane, type RowVariant, type TextLaneMode } from "./ChunkLane.js";
import { selectedIds as selectedIdsOf, type Selection, type SelectionItem } from "./selection.js";
import { ShotLane } from "./ShotLane.js";
import { computeSnapTargets, computeSpeechOnsetTargets, findSnapTarget, type SnapTarget } from "./snap.js";
import type { Drag, WordDrag } from "./state.js";
import { Waveform } from "./Waveform.js";

const SNAP_RADIUS_PX = 8;
/** Pointer travel before a press on a selected box becomes a group move rather than a click. */
const DRAG_THRESHOLD_PX = 3;
const MIN_PAUSE_MS = 300;
const MAX_PX_PER_SECOND = 2000;
const DEFAULT_PX_PER_SECOND = 120;
/** Below this zoom the speech band and the timing rows are unreadable, so they are not drawn; the row toggles keep their state. */
const DETAIL_MIN_PX_PER_SECOND = 20;
const LANE_HEIGHTS = { ruler: 20, group: 24, waveform: 72, row: 36, shots: 44 } as const;
const SNAP_TEXT_MAX_CHARS = 40;

type ShotEntry = Extract<StitchedEntry, { kind: "shot" }>;
export type SubtitleToggles = { visible: boolean; highlight: boolean };
export type TimingRowData = { words: ReadonlyArray<Word>; chunks: ReadonlyArray<Chunk> };
type Props = {
  /** The Edited row (A52): effective words in transcript order with any in-progress group move applied, and the server's chunks re-timed to them. */
  words: ReadonlyArray<Word>; chunks: ReadonlyArray<Chunk>;
  /** The read-only rows. `auto` holds only words that have an auto value. */
  original: TimingRowData; auto: TimingRowData;
  transcriptProvider: "openai" | "rev-ai";
  /** Effective start of the first selected word before the drag delta, the leading edge that snaps to speech onsets (A39). */
  selectionLeadStart: number | null;
  sampleRateHz: number; sampleCount: number; peaks: PeaksResponse | null; speech: ReadonlyArray<Span> | null;
  stitched: ReadonlyArray<StitchedEntry>; candidates: ReadonlyArray<CandidateGroup>;
  activeTrackId: string; onSelectTrack: (trackId: string) => void;
  /** Start samples of the active track's shots before and after the current one, for the step buttons in the image group header. */
  previousImageSample: number | null; nextImageSample: number | null;
  /** The preview's subtitle toggles (A61), shown in the text group header because they follow the text timing. */
  subtitles: SubtitleToggles; onToggleSubtitle: (key: keyof SubtitleToggles) => void;
  playhead: number; playing: boolean; follow: boolean; currentWordId: string | null; currentShotId: string | null;
  working: { start: number; end: number } | null; drag: Drag | null;
  selection: Selection | null; wordDrag: WordDrag | null; alignReport: AlignReport | null; alignBusy: boolean;
  onSeek: (sample: number, play: boolean) => void;
  onDragStart: (id: string, startSample: number) => void; onDragMove: (startSample: number, snap: SnapTarget | null) => void;
  onDragEnd: () => void; onDragCancel: () => void;
  onSelect: (item: SelectionItem, extend: boolean) => void;
  onWordDragStart: () => void; onWordDragMove: (delta: number, snap: SnapTarget | null) => void; onWordDragEnd: () => void; onWordDragCancel: () => void;
  onAlign: () => void; onDismissReport: () => void;
};

const MemoWaveform = memo(Waveform);
const MemoChunkLane = memo(ChunkLane);
const MemoShotLane = memo(ShotLane);
/** Browser view preferences (see preferences.ts): the text lane's words-or-sentences choice, the row toggles, and which track groups are open. */
const TEXT_LANE_MODE_KEY = "editor.textLaneMode";
const ROWS_KEY = "editor.timelineRows";
const GROUPS_KEY = "editor.timelineGroups";
type RowToggles = { speech: boolean; original: boolean; auto: boolean; edited: boolean };
const DEFAULT_ROWS: RowToggles = { speech: true, original: true, auto: true, edited: true };
/** The track groups, top to bottom: the waveform, the timing rows, and the image tracks. Each folds on its own. */
type TrackGroupId = "audio" | "text" | "image";
const DEFAULT_GROUPS: Record<TrackGroupId, boolean> = { audio: true, text: true, image: true };
const parseTextLaneMode = (stored: unknown): TextLaneMode => (stored === "words" ? "words" : "sentences");
const parseRows = booleanFlags(DEFAULT_ROWS);
const parseGroups = booleanFlags(DEFAULT_GROUPS);
const EMPTY_IDS: ReadonlySet<string> = new Set();
const noop = () => undefined;

/** Horizontally scrollable, zoomable strip: a ruler over three folding track groups, audio (the waveform), text (up to three timing rows), and image (one row per image track). Only the visible window is drawn. */
export function Timeline(p: Props) {
  const tracks = useMemo(() => [...new Set(p.stitched.map(entry => entry.trackId))].map(id => ({ id, ...timelineForTrack(p, id) })), [p.stitched, p.candidates]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SECOND);
  const [textMode, chooseTextMode] = useViewPreference<TextLaneMode>(TEXT_LANE_MODE_KEY, "sentences", parseTextLaneMode);
  const [rows, setRows] = useViewPreference(ROWS_KEY, DEFAULT_ROWS, parseRows);
  const toggleRow = (key: keyof RowToggles) => setRows({ ...rows, [key]: !rows[key] });
  const [groups, setGroups] = useViewPreference(GROUPS_KEY, DEFAULT_GROUPS, parseGroups);
  const toggleGroup = (id: TrackGroupId) => setGroups({ ...groups, [id]: !groups[id] });
  const [view, setView] = useState({ scrollLeft: 0, width: 0 });
  const pxPerSample = pxPerSecond / p.sampleRateHz;
  const totalWidth = Math.ceil(p.sampleCount * pxPerSample);
  const viewStartSample = view.scrollLeft / pxPerSample;
  const viewEndSample = (view.scrollLeft + view.width) / pxPerSample;
  const snapTargets = useMemo(() => computeSnapTargets(p.words, p.chunks, millisecondsToSamples(MIN_PAUSE_MS, p.sampleRateHz)), [p.words, p.chunks, p.sampleRateHz]);
  const speechTargets = useMemo(() => computeSpeechOnsetTargets(p.speech ?? []), [p.speech]);
  const selectedIds = useMemo(() => selectedIdsOf(p.words.map(w => w.id), p.selection), [p.words, p.selection]);
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

  // Follow playback and explicit seeks, including a link opened at a sentence. Deliberately not re-run on zoom or resize,
  // or a zoom that pushes the playhead off screen would snap the scroll away from the anchor.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null || !p.follow || p.drag !== null || p.wordDrag !== null || view.width === 0) return;
    const x = p.playhead * pxPerSample;
    if (x < el.scrollLeft + view.width * 0.05 || x > el.scrollLeft + view.width * 0.9) el.scrollLeft = Math.max(0, x - view.width * 0.2);
  }, [p.playhead, p.follow, p.playing, p.drag, p.wordDrag, view.width > 0]);

  // Zoom keeps the sample under the anchor fixed on screen. The scroll correction must land in the same commit as the new
  // scale (before paint), or the content, the sticky waveform, and the culling window disagree for a frame and flicker.
  const zoomAnchorRef = useRef<{ sample: number; x: number } | null>(null);
  const zoomTo = useCallback((next: number, anchorClientX: number | null) => {
    const el = scrollRef.current;
    const clamped = Math.min(MAX_PX_PER_SECOND, Math.max(minPxPerSecond, next));
    if (el === null || clamped === pxPerSecond) return;
    const anchorX = anchorClientX === null ? view.width / 2 : anchorClientX - el.getBoundingClientRect().left;
    zoomAnchorRef.current = { sample: (el.scrollLeft + anchorX) / pxPerSample, x: anchorX };
    setPxPerSecond(clamped);
  }, [minPxPerSecond, pxPerSecond, pxPerSample, view.width]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = zoomAnchorRef.current;
    if (el === null || anchor === null) return;
    zoomAnchorRef.current = null;
    el.scrollLeft = anchor.sample * pxPerSample - anchor.x;
    setView({ scrollLeft: el.scrollLeft, width: el.clientWidth });
  }, [pxPerSample]);

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
    if ((e.target as HTMLElement).closest(".marker, .chunk, .image-track-label, .track-group-bar") !== null) return;
    const trackId = (e.target as HTMLElement).closest<HTMLElement>("[data-image-track]")?.dataset["imageTrack"];
    if (trackId !== undefined) p.onSelectTrack(trackId);
    p.onSeek(sampleAtClientX(e.clientX), false);
  };

  // Shot marker drag (A34).
  const dragOffsetRef = useRef(0);
  const onMarkerPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>, entry: ShotEntry) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    p.onSelectTrack(entry.trackId);
    p.onSeek(entry.startSample, false);
    dragOffsetRef.current = sampleAtClientX(e.clientX) - entry.startSample;
    p.onDragStart(entry.id, entry.startSample);
  }, [sampleAtClientX, p.onDragStart, p.onSelectTrack, p.onSeek]);

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

  // Word press in the Edited row: select on press, then either a click (seek) or a group move (A38, A39). Listeners are installed per
  // press and read the latest props through a ref, so a re-render mid-gesture never stales them.
  const latest = useRef({ p, sampleAtClientX, pxPerSample, speechTargets, selectedIds });
  latest.current = { p, sampleAtClientX, pxPerSample, speechTargets, selectedIds };
  const onItemPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>, item: SelectionItem, seekSample: number, play: boolean) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const { p: props, selectedIds: selected } = latest.current;
    const alreadySelected = selected.has(item.first) && selected.has(item.last);
    if (e.shiftKey || !alreadySelected) props.onSelect(item, e.shiftKey);
    const startClientX = e.clientX;
    const startSample = latest.current.sampleAtClientX(e.clientX);
    let dragging = false;
    const move = (ev: PointerEvent) => {
      const { p: q, sampleAtClientX: at, pxPerSample: pps, speechTargets: onsets } = latest.current;
      if (!dragging) {
        if (Math.abs(ev.clientX - startClientX) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        q.onWordDragStart();
      }
      let delta = Math.round(at(ev.clientX) - startSample);
      let snap: SnapTarget | null = null;
      if (!ev.altKey && q.selectionLeadStart !== null) {
        const target = findSnapTarget(onsets, q.selectionLeadStart + delta, SNAP_RADIUS_PX / pps);
        if (target !== null) { snap = target; delta = target.sample - q.selectionLeadStart; }
      }
      q.onWordDragMove(delta, snap);
    };
    const finish = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("keydown", key); };
    const up = () => {
      finish();
      const { p: q } = latest.current;
      if (dragging) { q.onWordDragEnd(); return; }
      if (alreadySelected && !e.shiftKey) q.onSelect(item, false);
      q.onSeek(seekSample, play);
    };
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") { finish(); if (dragging) latest.current.p.onWordDragCancel(); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
  }, []);

  const ticks = useMemo(() => rulerTicks(viewStartSample, Math.min(viewEndSample, p.sampleCount), p.sampleRateHz, pxPerSecond), [viewStartSample, viewEndSample, p.sampleCount, p.sampleRateHz, pxPerSecond]);
  const playheadX = p.playhead * pxPerSample;
  const detail = pxPerSecond >= DETAIL_MIN_PX_PER_SECOND;
  const rowOrder: ReadonlyArray<RowVariant> = detail ? (["original", "auto", "edited"] as const).filter(r => rows[r]) : [];
  const rowData = (variant: RowVariant): TimingRowData => (variant === "original" ? p.original : variant === "auto" ? p.auto : { words: p.words, chunks: p.chunks });
  const wordDragHint = p.wordDrag === null ? null : `${formatDeltaMs(p.wordDrag.delta, p.sampleRateHz)}${p.wordDrag.snap ? ` · ${describeSnap(p.wordDrag.snap, p.sampleRateHz)}` : ""}`;

  return (
    <div className="timeline">
      <div className="timeline-toolbar">
        <button type="button" onClick={() => zoomTo(pxPerSecond / 1.5, null)} aria-label="Zoom out">−</button>
        <span className="zoom-value">{pxPerSecond.toFixed(pxPerSecond < 10 ? 1 : 0)} px/s</span>
        <button type="button" onClick={() => zoomTo(pxPerSecond * 1.5, null)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomTo(minPxPerSecond, null)}>Fit</button>
        <button type="button" className="align-button" onClick={p.onAlign} disabled={p.selection === null || p.alignBusy || p.wordDrag !== null} title="Run the automatic pass on the selected words (A43)" data-testid="align-selection">
          {p.alignBusy ? "Aligning…" : "Align selection"}
        </button>
        {wordDragHint !== null && <span className="snap-hint" data-testid="word-drag-hint">{wordDragHint}</span>}
        {p.drag?.snap && <span className="snap-hint">snap: {describeSnap(p.drag.snap, p.sampleRateHz)}</span>}
        {p.drag && !p.drag.snap && <span className="snap-hint">{formatClock(p.drag.currentStart / p.sampleRateHz)}</span>}
        {p.alignReport !== null && <AlignReportView report={p.alignReport} onDismiss={p.onDismissReport} />}
      </div>
      <div ref={scrollRef} className={`timeline-scroll${p.drag || p.wordDrag ? " dragging" : ""}`} onWheel={onWheel} onPointerDown={onBackgroundClick}>
        <div ref={contentRef} className="timeline-content" style={{ width: totalWidth }}>
          <div className="lane lane-ruler" style={{ height: LANE_HEIGHTS.ruler }}>
            {ticks.map(t => <span key={t.sample} className="tick" style={{ left: t.sample * pxPerSample }}>{t.label}</span>)}
          </div>
          <TrackGroup id="audio" label="Audio" summary={p.speech === null ? "narration" : `narration · ${count(p.speech.length, "speech region")}`} open={groups.audio} onToggle={toggleGroup} controls={
            <span className="track-group-controls" role="group" aria-label="Waveform" title={detail ? undefined : `Speech shading is hidden below ${DETAIL_MIN_PX_PER_SECOND} px/s; zoom in to show it`}>
              <button type="button" className={rows.speech ? "toggle on" : "toggle"} aria-pressed={rows.speech} onClick={() => toggleRow("speech")} disabled={!detail} title={p.speech === null ? "Speech regions have not loaded" : `${p.speech.length} speech regions`} data-testid="toggle-speech">Speech</button>
            </span>
          }>
            <div className="lane lane-waveform" style={{ height: LANE_HEIGHTS.waveform }}>
              <div className="sticky" style={{ left: 0, width: view.width }}>
                <MemoWaveform peaks={p.peaks} regions={rows.speech && detail ? p.speech : null} viewStartSample={viewStartSample} pxPerSample={pxPerSample} width={view.width} height={LANE_HEIGHTS.waveform} />
              </div>
            </div>
          </TrackGroup>
          <TrackGroup id="text" label="Text" summary={detail ? count(rowOrder.length, "timing row") : `rows hidden below ${DETAIL_MIN_PX_PER_SECOND} px/s`} open={groups.text} onToggle={toggleGroup} controls={
            <span className="track-group-controls">
              <span className="control-set" role="radiogroup" aria-label="Text lane">
                <button type="button" className={textMode === "sentences" ? "toggle on" : "toggle"} aria-pressed={textMode === "sentences"} onClick={() => chooseTextMode("sentences")}>Sentences</button>
                <button type="button" className={textMode === "words" ? "toggle on" : "toggle"} aria-pressed={textMode === "words"} onClick={() => chooseTextMode("words")}>Words</button>
              </span>
              <span className="control-set" role="group" aria-label="Rows" title={detail ? undefined : `Rows are hidden below ${DETAIL_MIN_PX_PER_SECOND} px/s; zoom in to show them`}>
                <button type="button" className={rows.original ? "toggle on" : "toggle"} aria-pressed={rows.original} onClick={() => toggleRow("original")} disabled={!detail} title="Initial timing of the working transcript, before waveform alignment" data-testid="toggle-original">{p.transcriptProvider === "openai" ? "GPT initial" : "Rev split"}</button>
                <button type="button" className={rows.auto ? "toggle on" : "toggle"} aria-pressed={rows.auto} onClick={() => toggleRow("auto")} disabled={!detail} title="Scripted align result, read-only" data-testid="toggle-auto">Auto</button>
                <button type="button" className={rows.edited ? "toggle on" : "toggle"} aria-pressed={rows.edited} onClick={() => toggleRow("edited")} disabled={!detail} title="Effective timing: select and drag here" data-testid="toggle-edited">Edited</button>
              </span>
              <span className="control-set" role="group" aria-label="Subtitle controls">
                <button type="button" className={p.subtitles.visible ? "toggle on" : "toggle"} aria-pressed={p.subtitles.visible} onClick={() => p.onToggleSubtitle("visible")} title="Show sentence subtitles on the preview" data-testid="toggle-subtitles">Subtitles</button>
                <button type="button" className={p.subtitles.highlight ? "toggle on" : "toggle"} aria-pressed={p.subtitles.highlight} disabled={!p.subtitles.visible} onClick={() => p.onToggleSubtitle("highlight")} title="Highlight the spoken word in the subtitle" data-testid="toggle-subtitle-highlight">Highlight word</button>
              </span>
            </span>
          }>
          {rowOrder.map(variant => {
            const data = rowData(variant);
            const edited = variant === "edited";
            return (
              <div key={variant} style={{ height: LANE_HEIGHTS.row, position: "relative" }}>
                <MemoChunkLane
                  variant={variant} label={variant === "original" ? (p.transcriptProvider === "openai" ? "GPT initial" : "Rev split") : variant} mode={textMode} chunks={data.chunks} words={data.words} viewStartSample={viewStartSample} viewEndSample={viewEndSample} pxPerSample={pxPerSample} clipEndSample={p.sampleCount}
                  currentWordId={edited ? p.currentWordId : null} selectedIds={edited ? selectedIds : EMPTY_IDS}
                  onWordClick={edited ? noop : w => p.onSeek(w.startSample, true)} onChunkClick={edited ? noop : c => p.onSeek(c.startSample, false)}
                  {...(edited ? { onItemPointerDown } : {})}
                />
              </div>
            );
          })}
          </TrackGroup>
          <TrackGroup id="image" label="Image" summary={count(tracks.length, "track")} open={groups.image} onToggle={toggleGroup} controls={
            <span className="track-group-controls" role="group" aria-label="Image track controls">
              <select aria-label="Image track" value={p.activeTrackId} onChange={e => p.onSelectTrack(e.target.value)}>
                {tracks.map(track => <option key={track.id} value={track.id}>{track.id}</option>)}
              </select>
              <button type="button" disabled={p.previousImageSample === null} onClick={() => { if (p.previousImageSample !== null) p.onSeek(p.previousImageSample, false); }}>Previous image</button>
              <button type="button" disabled={p.nextImageSample === null} onClick={() => { if (p.nextImageSample !== null) p.onSeek(p.nextImageSample, false); }}>Next image</button>
            </span>
          }>
          {tracks.map(track => <div key={track.id} className={`image-track-row${track.id === p.activeTrackId ? " active" : ""}`} data-image-track={track.id} style={{ height: LANE_HEIGHTS.shots, position: "relative" }}>
            <MemoShotLane stitched={track.stitched} candidates={track.candidates} pxPerSample={pxPerSample} currentId={p.currentShotId} drag={p.drag} onMarkerPointerDown={onMarkerPointerDown} />
            <button type="button" className="image-track-label" aria-pressed={track.id === p.activeTrackId} onClick={() => p.onSelectTrack(track.id)}>{track.id}</button>
          </div>)}
          </TrackGroup>
          {p.working && <>
            <div className="working-shade" style={{ left: 0, width: p.working.start * pxPerSample }} />
            <div className="working-shade" style={{ left: p.working.end * pxPerSample, width: Math.max(0, totalWidth - p.working.end * pxPerSample) }} />
          </>}
          {p.drag?.snap && <div className="snap-line" style={{ left: p.drag.snap.sample * pxPerSample }} />}
          {p.wordDrag?.snap && <div className="snap-line" style={{ left: p.wordDrag.snap.sample * pxPerSample }} />}
          <div className="playhead" style={{ left: playheadX }} data-testid="playhead" />
        </div>
      </div>
    </div>
  );
}

/** One folding band of the timeline. The header is a full-width strip; its label and the group's own controls stay at the left edge while the strip scrolls. */
function TrackGroup({ id, label, summary, open, onToggle, controls, children }: { id: TrackGroupId; label: string; summary: string; open: boolean; onToggle: (id: TrackGroupId) => void; controls?: ReactNode; children: ReactNode }) {
  return (
    <section className={`track-group${open ? "" : " folded"}`} data-track-group={id}>
      <div className="track-group-header" style={{ height: LANE_HEIGHTS.group }}>
        <div className="track-group-bar">
          <button type="button" className="track-group-label" aria-expanded={open} onClick={() => onToggle(id)} title={`${open ? "Fold" : "Unfold"} the ${label.toLowerCase()} group`}>
            <span className="chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
            <span>{label}</span>
            <span className="track-group-summary">{summary}</span>
          </button>
          {controls}
        </div>
      </div>
      {open && children}
    </section>
  );
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Before → after for one align run (A48), compact enough for the toolbar. Unknown extra report fields are not rendered. */
function AlignReportView({ report, onDismiss }: { report: AlignReport; onDismiss: () => void }) {
  const format = (value: number | null | undefined, digits: number) => (value === null || value === undefined ? "n/a" : value.toFixed(digits));
  const pair = (pick: (s: TimingMeasure) => number | null | undefined, unit: string, digits = 0) => `${format(pick(report.before), digits)}→${format(pick(report.after), digits)}${unit}`;
  return (
    <span className="align-report" data-testid="align-report" title="Before → after: median, p10, p90 boundary error; fraction of words fully inside speech">
      <span>median {pair(s => s.onsetErrorMs?.median, " ms")}</span>
      <span>p10 {pair(s => s.onsetErrorMs?.p10, " ms")}</span>
      <span>p90 {pair(s => s.onsetErrorMs?.p90, " ms")}</span>
      <span>inside {pair(s => (s.insideSpeechFraction === null ? null : s.insideSpeechFraction * 100), "%")}</span>
      <span className="muted">{report.after.wordCount} words</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss report">×</button>
    </span>
  );
}

function formatDeltaMs(delta: number, sampleRateHz: number): string {
  const ms = (delta / sampleRateHz) * 1000;
  return `Δ ${ms >= 0 ? "+" : "−"}${Math.abs(ms).toFixed(0)} ms`;
}

function describeSnap(snap: SnapTarget, sampleRateHz: number): string {
  const at = formatClock(snap.sample / sampleRateHz);
  switch (snap.kind) {
    case "chunk-start": return `sentence start “${snap.text.length > SNAP_TEXT_MAX_CHARS ? `${snap.text.slice(0, SNAP_TEXT_MAX_CHARS - 1)}…` : snap.text}” (${at})`;
    case "word-start": return `start of “${snap.value}” (${at})`;
    case "pause-midpoint": return `pause midpoint (${at})`;
    case "speech-onset": return `speech onset (${at})`;
  }
}

const TICK_STEPS_SECONDS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600];
function rulerTicks(viewStart: number, viewEnd: number, rate: number, pxPerSecond: number): ReadonlyArray<{ sample: number; label: string }> {
  const step = TICK_STEPS_SECONDS.find(s => s * pxPerSecond >= 70) ?? 600;
  const first = Math.floor(viewStart / rate / step) * step;
  const out: { sample: number; label: string }[] = [];
  for (let t = Math.max(0, first); t * rate <= viewEnd; t += step) out.push({ sample: Math.round(t * rate), label: formatClock(t).replace(/^0:/, "").replace(/\.\d{3}$/, m => (step < 1 ? m : "")) });
  return out;
}
