import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cursorWord, frameAt, latestJobs, STORYBOARD_TRACK } from "@animator/domain";
import { ApiError, type StoryApi, type StoryboardDraft, type StoryboardFrame, type StoryboardJob, type StoryResponse, type Word } from "./api.js";
import { clock as clipClock } from "./story-map-view.js";
import { jobLine, openingWords, rendererLabel, takeToSave } from "./storyboard-view.js";

type Props = {
  api: StoryApi;
  /** Every frame of the storyboard, from the timeline the lanes show (A66). */
  frames: ReadonlyArray<StoryboardFrame>;
  /** The effective words sorted by start, and the transcript's element order for a frame's opening words. */
  words: ReadonlyArray<Word>; elements: StoryResponse["elements"];
  playhead: number; sampleRateHz: number; tolerance: number;
  onSeek: (sample: number, andPlay: boolean) => void;
  /** Something this section wrote: refetch the timeline and the descriptions without waiting for the server's change notice. */
  onChanged: () => void;
};

/** How many words of a frame's opening its heading quotes. */
const OPENING_WORDS = 6;
/** How often the drawings in the background are asked after while one runs. */
const POLL_MS = 1500;
const describe = (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));

/**
 * The Storyboard section (A66): the frame at the cursor, and a strip of every frame. It follows the playhead: when a frame starts at or
 * before the cursor it shows that frame's drawing and description, which can be edited, drafted, and drawn again; otherwise it offers to
 * describe a new shot at the cursor's word. Drawing runs on the server in the background; this section reports its progress and never waits on it.
 */
export function Storyboard({ api, frames, words, elements, playhead, sampleRateHz, tolerance, onSeek, onChanged }: Props) {
  const wordById = useMemo(() => new Map(words.map(w => [w.id, w] as const)), [words]);
  const frame = frameAt(frames, playhead, tolerance);
  const cursor = cursorWord(words, playhead);
  /** "New shot here" while a frame is shown: compose at the cursor's word instead. Turned off once the shot is saved. */
  const [composing, setComposing] = useState(false);
  const frameAtCursorWord = cursor === null ? undefined : frames.find(f => f.anchorWordId === cursor.id);
  const compose = frame === null || (composing && frameAtCursorWord === undefined);
  const anchorWordId = compose ? cursor?.id ?? null : frame.anchorWordId;
  const current = compose ? null : frame;

  /** What the user has typed, per anchor word, so following the playhead never loses an edit; and the draft each text came from. */
  const [texts, setTexts] = useState<Readonly<Record<string, string>>>({});
  const [drafts, setDrafts] = useState<Readonly<Record<string, StoryboardDraft>>>({});
  const [busy, setBusy] = useState<"draft" | "save" | "draw" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const saved = current?.description?.text ?? "";
  const text = anchorWordId === null ? "" : texts[anchorWordId] ?? saved;
  const dirty = text.trim() !== saved.trim();
  useEffect(() => { setMessage(null); }, [anchorWordId]);

  const [jobs, setJobs] = useState<ReadonlyArray<StoryboardJob>>([]);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const [now, setNow] = useState(() => Date.now());
  const running = jobs.some(job => job.status === "running");
  /** A drawing that finished since the last look has published a record, so the timeline is refetched at once. */
  const refreshJobs = useCallback(async () => {
    try {
      const next = (await api.getStoryboardJobs()).jobs;
      const finished = next.some(job => job.status !== "running" && jobsRef.current.find(p => p.id === job.id)?.status === "running");
      setJobs(next);
      if (finished) onChanged();
    } catch (e) { setMessage(`Cannot read the drawings in progress. ${describe(e)}`); }
  }, [api, onChanged]);
  useEffect(() => { void refreshJobs(); }, [refreshJobs]);
  useEffect(() => {
    if (!running) return;
    const poll = window.setInterval(() => { void refreshJobs(); }, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(poll); window.clearInterval(tick); };
  }, [running, refreshJobs]);
  const latest = useMemo(() => latestJobs(jobs), [jobs]);
  const job = anchorWordId === null ? undefined : latest.get(anchorWordId);

  const clock = (sample: number) => clipClock(sample, sampleRateHz);
  const opening = (id: string) => openingWords(elements, wordById, id, OPENING_WORDS);
  const setText = (value: string) => { if (anchorWordId !== null) setTexts(previous => ({ ...previous, [anchorWordId]: value })); };
  const forget = (id: string) => setTexts(previous => { const { [id]: _, ...rest } = previous; return rest; });

  /** Ask a model for a description of the shot at this word; it lands in the box for the user to edit, recorded only when saved. */
  const draft = async () => {
    if (anchorWordId === null) return;
    setBusy("draft"); setMessage(null);
    try {
      const proposed = await api.postStoryboardDraft(anchorWordId);
      setDrafts(previous => ({ ...previous, [anchorWordId]: proposed }));
      setTexts(previous => ({ ...previous, [anchorWordId]: proposed.text }));
      setMessage(`Drafted by ${proposed.model} in ${Math.round(proposed.seconds)} s. Edit it, then save or draw.`);
    } catch (e) { setMessage(`Draft failed. ${describe(e)}`); }
    finally { setBusy(null); }
  };
  /** Record the box as the shot's newest description, declaring the shot first when it is new: an image-less storyboard shot placed at the word. */
  const save = async (): Promise<boolean> => {
    if (anchorWordId === null || text.trim() === "") return false;
    if (current !== null && !dirty) return true;
    try {
      const created = current === null ? await api.postShot({ anchorWordId, trackId: STORYBOARD_TRACK, mode: "graphic-illustration", label: "Storyboard frame" }) : null;
      try { await api.postSceneDescription(takeToSave(anchorWordId, text, drafts[anchorWordId] ?? null)); }
      catch (e) { if (!(e instanceof ApiError && e.code === "TakeExists")) throw e; }
      forget(anchorWordId);
      setComposing(false);
      onChanged();
      // A cursor in a pause anchors the new shot to the next word, after the cursor; seeking to it keeps the new frame in view.
      if (created !== null) onSeek(created.startSample, false);
      return true;
    } catch (e) { setMessage(`Save failed. ${describe(e)}`); return false; }
  };
  const run = (kind: "save" | "draw") => async () => {
    if (anchorWordId === null) return;
    setBusy(kind); setMessage(null);
    try {
      if (!(await save()) || kind === "save") return;
      const started = (await api.postStoryboardDraw(anchorWordId)).jobs;
      setJobs(previous => [...previous, ...started]);
      setNow(Date.now());
    } catch (e) { setMessage(`Draw failed to start. ${describe(e)}`); }
    finally { setBusy(null); }
  };

  const drawing = job?.status === "running";
  const image = current?.shot.imageUrl;
  return (
    <section className="storyboard" data-testid="storyboard">
      <div className="storyboard-main">
        <div className={`storyboard-drawing${image === undefined ? " empty" : ""}`} data-testid="storyboard-drawing">
          {image !== undefined ? <img src={image} alt={current?.description?.text ?? "Storyboard frame"} draggable={false} />
            : <p className="muted">{drawing ? "Drawing…" : current === null ? "A new shot: describe it, then draw." : "No drawing yet."}</p>}
        </div>
        <div className="storyboard-side">
          {anchorWordId === null ? <p className="muted">The transcript has no words to anchor a shot to.</p> : <>
            <h4 className="storyboard-heading">
              {current === null
                ? <>New shot at <button type="button" className="link" onClick={() => onSeek(cursor!.startSample, false)} title="Seek to its first word">“{opening(anchorWordId)}…”</button> <span className="mono muted">{clock(cursor!.startSample)}</span></>
                : <>Frame {frames.indexOf(current) + 1} of {frames.length} <button type="button" className="link" onClick={() => onSeek(current.startSample, false)} title="Seek to its first word">“{opening(current.anchorWordId)}…”</button> <span className="mono muted">{clock(current.startSample)}</span></>}
            </h4>
            <textarea className="storyboard-text" value={text} onChange={e => setText(e.target.value)} rows={5} placeholder="What the camera sees: subject, action, setting, framing, light." data-testid="storyboard-text" />
            <div className="storyboard-actions">
              <button type="button" onClick={() => { void draft(); }} disabled={busy !== null} title="Have a model propose a description from the narration around this word" data-testid="storyboard-draft">{busy === "draft" ? "Drafting…" : "Draft"}</button>
              <button type="button" onClick={() => { void run("save")(); }} disabled={busy !== null || text.trim() === "" || (current !== null && !dirty)} data-testid="storyboard-save">{busy === "save" ? "Saving…" : current === null ? "Save shot" : "Save"}</button>
              <button type="button" onClick={() => { void run("draw")(); }} disabled={busy !== null || drawing || text.trim() === ""} data-testid="storyboard-draw">
                {busy === "draw" ? "Starting…" : current === null ? "Save & draw" : image === undefined ? (dirty ? "Save & draw" : "Draw") : (dirty ? "Save & redraw" : "Redraw")}
              </button>
              {current !== null && dirty && <button type="button" onClick={() => forget(current.anchorWordId)} disabled={busy !== null}>Revert</button>}
              {compose && frame !== null && <button type="button" onClick={() => setComposing(false)} disabled={busy !== null}>Cancel</button>}
            </div>
            <p className="storyboard-status muted" data-testid="storyboard-status">
              {current?.description != null && !dirty && <>Description by {current.description.model}. </>}
              {current !== null && current.shot.renderer !== undefined && image !== undefined && !drawing && job === undefined && <>Drawn by {rendererLabel(current.shot.renderer)}. </>}
              {job !== undefined && jobLine(job, now)}
            </p>
            {message !== null && <p className="storyboard-message" data-testid="storyboard-message">{message}</p>}
            {current !== null && cursor !== null && frameAtCursorWord === undefined && cursor.id !== current.anchorWordId && (
              <button type="button" className="storyboard-new" onClick={() => setComposing(true)} disabled={busy !== null} data-testid="storyboard-new">New shot at “{opening(cursor.id)}…”</button>
            )}
          </>}
        </div>
      </div>
      <ol className="storyboard-strip" data-testid="storyboard-strip">
        {frames.length === 0 && <li className="muted">No frames yet.</li>}
        {frames.map((f, i) => {
          const status = latest.get(f.anchorWordId)?.status;
          return (
            <li key={f.anchorWordId} className={f === current ? "current" : ""}>
              <button type="button" onClick={() => onSeek(f.startSample, false)} title={`${clock(f.startSample)} “${opening(f.anchorWordId)}…”`} data-testid={`storyboard-frame-${i + 1}`}>
                {f.shot.imageUrl !== undefined ? <img src={f.shot.imageUrl} alt="" draggable={false} loading="lazy" /> : <span className="storyboard-blank">{status === "running" ? "drawing" : "no drawing"}</span>}
                <span className="storyboard-strip-label"><span className="badge">{i + 1}</span> <span className="mono">{clock(f.startSample)}</span>{status === "running" && " ✎"}{status === "failed" && " ⚠"}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
