import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cursorWord, frameAt, jobPending, latestJobs, spanBounds } from "@animator/domain";
import { ApiError, type ResolvedSection, type StationResponse, type StoryApi, type StoryboardFirstPassPlan, type StoryboardFrame, type StoryboardJob, type StoryboardSnapshotResult, type StoryResponse, type Word } from "./api.js";
import { Station } from "./Station.js";
import { clock as clipClock } from "./story-map-view.js";
import { firstPassLine, firstPassProgress, jobLine, openingWords, rendererLabel, spanText } from "./storyboard-view.js";

type Props = {
  api: StoryApi;
  /** Every frame of the storyboard, from the timeline the lanes show (A66). */
  frames: ReadonlyArray<StoryboardFrame>;
  /** Where every shot the storyboard track shows starts, frames or not: the shots a span may not swallow (A68). */
  trackStarts: ReadonlyArray<number>;
  /** The effective words sorted by start, and the transcript's element order for narration as written. */
  words: ReadonlyArray<Word>; elements: StoryResponse["elements"];
  playhead: number; playing: boolean; sampleRateHz: number; tolerance: number;
  /** The beat or scene of the story map at the cursor, which a first pass plans (A67); null outside any, or without a map. */
  section: ResolvedSection | null;
  onSeek: (sample: number, andPlay: boolean) => void;
  /** Play the narration from one sample to another, then return the playhead to where it was (A69). */
  onPlaySpan: (startSample: number, endSample: number) => void; onStop: () => void;
  /** Something this section wrote: refetch the timeline and the descriptions without waiting for the server's change notice. */
  onChanged: () => void;
  /** A snapshot was saved (A68): adopt its records, and hide the old frame's shots when the shot moved. */
  onSnapshot: (result: StoryboardSnapshotResult) => void;
};

/** How many words of a frame's opening its heading quotes. */
const OPENING_WORDS = 6;
/** How often the drawings in the background are asked after while one runs. */
const POLL_MS = 1500;
/** Where a first pass stands in this section (A67): asking the model, its proposal awaiting a yes, or carrying it out. */
type Pass = { readonly status: "idle" } | { readonly status: "planning"; readonly title: string }
  | { readonly status: "proposed" | "applying"; readonly title: string; readonly plan: StoryboardFirstPassPlan };
const describe = (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));

/**
 * The Storyboard section (A66, A68, A69). For the frame starting at or before the cursor it shows the frame as saved (CURRENT: the
 * narration it covers, its description, its drawing, all read-only) beside the shot station, where the director describes the shot by voice
 * and works through versions until one is saved as the frame. "New shot" begins a shot that does not exist yet, at the cursor's word. The
 * section follows the playhead while paused and holds its shot while the narration plays, so playing a shot's span never swaps the station
 * under the director. A first pass (A67) proposes the shots of the beat at the cursor, and a strip of every frame seeks on click.
 */
export function Storyboard({ api, frames, trackStarts, words, elements, playhead, playing, sampleRateHz, tolerance, section, onSeek, onPlaySpan, onStop, onChanged, onSnapshot }: Props) {
  const wordById = useMemo(() => new Map(words.map(w => [w.id, w] as const)), [words]);
  const held = useRef(playhead);
  if (!playing) held.current = playhead;
  const at = held.current;
  const frame = frameAt(frames, at, tolerance);
  const cursor = cursorWord(words, at);
  /** "New shot" while a frame is shown: the station works at the cursor's word instead, until the shot is saved or left. */
  const [composing, setComposing] = useState(false);
  const frameAtCursorWord = cursor === null ? undefined : frames.find(f => f.anchorWordId === cursor.id);
  const compose = frame === null || (composing && frameAtCursorWord === undefined);
  /** The shot the station works on: the frame's word, or the word a new shot is begun at. */
  const slot = compose ? cursor?.id ?? null : frame.anchorWordId;
  const current = compose ? null : frame;
  const bounds = useMemo(() => (current === null ? null : spanBounds(words, trackStarts, current.startSample)), [words, trackStarts, current]);

  const [station, setStation] = useState<StationResponse>({ versions: [], images: [] });
  const [message, setMessage] = useState<string | null>(null);
  const refreshStation = useCallback(async () => {
    try { setStation(await api.getStation()); }
    catch (e) { setMessage(`Cannot read the shot station. ${describe(e)}`); }
  }, [api]);
  useEffect(() => { void refreshStation(); }, [refreshStation]);

  const [jobs, setJobs] = useState<ReadonlyArray<StoryboardJob>>([]);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const [now, setNow] = useState(() => Date.now());
  const running = jobs.some(jobPending);
  /** A frame drawing that finished since the last look has published a record, so the timeline is refetched at once; a station drawing, the station. */
  const refreshJobs = useCallback(async () => {
    try {
      const next = (await api.getStoryboardJobs()).jobs;
      const finished = next.filter(job => !jobPending(job) && jobsRef.current.some(p => p.id === job.id && jobPending(p)));
      setJobs(next);
      if (finished.some(job => job.kind === "frame")) onChanged();
      if (finished.some(job => job.kind === "station")) void refreshStation();
    } catch (e) { setMessage(`Cannot read the drawings in progress. ${describe(e)}`); }
  }, [api, onChanged, refreshStation]);
  useEffect(() => { void refreshJobs(); }, [refreshJobs]);
  useEffect(() => {
    if (!running) return;
    const poll = window.setInterval(() => { void refreshJobs(); }, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(poll); window.clearInterval(tick); };
  }, [running, refreshJobs]);
  const addJobs = useCallback((started: ReadonlyArray<StoryboardJob>) => { if (started.length > 0) { setJobs(previous => [...previous, ...started]); setNow(Date.now()); } }, []);
  const frameJobs = useMemo(() => latestJobs(jobs, "frame"), [jobs]);
  const frameJob = current === null ? undefined : frameJobs.get(current.anchorWordId);

  const clock = (sample: number) => clipClock(sample, sampleRateHz);
  const opening = (id: string) => openingWords(elements, wordById, id, OPENING_WORDS);
  /** A save adopts its records; the playhead follows a shot whose start moved, so the station stays on it. */
  const saved = useCallback((result: StoryboardSnapshotResult, moved: boolean) => {
    setComposing(false);
    onSnapshot(result);
    if (result.record !== null && moved) onSeek(result.record.startSample, false);
  }, [onSnapshot, onSeek]);

  /** Ask the model for the shots of the beat at the cursor; nothing is written until the proposal is applied. */
  const [pass, setPass] = useState<Pass>({ status: "idle" });
  const [passMessage, setPassMessage] = useState<{ readonly text: string; readonly failed: boolean } | null>(null);
  const planPass = async () => {
    if (section === null) return;
    setPass({ status: "planning", title: section.title }); setPassMessage(null);
    try { setPass({ status: "proposed", title: section.title, plan: await api.postStoryboardFirstPassPlan(section.id) }); }
    catch (e) { setPass({ status: "idle" }); setPassMessage({ text: `First pass failed. ${describe(e)}`, failed: true }); }
  };
  const applyPass = async () => {
    if (pass.status !== "proposed") return;
    const { plan, title } = pass;
    setPass({ status: "applying", title, plan });
    try {
      const result = await api.postStoryboardFirstPass({ sectionId: plan.sectionId, model: plan.model, prompt: plan.prompt, shots: plan.shots.map(({ anchorWordId, text }) => ({ anchorWordId, text })) });
      addJobs(result.jobs);
      setPass({ status: "idle" });
      setPassMessage({ text: `First pass of “${title}” applied to ${firstPassLine(result.shots)}`, failed: false });
      onChanged();
    } catch (e) { setPass({ status: "proposed", title, plan }); setPassMessage({ text: `First pass failed. ${describe(e)}`, failed: true }); }
  };
  const progress = firstPassProgress(jobs);

  const image = current?.shot.imageUrl;
  const framedFrom = current?.shot.stationVersionId;
  return (
    <section className="storyboard" data-testid="storyboard">
      {slot === null ? <p className="muted storyboard-empty">The transcript has no words to anchor a shot to.</p> : (
        <div className="storyboard-space">
          <div className="storyboard-column storyboard-current" data-testid="storyboard-current">
            <div className="storyboard-column-head">
              <h4 className="storyboard-heading">Current</h4>
              {current === null
                ? <span className="muted">No shot starts at <button type="button" className="link" onClick={() => onSeek(wordById.get(slot)?.startSample ?? at, false)} title="Seek to the word">“{opening(slot)}…”</button> yet.</span>
                : <span>Frame {frames.indexOf(current) + 1} of {frames.length} <button type="button" className="link" onClick={() => onSeek(current.startSample, false)} title="Seek to its first word">“{opening(current.anchorWordId)}…”</button> <span className="mono muted">{clock(current.startSample)}</span></span>}
            </div>
            {current !== null && bounds !== null && <>
              <div className={`storyboard-drawing${image === undefined ? " empty" : ""}`} data-testid="storyboard-drawing">
                {image !== undefined ? <img className={framedFrom === undefined ? "on-paper" : undefined} src={image} alt={current.description?.text ?? "Storyboard frame"} draggable={false} />
                  : <p className="muted">{frameJob !== undefined && jobPending(frameJob) ? "Drawing…" : "No drawing yet."}</p>}
              </div>
              {image !== undefined && <p className="storyboard-status muted">{current.shot.renderer !== undefined ? `Drawn by ${rendererLabel(current.shot.renderer)}` : "Drawing"}{framedFrom !== undefined ? ", from the shot station" : ""}.</p>}
              {frameJob !== undefined && jobPending(frameJob) && <p className="storyboard-status muted">{jobLine(frameJob, now)}</p>}
              <div className="storyboard-label">Description{current.description !== null && <span className="muted"> · by {current.description.model}</span>}</div>
              <p className={`storyboard-block${current.description === null ? " muted" : ""}`} data-testid="storyboard-current-description">{current.description?.text ?? "No description yet."}</p>
              <div className="storyboard-label">Narration</div>
              <p className="storyboard-block storyboard-current-narration" data-testid="storyboard-current-narration">{spanText(elements, wordById, current.anchorWordId, words[bounds.last]!.id)}</p>
            </>}
            {current !== null && cursor !== null && frameAtCursorWord === undefined && cursor.id !== current.anchorWordId && (
              <button type="button" className="storyboard-new" onClick={() => setComposing(true)} data-testid="storyboard-new">New shot at “{opening(cursor.id)}…”</button>
            )}
          </div>
          <Station key={slot} api={api} slot={slot} current={current} trackStarts={trackStarts} words={words} elements={elements} station={station} jobs={jobs} now={now} playing={playing}
            onPlaySpan={onPlaySpan} onStop={onStop} onStationChanged={() => { void refreshStation(); }} onJobs={addJobs} onSnapshot={saved}
            onCancel={compose && frame !== null ? () => setComposing(false) : null} />
        </div>
      )}
      {message !== null && <p className="storyboard-message storyboard-empty">{message}</p>}
      <div className="storyboard-pass" data-testid="storyboard-pass">
        <div className="storyboard-pass-bar">
          <button type="button" onClick={() => { void planPass(); }} disabled={section === null || pass.status !== "idle"} data-testid="storyboard-first-pass"
            title={section === null ? "Put the cursor in a beat or scene of the story map" : "Have a model propose this beat's shots, with a description each; you confirm before anything is written"}>
            {pass.status === "planning" ? "Planning…" : "First pass"}
          </button>
          <span className="muted">{pass.status === "planning" ? `Asking for the shots of “${pass.title}”; this takes a minute or so.`
            : section === null ? "First pass: put the cursor in a beat of the story map." : `of the ${section.kind} “${section.title}”`}</span>
          {progress !== null && <span className="muted" data-testid="storyboard-pass-progress">{progress}</span>}
        </div>
        {passMessage !== null && <p className={passMessage.failed ? "storyboard-message" : "storyboard-status muted"} data-testid="storyboard-pass-message">{passMessage.text}</p>}
        {(pass.status === "proposed" || pass.status === "applying") && (
          <div className="storyboard-proposal" data-testid="storyboard-proposal">
            <p>First pass of “{pass.title}” proposes {firstPassLine(pass.plan.shots)} Planned by {pass.plan.model} in {Math.round(pass.plan.seconds)} s.</p>
            <ol>
              {pass.plan.shots.map(shot => (
                <li key={shot.anchorWordId}>
                  <button type="button" className="link" onClick={() => onSeek(shot.startSample, false)}>“{opening(shot.anchorWordId)}…”</button> <span className="mono muted">{clock(shot.startSample)}</span>{" "}
                  <span className="muted">frame {shot.frame}, description {shot.description}, drawing {shot.drawing}</span>
                  {shot.text !== null && shot.description === "new" && <span className="storyboard-proposal-text">{shot.text}</span>}
                </li>
              ))}
            </ol>
            {pass.plan.unmatched.length > 0 && <p className="muted">Left out, since their opening words were not found in order: {pass.plan.unmatched.map(u => `“${u.opens}”`).join(", ")}.</p>}
            <div className="storyboard-actions">
              <button type="button" onClick={() => { void applyPass(); }} disabled={pass.status === "applying"} data-testid="storyboard-pass-apply">{pass.status === "applying" ? "Applying…" : `Apply: ${pass.plan.shots.filter(s => s.drawing === "new").length} drawings`}</button>
              <button type="button" onClick={() => setPass({ status: "idle" })} disabled={pass.status === "applying"}>Discard</button>
            </div>
          </div>
        )}
      </div>
      <ol className="storyboard-strip" data-testid="storyboard-strip">
        {frames.length === 0 && <li className="muted">No frames yet.</li>}
        {frames.map((f, i) => {
          const status = frameJobs.get(f.anchorWordId)?.status;
          return (
            <li key={f.anchorWordId} className={f === current ? "current" : ""}>
              <button type="button" onClick={() => onSeek(f.startSample, false)} title={`${clock(f.startSample)} “${opening(f.anchorWordId)}…”`} data-testid={`storyboard-frame-${i + 1}`}>
                {f.shot.imageUrl !== undefined ? <img className={f.shot.stationVersionId === undefined ? "on-paper" : undefined} src={f.shot.imageUrl} alt="" draggable={false} loading="lazy" /> : <span className="storyboard-blank">{status === "running" ? "drawing" : status === "queued" ? "waiting" : "no drawing"}</span>}
                <span className="storyboard-strip-label"><span className="badge">{i + 1}</span> <span className="mono">{clock(f.startSample)}</span>{status === "running" && " ✎"}{status === "queued" && " …"}{status === "failed" && " ⚠"}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
