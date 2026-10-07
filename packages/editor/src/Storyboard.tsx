import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cursorWord, frameAt, jobPending, judgeSpan, latestJobs, spanBounds } from "@animator/domain";
import { ApiError, type ResolvedSection, type ServedStoryboardDraftDrawing, type StoryApi, type StoryboardFirstPassPlan, type StoryboardFrame, type StoryboardJob, type StoryboardSnapshotResult, type StoryResponse, type Word } from "./api.js";
import { useViewPreference } from "./preferences.js";
import { clock as clipClock } from "./story-map-view.js";
import { EMPTY_DRAFT, firstPassLine, firstPassProgress, isEmptyDraft, jobLine, openingWords, parseShotDrafts, rendererLabel, type ShotDraft, spanLines, spanText, takeToSave } from "./storyboard-view.js";

type Props = {
  api: StoryApi;
  /** Every frame of the storyboard, from the timeline the lanes show (A66). */
  frames: ReadonlyArray<StoryboardFrame>;
  /** Where every shot the storyboard track shows starts, frames or not: the shots a drafted span may not swallow (A68). */
  trackStarts: ReadonlyArray<number>;
  /** The effective words sorted by start, and the transcript's element order for narration as written. */
  words: ReadonlyArray<Word>; elements: StoryResponse["elements"];
  playhead: number; sampleRateHz: number; tolerance: number;
  /** The beat or scene of the story map at the cursor, which a first pass plans (A67); null outside any, or without a map. */
  section: ResolvedSection | null;
  onSeek: (sample: number, andPlay: boolean) => void;
  /** Something this section wrote: refetch the timeline and the descriptions without waiting for the server's change notice. */
  onChanged: () => void;
  /** A snapshot was saved (A68): adopt its records, and hide the old frame's shots when the shot moved. */
  onSnapshot: (result: StoryboardSnapshotResult) => void;
};

/** How many words of a frame's opening its heading quotes. */
const OPENING_WORDS = 6;
/** How many words around the drafted span the narration picker offers, inside the span's bounds. */
const PICK_CONTEXT = 40;
/** How often the drawings in the background are asked after while one runs. */
const POLL_MS = 1500;
/** Where a first pass stands in this section (A67): asking the model, its proposal awaiting a yes, or carrying it out. */
type Pass = { readonly status: "idle" } | { readonly status: "planning"; readonly title: string }
  | { readonly status: "proposed" | "applying"; readonly title: string; readonly plan: StoryboardFirstPassPlan };
const describe = (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));

/**
 * The Storyboard section (A66), as a drafting space (A68). It follows the playhead: for the frame starting at or before the cursor it shows,
 * side by side, the frame as saved (CURRENT: the narration it covers, its description, its drawing, all read-only) and a DRAFT of it: the
 * narration it would cover, picked word by word; a request telling the AI what to change; a description and a drawing generated from them,
 * each editable or discardable on its own. Save commits the draft as one snapshot of narration, description, and drawing, which becomes
 * the frame; nothing is overwritten. "New shot" drafts a shot that does not exist yet, at the cursor's word. Drawing runs on the server in
 * the background; a draft drawing is kept there, off the timeline, until it is saved or discarded. A first pass (A67) proposes the shots of
 * the beat at the cursor, shows what it would do, and on a yes declares, describes, and draws them.
 */
export function Storyboard({ api, frames, trackStarts, words, elements, playhead, sampleRateHz, tolerance, section, onSeek, onChanged, onSnapshot }: Props) {
  const wordById = useMemo(() => new Map(words.map(w => [w.id, w] as const)), [words]);
  const wordIndex = useMemo(() => new Map(words.map((w, i) => [w.id, i] as const)), [words]);
  const elementIndex = useMemo(() => { const m = new Map<string, number>(); elements.forEach((e, i) => { if (e.kind === "word") m.set(e.id, i); }); return m; }, [elements]);
  const frame = frameAt(frames, playhead, tolerance);
  const cursor = cursorWord(words, playhead);
  /** "New shot" while a frame is shown: draft at the cursor's word instead. Turned off once the shot is saved or the draft discarded. */
  const [composing, setComposing] = useState(false);
  const frameAtCursorWord = cursor === null ? undefined : frames.find(f => f.anchorWordId === cursor.id);
  const compose = frame === null || (composing && frameAtCursorWord === undefined);
  /** The shot the draft belongs to: the frame's word, or the word a new shot is drafted at. */
  const slot = compose ? cursor?.id ?? null : frame.anchorWordId;
  const current = compose ? null : frame;

  // The span: what the frame covers now, how far a draft of it may reach, and what the draft covers.
  const at = current?.startSample ?? cursor?.startSample ?? 0;
  const bounds = useMemo(() => spanBounds(words, trackStarts, at), [words, trackStarts, at]);
  const currentSpan = current === null || bounds === null ? null : { start: wordIndex.get(current.anchorWordId) ?? bounds.first, end: bounds.last };
  const defaultSpan = currentSpan ?? (cursor === null || bounds === null ? null : { start: wordIndex.get(cursor.id) ?? bounds.first, end: bounds.last });

  /** The drafts this browser keeps, per shot, so a reload or following the playhead never loses one. */
  const [drafts, setDrafts] = useViewPreference<Readonly<Record<string, ShotDraft>>>(`storyboard.drafts.${api.storyId}`, {}, parseShotDrafts);
  const draft = slot === null ? EMPTY_DRAFT : drafts[slot] ?? EMPTY_DRAFT;
  const patchDraft = useCallback((key: string, patch: Partial<ShotDraft>) => setDrafts(previous => {
    const { [key]: before = EMPTY_DRAFT, ...rest } = previous;
    const next = { ...before, ...patch };
    return isEmptyDraft(next) ? rest : { ...rest, [key]: next };
  }), [setDrafts]);
  const drafted = draft.span === null ? undefined : { start: wordIndex.get(draft.span.startWordId), end: wordIndex.get(draft.span.endWordId) };
  const span = drafted?.start !== undefined && drafted.end !== undefined ? { start: drafted.start, end: drafted.end } : defaultSpan;
  const judged = span === null || bounds === null ? null : judgeSpan(bounds, currentSpan?.start ?? null, span.start, span.end);
  const spanChanged = span !== null && defaultSpan !== null && (span.start !== defaultSpan.start || span.end !== defaultSpan.end);
  const [pickMode, setPickMode] = useState<"start" | "end">("start");

  const savedText = current?.description?.text ?? "";
  const text = draft.text ?? savedText;
  const descriptionChanged = draft.text !== null && text.trim() !== "" && text.trim() !== savedText.trim();

  const [busy, setBusy] = useState<"describe" | "draw" | "save" | "discard" | null>(null);
  const [message, setMessage] = useState<{ readonly text: string; readonly failed: boolean } | null>(null);
  const failed = (text: string) => setMessage({ text, failed: true });
  useEffect(() => { setMessage(null); setPickMode("start"); }, [slot]);

  /** The draft drawings on the server (A68), one per shot at most. */
  const [serverDrafts, setServerDrafts] = useState<ReadonlyArray<ServedStoryboardDraftDrawing>>([]);
  const refreshDrafts = useCallback(async () => {
    try { setServerDrafts((await api.getStoryboardDrafts()).drafts); }
    catch (e) { failed(`Cannot read the draft drawings. ${describe(e)}`); }
  }, [api]);
  useEffect(() => { void refreshDrafts(); }, [refreshDrafts]);
  const drawingDraft = slot === null ? undefined : serverDrafts.findLast(d => d.anchorWordId === slot);

  const [jobs, setJobs] = useState<ReadonlyArray<StoryboardJob>>([]);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const [now, setNow] = useState(() => Date.now());
  const running = jobs.some(jobPending);
  /** A frame drawing that finished since the last look has published a record, so the timeline is refetched at once; a draft drawing, the drafts. */
  const refreshJobs = useCallback(async () => {
    try {
      const next = (await api.getStoryboardJobs()).jobs;
      const finished = next.filter(job => !jobPending(job) && jobsRef.current.some(p => p.id === job.id && jobPending(p)));
      setJobs(next);
      if (finished.some(job => job.kind === "frame")) onChanged();
      if (finished.some(job => job.kind === "draft")) void refreshDrafts();
    } catch (e) { failed(`Cannot read the drawings in progress. ${describe(e)}`); }
  }, [api, onChanged, refreshDrafts]);
  useEffect(() => { void refreshJobs(); }, [refreshJobs]);
  useEffect(() => {
    if (!running) return;
    const poll = window.setInterval(() => { void refreshJobs(); }, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(poll); window.clearInterval(tick); };
  }, [running, refreshJobs]);
  const frameJobs = useMemo(() => latestJobs(jobs, "frame"), [jobs]);
  const draftJobs = useMemo(() => latestJobs(jobs, "draft"), [jobs]);
  const frameJob = current === null ? undefined : frameJobs.get(current.anchorWordId);
  const draftJob = slot === null ? undefined : draftJobs.get(slot);
  const drawingNow = draftJob !== undefined && jobPending(draftJob);

  const clock = (sample: number) => clipClock(sample, sampleRateHz);
  const opening = (id: string) => openingWords(elements, wordById, id, OPENING_WORDS);
  const differs = compose || descriptionChanged || drawingDraft !== undefined || spanChanged;
  const canSave = differs && judged?.ok === true && span !== null && busy === null;

  /** Ask a model for a description of the drafted span, revising the description in the draft as the request says; it lands in the draft only. */
  const generateDescription = async () => {
    if (slot === null || span === null) return;
    const key = slot;
    setBusy("describe"); setMessage(null);
    try {
      const revise = text.trim();
      const request = draft.request.trim();
      const proposed = await api.postStoryboardDraft({ anchorWordId: words[span.start]!.id, endWordId: words[span.end]!.id, ...(revise !== "" ? { current: revise } : {}), ...(request !== "" ? { request } : {}) });
      patchDraft(key, { text: proposed.text, source: proposed });
      setMessage({ text: `Description drafted by ${proposed.model} in ${Math.round(proposed.seconds)} s.`, failed: false });
    } catch (e) { failed(`Generating a description failed. ${describe(e)}`); }
    finally { setBusy(null); }
  };
  /** Draw the description in the draft as the shot's draft drawing, in the background; it never becomes the frame's drawing until saved. */
  const generateDrawing = async () => {
    if (slot === null || span === null || text.trim() === "") return;
    setBusy("draw"); setMessage(null);
    try {
      const started = (await api.postStoryboardDraw({ anchorWordId: slot, startWordId: words[span.start]!.id, text: text.trim() })).jobs;
      setJobs(previous => [...previous, ...started]);
      setNow(Date.now());
    } catch (e) { failed(`Generating a drawing failed to start. ${describe(e)}`); }
    finally { setBusy(null); }
  };
  const discardDrawing = async (key: string) => {
    setBusy("discard"); setMessage(null);
    try { setServerDrafts((await api.postStoryboardDiscard(key)).drafts); }
    catch (e) { failed(`Discarding the drawing failed. ${describe(e)}`); }
    finally { setBusy(null); }
  };
  /** Drop the whole draft: description, span, request, and draft drawing. A new shot's draft also leaves "New shot". */
  const discardAll = async () => {
    if (slot === null) return;
    const key = slot;
    patchDraft(key, EMPTY_DRAFT);
    if (serverDrafts.some(d => d.anchorWordId === key)) await discardDrawing(key);
    setComposing(false);
  };
  /** Save the draft as one snapshot; the editor hides the old frame when the shot moved, and the playhead follows the shot to its new start. */
  const save = async () => {
    if (!canSave || slot === null || span === null || judged === null || !judged.ok) return;
    const key = slot;
    setBusy("save"); setMessage(null);
    try {
      const result = await api.postStoryboardSnapshot({ frameWordId: current?.anchorWordId ?? null, startWordId: words[span.start]!.id, endWordId: words[span.end]!.id,
        description: descriptionChanged ? takeToSave(text, draft.source) : null, draftId: drawingDraft?.id ?? null });
      patchDraft(key, EMPTY_DRAFT);
      setServerDrafts(previous => previous.filter(d => d.anchorWordId !== key));
      setComposing(false);
      onSnapshot(result);
      if (result.record !== null && judged.moved) onSeek(result.record.startSample, false);
    } catch (e) { failed(`Save failed. ${describe(e)}`); }
    finally { setBusy(null); }
  };
  /** Clicking a word sets the drafted span's start, then its end; a span equal to the shot's own is no draft. */
  const pick = (index: number) => {
    if (slot === null || span === null || defaultSpan === null) return;
    const next = pickMode === "start" ? { start: index, end: Math.max(span.end, index) } : { start: Math.min(span.start, index), end: index };
    patchDraft(slot, { span: next.start === defaultSpan.start && next.end === defaultSpan.end ? null : { startWordId: words[next.start]!.id, endWordId: words[next.end]!.id } });
    if (pickMode === "start") setPickMode("end");
  };

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
      setJobs(previous => [...previous, ...result.jobs]);
      setNow(Date.now());
      setPass({ status: "idle" });
      setPassMessage({ text: `First pass of “${title}” applied to ${firstPassLine(result.shots)}`, failed: false });
      onChanged();
    } catch (e) { setPass({ status: "proposed", title, plan }); setPassMessage({ text: `First pass failed. ${describe(e)}`, failed: true }); }
  };
  const progress = firstPassProgress(jobs);

  const image = current?.shot.imageUrl;
  const passage = (() => {
    if (span === null || bounds === null || defaultSpan === null) return null;
    const lo = Math.max(bounds.first, Math.min(span.start, defaultSpan.start) - PICK_CONTEXT);
    const hi = Math.min(bounds.last, Math.max(span.end, defaultSpan.end) + PICK_CONTEXT);
    const from = elementIndex.get(words[lo]?.id ?? "");
    const to = elementIndex.get(words[hi]?.id ?? "");
    if (from === undefined || to === undefined) return null;
    return elements.slice(from, to + 1).map((element, i) => {
      if (element.kind === "punctuation") return <span key={i}>{element.value}</span>;
      const index = wordIndex.get(element.id);
      const word = wordById.get(element.id);
      if (index === undefined || word === undefined) return <span key={i}>{element.id}</span>;
      const inside = span.start <= index && index <= span.end;
      const edge = index === span.start ? " start" : index === span.end ? " end" : "";
      return <span key={i} className={`pick-word${inside ? " in" : ""}${edge}`} onClick={() => pick(index)} role="button" tabIndex={-1} title={`Set the shot's ${pickMode} here`}>{word.value}</span>;
    });
  })();
  const lines = span === null || judged === null ? [] : spanLines({ current: currentSpan, start: span.start, end: span.end, judged, hasBefore: trackStarts.some(s => s < at), opening: index => opening(words[index]!.id) });
  const heading = (title: string) => <h4 className="storyboard-heading">{title}</h4>;
  return (
    <section className="storyboard" data-testid="storyboard">
      {slot === null || span === null ? <p className="muted storyboard-empty">The transcript has no words to anchor a shot to.</p> : (
        <div className="storyboard-space">
          <div className="storyboard-column storyboard-current" data-testid="storyboard-current">
            <div className="storyboard-column-head">
              {heading("Current")}
              {current === null
                ? <span className="muted">No shot starts at <button type="button" className="link" onClick={() => onSeek(cursor!.startSample, false)} title="Seek to the word">“{opening(slot)}…”</button> yet.</span>
                : <span>Frame {frames.indexOf(current) + 1} of {frames.length} <button type="button" className="link" onClick={() => onSeek(current.startSample, false)} title="Seek to its first word">“{opening(current.anchorWordId)}…”</button> <span className="mono muted">{clock(current.startSample)}</span></span>}
            </div>
            {current !== null && currentSpan !== null && <>
              <div className="storyboard-label">Narration</div>
              <p className="storyboard-block" data-testid="storyboard-current-narration">{spanText(elements, wordById, words[currentSpan.start]!.id, words[currentSpan.end]!.id)}</p>
              <div className="storyboard-label">Description{current.description !== null && <span className="muted"> · by {current.description.model}</span>}</div>
              <p className={`storyboard-block${current.description === null ? " muted" : ""}`} data-testid="storyboard-current-description">{current.description?.text ?? "No description yet."}</p>
              <div className="storyboard-label">Drawing{image !== undefined && current.shot.renderer !== undefined && <span className="muted"> · by {rendererLabel(current.shot.renderer)}</span>}</div>
              <div className={`storyboard-drawing${image === undefined ? " empty" : ""}`} data-testid="storyboard-drawing">
                {image !== undefined ? <img className="on-paper" src={image} alt={current.description?.text ?? "Storyboard frame"} draggable={false} />
                  : <p className="muted">{frameJob !== undefined && jobPending(frameJob) ? "Drawing…" : "No drawing yet."}</p>}
              </div>
              {frameJob !== undefined && <p className="storyboard-status muted">{jobLine(frameJob, now)}</p>}
            </>}
            {current !== null && cursor !== null && frameAtCursorWord === undefined && cursor.id !== current.anchorWordId && (
              <button type="button" className="storyboard-new" onClick={() => setComposing(true)} disabled={busy !== null} data-testid="storyboard-new">New shot at “{opening(cursor.id)}…”</button>
            )}
          </div>
          <div className="storyboard-column storyboard-draft" data-testid="storyboard-draft">
            <div className="storyboard-column-head">
              {heading(current === null ? "Draft · new shot" : "Draft")}
              <span className="storyboard-actions">
                <button type="button" className="primary" onClick={() => { void save(); }} disabled={!canSave} data-testid="storyboard-save"
                  title="Save the draft's narration, description, and drawing together as the shot; earlier versions are kept">{busy === "save" ? "Saving…" : current === null ? "Save shot" : "Save"}</button>
                {(!isEmptyDraft(draft) || drawingDraft !== undefined || (compose && frame !== null)) && (
                  <button type="button" onClick={() => { void discardAll(); }} disabled={busy !== null} data-testid="storyboard-discard-all">{compose && frame !== null ? "Cancel" : "Discard draft"}</button>
                )}
              </span>
            </div>
            <div className="storyboard-label">
              Narration{spanChanged && <span className="muted"> · changed</span>}
              <span className="storyboard-pick" role="radiogroup" aria-label="Clicking a word sets">
                <span className="muted">click a word to set its</span>
                <button type="button" className={pickMode === "start" ? "on" : ""} onClick={() => setPickMode("start")} aria-pressed={pickMode === "start"} data-testid="storyboard-pick-start">start</button>
                <button type="button" className={pickMode === "end" ? "on" : ""} onClick={() => setPickMode("end")} aria-pressed={pickMode === "end"} data-testid="storyboard-pick-end">end</button>
                {spanChanged && <button type="button" onClick={() => patchDraft(slot, { span: null })} disabled={busy !== null} data-testid="storyboard-discard-span">Discard</button>}
              </span>
            </div>
            <p className="storyboard-block storyboard-passage" data-testid="storyboard-draft-narration">{passage}</p>
            {lines.map(line => <p key={line} className={judged?.ok === false ? "storyboard-message" : "storyboard-status muted"}>{line}</p>)}
            <div className="storyboard-label">Request</div>
            <textarea className="storyboard-request" value={draft.request} onChange={e => patchDraft(slot, { request: e.target.value })} rows={2} placeholder="Tell the AI what you want: “a close-up on her hands”, “she's older”." data-testid="storyboard-request" />
            <div className="storyboard-actions">
              <button type="button" onClick={() => { void generateDescription(); }} disabled={busy !== null} data-testid="storyboard-generate-description"
                title="A new description from the narration, the description in the draft, and the request">{busy === "describe" ? "Generating…" : "Generate description"}</button>
              <button type="button" onClick={() => { void generateDrawing(); }} disabled={busy !== null || drawingNow || text.trim() === ""} data-testid="storyboard-generate-drawing"
                title="A drawing of the description in the draft; it stays in the draft until you save">{busy === "draw" ? "Starting…" : "Generate drawing"}</button>
            </div>
            <div className="storyboard-label">
              Description{draft.text === null ? <span className="muted"> · same as current</span> : draft.source !== null && draft.source.text.trim() === text.trim() ? <span className="muted"> · by {draft.source.model}</span> : <span className="muted"> · edited</span>}
              {draft.text !== null && <button type="button" className="storyboard-discard" onClick={() => patchDraft(slot, { text: null, source: null })} disabled={busy !== null} data-testid="storyboard-discard-description">Discard</button>}
            </div>
            <textarea className="storyboard-text" value={text} onChange={e => patchDraft(slot, { text: e.target.value, source: draft.source })} rows={4} placeholder="What the camera sees: subject, action, setting, framing, light." data-testid="storyboard-text" />
            <div className="storyboard-label">
              Drawing{drawingDraft === undefined ? <span className="muted"> · {current === null || image === undefined ? "none yet" : "same as current"}</span> : <span className="muted"> · by {rendererLabel(drawingDraft.renderer)}</span>}
              {drawingDraft !== undefined && <button type="button" className="storyboard-discard" onClick={() => { void discardDrawing(slot); }} disabled={busy !== null} data-testid="storyboard-discard-drawing">Discard</button>}
            </div>
            <div className={`storyboard-drawing${drawingDraft === undefined && (image === undefined || drawingNow) ? " empty" : ""}`} data-testid="storyboard-draft-drawing">
              {drawingDraft !== undefined ? <img className="on-paper" src={drawingDraft.imageUrl} alt={drawingDraft.description} draggable={false} />
                : image !== undefined && !drawingNow ? <img className="on-paper unchanged" src={image} alt="The current drawing, unchanged" draggable={false} />
                : <p className="muted">{drawingNow ? "Drawing…" : "Generate a drawing from the description."}</p>}
            </div>
            {drawingDraft !== undefined && drawingDraft.description.trim() !== text.trim() && <p className="storyboard-status muted">Drawn from an earlier description: “{drawingDraft.description}”</p>}
            {draftJob !== undefined && (jobPending(draftJob) || draftJob.status === "failed") && <p className="storyboard-status muted" data-testid="storyboard-status">{jobLine(draftJob, now)}</p>}
            {message !== null && <p className={message.failed ? "storyboard-message" : "storyboard-status muted"} data-testid="storyboard-message">{message.text}</p>}
          </div>
        </div>
      )}
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
                {f.shot.imageUrl !== undefined ? <img className="on-paper" src={f.shot.imageUrl} alt="" draggable={false} loading="lazy" /> : <span className="storyboard-blank">{status === "running" ? "drawing" : status === "queued" ? "waiting" : "no drawing"}</span>}
                <span className="storyboard-strip-label"><span className="badge">{i + 1}</span> <span className="mono">{clock(f.startSample)}</span>{status === "running" && " ✎"}{status === "queued" && " …"}{status === "failed" && " ⚠"}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
