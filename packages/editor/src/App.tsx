import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ApiError, AUDIO_URL, getPeaks, getStory, getTimeline, postShot, putDecisions, useServerEvents, type PeaksResponse, type ShotMode, type StitchedEntry, type Word } from "./api.js";
import { entryAt, mergeTimeline } from "./merge.js";
import { planTick } from "./playback.js";
import type { SnapTarget } from "./snap.js";
import { Preview } from "./Preview.js";
import { ShotPanel } from "./ShotPanel.js";
import { decisionsForView, initialState, isDirty, reduce, workingBounds } from "./state.js";
import { Timeline } from "./Timeline.js";
import { Transport } from "./Transport.js";
import { clampSample, millisecondsToSamples, secondsToSamples } from "./time.js";

const SAVE_DEBOUNCE_MS = 300;
const SEEK_TOLERANCE_MS = 1;
const NUDGE_MS = 100;
const BIG_NUDGE_MS = 1000;
const DEFAULT_MODE: ShotMode = "graphic-illustration";

const describe = (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));

export function App() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [peaks, setPeaks] = useState<PeaksResponse | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const sampleRateHz = state.story?.clip.sampleRateHz ?? 0;
  const sampleCount = state.story?.clip.sampleCount ?? 0;
  const words = useMemo<ReadonlyArray<Word>>(() => [...(state.story?.words ?? [])].sort((a, b) => a.startSample - b.startSample), [state.story]);
  const merged = useMemo(() => mergeTimeline(state.records, decisionsForView(state), Math.max(1, sampleCount)), [state.records, state.decisions, state.drag, sampleCount]);
  const tolerance = sampleRateHz > 0 ? millisecondsToSamples(SEEK_TOLERANCE_MS, sampleRateHz) : 0;
  const currentEntry = useMemo(() => entryAt(merged.stitched, state.playhead, tolerance), [merged.stitched, state.playhead, tolerance]);
  const currentShot = currentEntry?.kind === "shot" ? currentEntry : null;
  const currentGroup = useMemo(() => (currentShot ? merged.candidates.find(g => g.startSample === currentShot.startSample) ?? null : null), [merged.candidates, currentShot]);
  const nextShot = useMemo(() => {
    if (currentEntry === null) return null;
    const index = merged.stitched.indexOf(currentEntry);
    const next = merged.stitched.slice(index + 1).find((e): e is Extract<StitchedEntry, { kind: "shot" }> => e.kind === "shot");
    return next ?? null;
  }, [merged.stitched, currentEntry]);
  const currentWordId = useMemo(() => wordAt(words, state.playhead)?.id ?? null, [words, state.playhead]);
  const mergedRef = useRef(merged);
  mergedRef.current = merged;

  // Initial load.
  const loadTimeline = useCallback(async () => {
    try { dispatch({ type: "timeline-loaded", timeline: await getTimeline() }); }
    catch (e) { dispatch({ type: "error", message: `Timeline load failed. ${describe(e)}` }); }
  }, []);
  useEffect(() => {
    void (async () => {
      try {
        const story = await getStory();
        dispatch({ type: "story-loaded", story });
      } catch (e) { dispatch({ type: "error", message: `Story load failed. ${describe(e)}` }); return; }
      await loadTimeline();
      try { setPeaks(await getPeaks()); }
      catch (e) { dispatch({ type: "error", message: `Peaks load failed. ${describe(e)}` }); }
    })();
  }, [loadTimeline]);

  // Live updates: a refetch never touches the audio element or an in-progress drag (the reducer keeps the drag and local edits).
  const onTimelineChanged = useCallback(() => { void loadTimeline(); }, [loadTimeline]);
  const onStatus = useCallback((ok: boolean) => setConnected(ok), []);
  useServerEvents({ onTimelineChanged, onStatus });

  // Debounced persistence with one PUT in flight at a time. The effect re-runs when a save finishes, so edits made during a save get their own PUT.
  const inFlightRef = useRef(false);
  const saveNow = useCallback(async () => {
    if (inFlightRef.current) return;
    const snapshot = stateRef.current;
    if (!isDirty(snapshot)) return;
    inFlightRef.current = true;
    const version = snapshot.editVersion;
    dispatch({ type: "save-started", version });
    try {
      const timeline = await putDecisions(snapshot.decisions);
      dispatch({ type: "save-succeeded", version, timeline });
    } catch (e) {
      dispatch({ type: "save-failed", message: describe(e) });
    } finally {
      inFlightRef.current = false;
    }
  }, []);
  useEffect(() => {
    if (!isDirty(state) || state.drag !== null || state.save.status !== "saved") return;
    const timer = window.setTimeout(() => { void saveNow(); }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [state.editVersion, state.savedVersion, state.save.status, state.drag, saveNow]);
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
  const seek = useCallback((sample: number) => { loopAnchorRef.current = null; seekKeepingLoop(sample); }, [seekKeepingLoop]);
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
      const s = stateRef.current;
      if (s.story === null) return;
      const rate = s.story.clip.sampleRateHz;
      const nudge = millisecondsToSamples(e.shiftKey ? BIG_NUDGE_MS : NUDGE_MS, rate);
      switch (e.key) {
        case " ": e.preventDefault(); togglePlay(); break;
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

  // Record-creating actions.
  const createShot = useCallback(async (request: Parameters<typeof postShot>[0], selectInGroup: boolean) => {
    setBusy(true);
    try {
      const record = await postShot(request);
      dispatch({ type: "record-added", record });
      if (selectInGroup) {
        const group = mergedRef.current.candidates.find(g => g.startSample === request.startSample);
        dispatch({ type: "shot-selected", id: record.id, groupIds: [...(group?.shots.map(s => s.id) ?? []), record.id] });
      }
    } catch (e) {
      dispatch({ type: "error", message: `Creating the shot failed. ${describe(e)}` });
    } finally { setBusy(false); }
  }, []);
  const onNewShot = useCallback(() => {
    const s = stateRef.current;
    const mode = currentShot?.mode ?? DEFAULT_MODE;
    void createShot({ startSample: s.playhead, mode }, false);
  }, [createShot, currentShot]);
  const onAttachImage = useCallback((file: File) => {
    if (currentShot === null) return;
    void createShot({ startSample: currentShot.startSample, mode: currentShot.mode, image: file, ...(currentShot.label !== undefined ? { label: currentShot.label } : {}) }, true);
  }, [createShot, currentShot]);
  const onMergeNext = useCallback(() => {
    if (nextShot === null) return;
    const group = merged.candidates.find(g => g.startSample === nextShot.startSample);
    dispatch({ type: "shots-hidden", ids: group ? group.shots.filter(s => !s.hidden).map(s => s.id) : [nextShot.id] });
  }, [merged.candidates, nextShot]);

  const onDragStart = useCallback((id: string, startSample: number) => dispatch({ type: "drag-start", id, startSample }), []);
  const onDragMove = useCallback((startSample: number, snap: SnapTarget | null) => dispatch({ type: "drag-move", startSample, snap }), []);
  const onDragEnd = useCallback(() => dispatch({ type: "drag-end" }), []);
  const onDragCancel = useCallback(() => dispatch({ type: "drag-cancel" }), []);

  return (
    <div className="app">
      <audio ref={audioRef} src={AUDIO_URL} preload="auto" />
      <header className="header">
        <h1>{state.story ? `${state.story.story.title}` : "Story editor"}</h1>
        {state.story && <span className="muted">{state.story.story.bookTitle} · {state.story.clip.storyId} · {state.story.clip.sampleRateHz} Hz</span>}
        {state.error && <button type="button" className="error" onClick={() => dispatch({ type: "error-clear" })} title="Dismiss" data-testid="error">{state.error}</button>}
      </header>
      <main className="main">
        <section className="stage">
          <Preview entry={currentEntry} aspect={state.decisions.settings.frameAspect} />
          <Transport
            playing={state.playing} playhead={state.playhead} sampleRateHz={Math.max(1, sampleRateHz)} sourceStartSample={state.story?.sourceStartSample ?? 0}
            loop={state.loop} follow={state.follow} working={state.working} save={state.save} dirty={isDirty(state)} connected={connected}
            onTogglePlay={togglePlay} onToggleLoop={() => { loopAnchorRef.current = null; dispatch({ type: "loop-toggle" }); }} onToggleFollow={() => dispatch({ type: "follow-toggle" })}
            onToggleWorking={() => dispatch({ type: "working-toggle" })} onSetIn={() => dispatch({ type: "working-set-in" })} onSetOut={() => dispatch({ type: "working-set-out" })}
            onClearWorking={() => dispatch({ type: "working-clear" })} onSave={() => dispatch({ type: "save-requested" })}
          />
          {state.story && (
            <Timeline
              words={words} sampleRateHz={sampleRateHz} sampleCount={sampleCount} peaks={peaks} stitched={merged.stitched} candidates={merged.candidates}
              playhead={state.playhead} playing={state.playing} follow={state.follow} currentWordId={currentWordId} currentShotId={currentShot?.id ?? null}
              working={workingBounds(state, sampleCount)} drag={state.drag}
              onSeek={onSeek} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={onDragCancel}
            />
          )}
        </section>
        <ShotPanel
          entry={currentEntry} group={currentGroup} next={nextShot} sampleRateHz={Math.max(1, sampleRateHz)} playhead={state.playhead}
          aspect={state.decisions.settings.frameAspect} busy={busy}
          onSelect={id => { if (currentGroup) dispatch({ type: "shot-selected", id, groupIds: currentGroup.shots.map(s => s.id) }); }}
          onMode={(id, mode) => dispatch({ type: "shot-edited", id, patch: { mode } })}
          onNotes={(id, notes) => dispatch({ type: "shot-edited", id, patch: { notes } })}
          onHide={id => dispatch({ type: "shots-hidden", ids: [id] })}
          onAttachImage={onAttachImage} onNewShot={onNewShot} onMergeNext={onMergeNext}
          onAspect={(width, height) => dispatch({ type: "aspect-set", width, height })}
        />
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
