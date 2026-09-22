import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ApiError, storyApi, useServerEvents, type PeaksResponse, type SpeechResponse, type StitchedEntry, type StorySummary, type Word } from "./api.js";
import { clampSample, entryAt, mergeTimeline, millisecondsToSamples, retimeChunks, secondsToSamples, subtitleDefaults, timelineForTrack } from "@animator/domain";
import { referenceChunks } from "./rows.js";
import { planTick } from "./playback.js";
import { selectItem, selectedRange, type SelectionItem } from "./selection.js";
import type { SnapTarget } from "./snap.js";
import { Explorer } from "./Explorer.js";
import { Preview } from "./Preview.js";
import { StoryPicker } from "./StoryPicker.js";
import { decisionsForView, initialState, isDecisionsDirty, isDirty, isTimingDirty, reduce, wordsForView, workingBounds } from "./state.js";
import { booleanFlags, useViewPreference } from "./preferences.js";
import { Timeline, type SubtitleToggles, type TimingRowData } from "./Timeline.js";
import { effectiveWords, wordStartMap } from "./timing.js";
import { Transport } from "./Transport.js";
import { type EditorView, viewFromSearch } from "./view.js";

/** The preview's subtitle toggles (A61) are a browser view preference, kept here because the preview shows them and the timeline's text group toggles them. */
const SUBTITLES_KEY = "editor.subtitles";
const SUBTITLE_TOGGLE_DEFAULTS: SubtitleToggles = { visible: subtitleDefaults.visible, highlight: subtitleDefaults.highlight };
const parseSubtitles = booleanFlags(SUBTITLE_TOGGLE_DEFAULTS);

const SAVE_DEBOUNCE_MS = 300;
const SEEK_TOLERANCE_MS = 1;
const NUDGE_MS = 100;
const BIG_NUDGE_MS = 1000;
/** Comma and period move the selected words by this much (A39). */
const TIMING_NUDGE_MS = 10;
const EMPTY_ROW: TimingRowData = { words: [], chunks: [] };

const describe = (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));

type Props = { storyId: string; stories: ReadonlyArray<StorySummary>; onSelectStory: (storyId: string) => void };

/** The editor for one story. Mount it with `key={storyId}` so a switch starts from a clean reducer, audio element, and event stream. */
export function App({ storyId, stories, onSelectStory }: Props) {
  const api = useMemo(() => storyApi(storyId), [storyId]);
  const [state, dispatch] = useReducer(reduce, initialState);
  const [peaks, setPeaks] = useState<PeaksResponse | null>(null);
  const [speech, setSpeech] = useState<SpeechResponse | null>(null);
  const [connected, setConnected] = useState(false);
  const [alignBusy, setAlignBusy] = useState(false);
  const [openingView, setOpeningView] = useState(() => viewFromSearch(window.location.search));
  const [requestedTrack, setRequestedTrack] = useState(openingView.trackId);
  const [view, setView] = useState<EditorView>(openingView.view);
  const audioRef = useRef<HTMLAudioElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const sampleRateHz = state.story?.clip.sampleRateHz ?? 0;
  const sampleCount = state.story?.clip.sampleCount ?? 0;
  // Edited row (A52): the effective words in transcript order. `editedBase` is before any in-progress group move; `words` is the view.
  const editedBase = useMemo<ReadonlyArray<Word>>(() => (state.story === null ? [] : effectiveWords(state.story.words, state.manual)), [state.story, state.manual]);
  const words = useMemo<ReadonlyArray<Word>>(() => wordsForView(state), [state.story, state.manual, state.wordDrag, state.selection]);
  const chunks = useMemo(() => retimeChunks(state.story?.chunks ?? [], words), [state.story, words]);
  const sortedWords = useMemo(() => [...words].sort((a, b) => a.startSample - b.startSample), [words]);
  // Read-only rows regroup their own times with the server's explicit settings and sentence marks (chunks.ts).
  const originalRow = useMemo<TimingRowData>(() => {
    if (state.story === null) return EMPTY_ROW;
    const row = editedBase.map(w => ({ ...w, startSample: w.original.startSample, endSample: w.original.endSample }));
    return { words: row, chunks: referenceChunks(row, state.story) };
  }, [state.story, editedBase]);
  const autoRow = useMemo<TimingRowData>(() => {
    if (state.story === null) return EMPTY_ROW;
    const row = editedBase.flatMap(w => (w.auto === undefined ? [] : [{ ...w, startSample: w.auto.startSample, endSample: w.auto.endSample }]));
    return { words: row, chunks: referenceChunks(row, state.story) };
  }, [state.story, editedBase]);
  const selectionRange = useMemo(() => selectedRange(editedBase.map(w => w.id), state.selection), [editedBase, state.selection]);
  const selectionLeadStart = selectionRange === null ? null : editedBase[selectionRange.first]?.startSample ?? null;
  const wordStarts = useMemo(() => wordStartMap(words), [words]);
  const merged = useMemo(() => mergeTimeline(state.records, decisionsForView(state), Math.max(1, sampleCount), wordStarts), [state.records, state.decisions, state.drag, sampleCount, wordStarts]);
  const trackIds = useMemo(() => [...new Set(merged.stitched.map(entry => entry.trackId))], [merged.stitched]);
  const activeTrackId = trackIds.includes(requestedTrack) ? requestedTrack : trackIds[0] ?? "main";
  const activeTimeline = useMemo(() => timelineForTrack(merged, activeTrackId), [merged, activeTrackId]);
  const [subtitles, setSubtitles] = useViewPreference(SUBTITLES_KEY, SUBTITLE_TOGGLE_DEFAULTS, parseSubtitles);
  const selectTrack = useCallback((trackId: string) => {
    setRequestedTrack(trackId);
    loopAnchorRef.current = null;
    const url = new URL(window.location.href);
    url.searchParams.set("track", trackId);
    const rate = stateRef.current.story?.clip.sampleRateHz ?? 0;
    if (rate > 0) url.searchParams.set("at", String(stateRef.current.playhead / rate));
    window.history.replaceState(null, "", url);
  }, []);
  /** Timeline or explorer (A62); the choice rides in the URL like the track, so a link opens the same view. */
  const selectView = useCallback((next: EditorView) => {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "timeline") url.searchParams.delete("view"); else url.searchParams.set("view", next);
    const rate = stateRef.current.story?.clip.sampleRateHz ?? 0;
    if (rate > 0) url.searchParams.set("at", String(stateRef.current.playhead / rate));
    window.history.replaceState(null, "", url);
  }, []);
  const tolerance = sampleRateHz > 0 ? millisecondsToSamples(SEEK_TOLERANCE_MS, sampleRateHz) : 0;
  const currentEntry = useMemo(() => entryAt(activeTimeline.stitched, state.playhead, tolerance), [activeTimeline.stitched, state.playhead, tolerance]);
  const currentShot = currentEntry?.kind === "shot" ? currentEntry : null;
  const previousShot = useMemo(() => activeTimeline.stitched.slice(0, currentEntry === null ? 0 : activeTimeline.stitched.indexOf(currentEntry))
    .findLast((entry): entry is Extract<StitchedEntry, { kind: "shot" }> => entry.kind === "shot") ?? null, [activeTimeline.stitched, currentEntry]);
  const nextShot = useMemo(() => {
    if (currentEntry === null) return null;
    const index = activeTimeline.stitched.indexOf(currentEntry);
    const next = activeTimeline.stitched.slice(index + 1).find((e): e is Extract<StitchedEntry, { kind: "shot" }> => e.kind === "shot");
    return next ?? null;
  }, [activeTimeline.stitched, currentEntry]);
  const currentWordId = useMemo(() => wordAt(sortedWords, state.playhead)?.id ?? null, [sortedWords, state.playhead]);
  const mergedRef = useRef(activeTimeline);
  mergedRef.current = activeTimeline;

  // Initial load.
  const loadTimeline = useCallback(async () => {
    try { dispatch({ type: "timeline-loaded", timeline: await api.getTimeline() }); }
    catch (e) { dispatch({ type: "error", message: `Timeline load failed. ${describe(e)}` }); }
  }, [api]);
  const loadStory = useCallback(async () => {
    try { dispatch({ type: "story-loaded", story: await api.getStory() }); return true; }
    catch (e) { dispatch({ type: "error", message: `Story load failed. ${describe(e)}` }); return false; }
  }, [api]);
  // The story map is optional (A62): a 404 is the normal "not written yet"; anything else is shown in the explorer, not the header.
  const loadMap = useCallback(async () => {
    try { dispatch({ type: "map-loaded", map: await api.getMap() }); }
    catch (e) { dispatch(e instanceof ApiError && e.status === 404 ? { type: "map-absent" } : { type: "map-failed", message: describe(e) }); }
  }, [api]);
  useEffect(() => {
    void (async () => {
      if (!(await loadStory())) return;
      await loadTimeline();
      await loadMap();
      try { setPeaks(await api.getPeaks()); }
      catch (e) { dispatch({ type: "error", message: `Peaks load failed. ${describe(e)}` }); }
      // A server without the speech route yet (404) just means no shading; anything else is reported.
      try { setSpeech(await api.getSpeech()); }
      catch (e) { if (!(e instanceof ApiError && e.status === 404)) dispatch({ type: "error", message: `Speech regions load failed. ${describe(e)}` }); }
    })();
  }, [api, loadStory, loadTimeline, loadMap]);
  useEffect(() => { document.title = state.story === null ? "Story editor" : `${state.story.story.title} · Story editor`; }, [state.story]);

  // Live updates: a refetch never touches the audio element or an in-progress drag (the reducer keeps the drag and local edits).
  // The planning directory holds the timing overlays too, so the story is refetched with the timeline.
  const onTimelineChanged = useCallback(() => { void loadTimeline(); void loadStory(); void loadMap(); }, [loadTimeline, loadStory, loadMap]);
  const onStatus = useCallback((ok: boolean) => setConnected(ok), []);
  useServerEvents(api.eventsUrl, { onTimelineChanged, onStatus });

  // Debounced persistence with one save in flight at a time: decisions, then the word-timing overlay (A53), each only when dirty. The
  // effect re-runs when a save finishes, so edits made during a save get their own PUT.
  const inFlightRef = useRef(false);
  const saveNow = useCallback(async () => {
    if (inFlightRef.current) return;
    const snapshot = stateRef.current;
    if (!isDirty(snapshot)) return;
    inFlightRef.current = true;
    dispatch({ type: "save-started", version: snapshot.editVersion });
    try {
      if (isDecisionsDirty(snapshot)) {
        const version = snapshot.editVersion;
        const timeline = await api.putDecisions(snapshot.decisions);
        dispatch({ type: "save-succeeded", version, timeline });
      }
      if (isTimingDirty(snapshot)) {
        const version = snapshot.timingEditVersion;
        const story = await api.putWordTiming({ words: snapshot.manual });
        dispatch({ type: "timing-save-succeeded", version, story });
      }
    } catch (e) {
      dispatch({ type: "save-failed", message: describe(e) });
    } finally {
      inFlightRef.current = false;
    }
  }, [api]);
  useEffect(() => {
    if (!isDirty(state) || state.drag !== null || state.wordDrag !== null || state.save.status !== "saved") return;
    const timer = window.setTimeout(() => { void saveNow(); }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [state.editVersion, state.savedVersion, state.timingEditVersion, state.timingSavedVersion, state.save.status, state.drag, state.wordDrag, saveNow]);
  useEffect(() => { if (state.saveNonce > 0) void saveNow(); }, [state.saveNonce, saveNow]);

  // Audio: the element is the clock while playing; the reducer's playhead is the clock while paused.
  const loopAnchorRef = useRef<number | null>(null);
  const seekKeepingLoop = useCallback((sample: number) => {
    const rate = stateRef.current.story?.clip.sampleRateHz ?? 0;
    const count = stateRef.current.story?.clip.sampleCount ?? 0;
    if (rate === 0 || count === 0) return;
    const target = clampSample(sample, count);
    const audio = audioRef.current;
    if (audio !== null) audio.currentTime = target / rate;
    dispatch({ type: "playhead-set", sample: target });
  }, []);
  /** A user seek re-anchors the loop at wherever playback resumes. */
  const seek = useCallback((sample: number) => {
    loopAnchorRef.current = null;
    seekKeepingLoop(sample);
    const clip = stateRef.current.story?.clip;
    if (clip === undefined) return;
    const url = new URL(window.location.href);
    url.searchParams.set("at", String(clampSample(sample, clip.sampleCount) / clip.sampleRateHz));
    window.history.replaceState(null, "", url);
  }, [seekKeepingLoop]);
  useEffect(() => {
    const onPopState = () => { const opening = viewFromSearch(window.location.search); setOpeningView(opening); setRequestedTrack(opening.trackId); setView(opening.view); };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    if (sampleRateHz === 0 || sampleCount === 0) return;
    const target = clampSample(secondsToSamples(openingView.seconds, sampleRateHz), sampleCount);
    dispatch({ type: "playhead-set", sample: target });
    const audio = audioRef.current;
    if (audio === null) return;
    const apply = () => seek(target);
    if (audio.readyState >= 1) { apply(); return; }
    audio.addEventListener("loadedmetadata", apply, { once: true });
    return () => audio.removeEventListener("loadedmetadata", apply);
  }, [sampleRateHz, sampleCount, openingView, seek]);
  const play = useCallback(() => {
    const s = stateRef.current;
    const audio = audioRef.current;
    if (audio === null || s.story === null) return;
    const region = workingBounds(s, s.story.clip.sampleCount);
    if (region !== null && (s.playhead < region.start || s.playhead >= region.end)) seek(region.start);
    void audio.play().catch(e => dispatch({ type: "error", message: `Playback failed. ${describe(e)}` }));
  }, [seek]);
  const pause = useCallback(() => { audioRef.current?.pause(); }, []);
  const togglePlay = useCallback(() => { if (stateRef.current.playing) pause(); else play(); }, [play, pause]);
  const onSeek = useCallback((sample: number, andPlay: boolean) => { seek(sample); if (andPlay) play(); }, [seek, play]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null) return;
    const onPlay = () => dispatch({ type: "playing-set", playing: true });
    const onPause = () => dispatch({ type: "playing-set", playing: false });
    // The element reaches its end before a frame can observe the last shot's boundary; plan the end like any other tick.
    const onEnded = () => {
      const s = stateRef.current;
      if (s.story === null) return;
      const count = s.story.clip.sampleCount;
      const plan = planTick({ sample: count, sampleCount: count, toleranceSamples: millisecondsToSamples(SEEK_TOLERANCE_MS, s.story.clip.sampleRateHz), stitched: mergedRef.current.stitched, loop: s.loop, loopAnchorStart: loopAnchorRef.current, region: workingBounds(s, count) });
      if (plan.kind === "wrap") { loopAnchorRef.current = plan.loopAnchorStart; seekKeepingLoop(plan.target); void audio.play().catch(e => dispatch({ type: "error", message: `Playback failed. ${describe(e)}` })); }
      else { dispatch({ type: "playing-set", playing: false }); dispatch({ type: "playhead-set", sample: count - 1 }); }
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => { audio.removeEventListener("play", onPlay); audio.removeEventListener("pause", onPause); audio.removeEventListener("ended", onEnded); };
  }, [seekKeepingLoop]);

  useEffect(() => {
    if (!state.playing) return;
    let frame = 0;
    const tick = () => {
      const audio = audioRef.current;
      const s = stateRef.current;
      if (audio === null || s.story === null) return;
      const rate = s.story.clip.sampleRateHz;
      const count = s.story.clip.sampleCount;
      const sample = clampSample(secondsToSamples(audio.currentTime, rate), count);
      const plan = planTick({ sample, sampleCount: count, toleranceSamples: millisecondsToSamples(SEEK_TOLERANCE_MS, rate), stitched: mergedRef.current.stitched, loop: s.loop, loopAnchorStart: loopAnchorRef.current, region: workingBounds(s, count) });
      if (plan.kind === "stop") { audio.pause(); seek(plan.target); return; }
      loopAnchorRef.current = plan.loopAnchorStart;
      if (plan.kind === "wrap") seekKeepingLoop(plan.target);
      else dispatch({ type: "playhead-set", sample });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state.playing, seek, seekKeepingLoop]);

  // Keyboard transport.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      // Space activates a focused button, including the subtitle toggles, without also toggling playback (A61).
      if (target?.tagName === "BUTTON" && e.key === " ") return;
      const s = stateRef.current;
      if (s.story === null) return;
      const rate = s.story.clip.sampleRateHz;
      const nudge = millisecondsToSamples(e.shiftKey ? BIG_NUDGE_MS : NUDGE_MS, rate);
      const modifier = e.metaKey || e.ctrlKey;
      if (modifier && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "timing-redo" : "timing-undo" });
        return;
      }
      if (modifier) return;
      switch (e.key) {
        case " ": e.preventDefault(); togglePlay(); break;
        case "Escape": if (s.drag === null && s.wordDrag === null) dispatch({ type: "selection-set", selection: null }); break;
        case ",": e.preventDefault(); dispatch({ type: "timing-nudge", deltaSamples: -millisecondsToSamples(TIMING_NUDGE_MS, rate) }); break;
        case ".": e.preventDefault(); dispatch({ type: "timing-nudge", deltaSamples: millisecondsToSamples(TIMING_NUDGE_MS, rate) }); break;
        case "ArrowLeft": e.preventDefault(); seek(s.playhead - nudge); break;
        case "ArrowRight": e.preventDefault(); seek(s.playhead + nudge); break;
        case "Home": e.preventDefault(); seek(0); break;
        case "End": e.preventDefault(); seek(s.story.clip.sampleCount - 1); break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seek]);

  const onDragStart = useCallback((id: string, startSample: number) => dispatch({ type: "drag-start", id, startSample }), []);
  const onDragMove = useCallback((startSample: number, snap: SnapTarget | null) => dispatch({ type: "drag-move", startSample, snap }), []);
  const onDragEnd = useCallback(() => dispatch({ type: "drag-end" }), []);
  const onDragCancel = useCallback(() => dispatch({ type: "drag-cancel" }), []);

  // Word timing (A38–A41).
  const onSelect = useCallback((item: SelectionItem, extend: boolean) => dispatch({ type: "selection-set", selection: selectItem(stateRef.current.selection, item, extend) }), []);
  const onWordDragStart = useCallback(() => dispatch({ type: "word-drag-start" }), []);
  const onWordDragMove = useCallback((delta: number, snap: SnapTarget | null) => dispatch({ type: "word-drag-move", delta, snap }), []);
  const onWordDragEnd = useCallback(() => dispatch({ type: "word-drag-end" }), []);
  const onWordDragCancel = useCallback(() => dispatch({ type: "word-drag-cancel" }), []);
  const onDismissReport = useCallback(() => dispatch({ type: "align-report-set", report: null }), []);
  /** Align the selection's span (A43): unsaved timing is flushed first so the server aligns what the user sees. */
  const onAlign = useCallback(async () => {
    const s = stateRef.current;
    if (s.story === null) return;
    const base = effectiveWords(s.story.words, s.manual);
    const range = selectedRange(base.map(w => w.id), s.selection);
    if (range === null) return;
    const first = base[range.first]!;
    const last = base[range.last]!;
    setAlignBusy(true);
    try {
      if (isTimingDirty(s)) await saveNow();
      const { report, story } = await api.postAlign({ startSample: first.startSample, endSample: last.endSample });
      dispatch({ type: "story-loaded", story });
      dispatch({ type: "align-report-set", report });
    } catch (e) {
      dispatch({ type: "error", message: `Align failed. ${describe(e)}` });
    } finally { setAlignBusy(false); }
  }, [api, saveNow]);
  /** Switching stories remounts the editor, so anything unsaved (a failed save, or an edit inside the debounce) would be lost. */
  const onPickStory = useCallback((id: string) => {
    if (id === storyId) return;
    if (isDirty(stateRef.current) && !window.confirm("This story has unsaved changes that will be lost. Switch story?")) return;
    onSelectStory(id);
  }, [storyId, onSelectStory]);

  return (
    <div className="app">
      <audio ref={audioRef} src={api.audioUrl} preload="auto" />
      <header className="header">
        <h1>Story editor</h1>
        <StoryPicker stories={stories} value={storyId} onChange={onPickStory} />
        <div className="view-switch" role="group" aria-label="View">
          <button type="button" className={`toggle${view === "timeline" ? " on" : ""}`} aria-pressed={view === "timeline"} onClick={() => selectView("timeline")} data-testid="view-timeline">Timeline</button>
          <button type="button" className={`toggle${view === "explorer" ? " on" : ""}`} aria-pressed={view === "explorer"} onClick={() => selectView("explorer")} data-testid="view-explorer">Explorer</button>
        </div>
        {state.story && <span className="muted">{state.story.story.bookTitle} · {state.story.clip.storyId} · {state.story.clip.sampleRateHz} Hz · {state.story.story.transcriptProvider === "openai" ? "GPT transcript" : "Rev split text — awaiting GPT"}</span>}
        {state.error && <button type="button" className="error" onClick={() => dispatch({ type: "error-clear" })} title="Dismiss" data-testid="error">{state.error}</button>}
      </header>
      <main className="main">
        <section className="stage">
          {view === "timeline" && <>
          <Preview entry={currentEntry} aspect={state.decisions.settings.frameAspect} story={state.story} words={words} sample={state.playhead} currentWordId={currentWordId} subtitles={subtitles} />
          <Transport
            playing={state.playing} playhead={state.playhead} sampleRateHz={Math.max(1, sampleRateHz)} sourceStartSample={state.story?.sourceStartSample ?? 0}
            loop={state.loop} follow={state.follow} working={state.working} save={state.save} dirty={isDirty(state)} connected={connected}
            onTogglePlay={togglePlay} onToggleLoop={() => { loopAnchorRef.current = null; dispatch({ type: "loop-toggle" }); }} onToggleFollow={() => dispatch({ type: "follow-toggle" })}
            onToggleWorking={() => dispatch({ type: "working-toggle" })} onSetIn={() => dispatch({ type: "working-set-in" })} onSetOut={() => dispatch({ type: "working-set-out" })}
            onClearWorking={() => dispatch({ type: "working-clear" })} onSave={() => dispatch({ type: "save-requested" })}
          />
          </>}
          {state.story && view === "explorer" && <Explorer map={state.map} words={words} elements={state.story.elements} playhead={state.playhead} sampleRateHz={sampleRateHz} onSeek={onSeek} />}
          {state.story && view === "timeline" && (
            <Timeline
              words={words} chunks={chunks} original={originalRow} auto={autoRow} transcriptProvider={state.story?.story.transcriptProvider ?? "rev-ai"} selectionLeadStart={selectionLeadStart}
              sampleRateHz={sampleRateHz} sampleCount={sampleCount} peaks={peaks} speech={speech?.regions ?? null} stitched={merged.stitched} candidates={merged.candidates}
              activeTrackId={activeTrackId} onSelectTrack={selectTrack} previousImageSample={previousShot?.startSample ?? null} nextImageSample={nextShot?.startSample ?? null}
              subtitles={subtitles} onToggleSubtitle={key => setSubtitles({ ...subtitles, [key]: !subtitles[key] })}
              playhead={state.playhead} playing={state.playing} follow={state.follow} currentWordId={currentWordId} currentShotId={currentShot?.id ?? null}
              working={workingBounds(state, sampleCount)} drag={state.drag}
              selection={state.selection} wordDrag={state.wordDrag} alignReport={state.alignReport} alignBusy={alignBusy}
              onSeek={onSeek} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={onDragCancel}
              onSelect={onSelect} onWordDragStart={onWordDragStart} onWordDragMove={onWordDragMove} onWordDragEnd={onWordDragEnd} onWordDragCancel={onWordDragCancel}
              onAlign={() => { void onAlign(); }} onDismissReport={onDismissReport}
            />
          )}
        </section>
      </main>
    </div>
  );
}

/** Word whose span contains `sample`, by binary search over words sorted by start. */
function wordAt(words: ReadonlyArray<Word>, sample: number): Word | null {
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (words[mid]!.startSample <= sample) lo = mid + 1;
    else hi = mid;
  }
  const word = words[lo - 1];
  return word !== undefined && sample < word.endSample ? word : null;
}
