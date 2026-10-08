import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { judgeSpan, spanBounds, stationImage, versionsForShot } from "@animator/domain";
import { ApiError, type StationAction, type StationResponse, type StoryApi, type StoryboardFrame, type StoryboardJob, type StoryboardSnapshotResult, type StoryResponse, type Word } from "./api.js";
import { useViewPreference } from "./preferences.js";
import { cardImage, DEFAULT_DIRECTIONS, directorOf, EMPTY_STATION_DRAFT, isEmptyStationDraft, motionLabel, openVersion, parseDirectionCount, parseStationDrafts, type StationDraft, versionLabel } from "./station-view.js";
import { openingWords, spanLines } from "./storyboard-view.js";

type Props = {
  api: StoryApi;
  /** The shot the station works on: a storyboard frame's word, or the word a new shot is begun at. */
  slot: string;
  /** The frame as saved, or null while a new shot is begun. */
  current: StoryboardFrame | null;
  /** Where every shot the storyboard track shows starts: the shots a span may not swallow (A68). */
  trackStarts: ReadonlyArray<number>;
  /** The effective words sorted by start, and the transcript's element order for narration as written. */
  words: ReadonlyArray<Word>; elements: StoryResponse["elements"];
  station: StationResponse; jobs: ReadonlyArray<StoryboardJob>; now: number;
  /** Whether the narration is playing, so the play button can stop it. */
  playing: boolean;
  onPlaySpan: (startSample: number, endSample: number) => void; onStop: () => void;
  /** Something the station wrote: refetch the versions and images, and poll the drawings it started. */
  onStationChanged: () => void; onJobs: (started: ReadonlyArray<StoryboardJob>) => void;
  onSnapshot: (result: StoryboardSnapshotResult, moved: boolean) => void;
  /** Leave a new shot begun while a frame is shown, back to that frame. Null when there is nothing to go back to. */
  onCancel: (() => void) | null;
};

/** How many words around the span the narration picker offers, inside the span's bounds. */
const PICK_CONTEXT = 40;
const OPENING_WORDS = 6;
const describe = (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));
type Busy = StationAction["kind"] | "save" | "draw" | null;
const BUSY_LINES: Readonly<Record<NonNullable<Busy>, string>> = {
  describe: "Writing directions from your description… up to a minute.", mix: "Mixing the directions you chose…", edit: "Making the change you asked for…",
  pick: "Keeping the direction you picked…", motion: "Keeping the motion you chose…", save: "Saving the shot…", draw: "Starting the drawing…",
};

/**
 * The shot station (A69), the Storyboard section's working column: listen to the narration a shot covers, describe the picture you see in
 * your own words (typed, or pasted by a dictation app), and get several directions back, each a short description, an image prompt, and
 * motion, each drawn. Pick one, mix several, change one by saying what to change, or choose its motion: every step is a new version, kept
 * with its inputs, its parent, its directions, and their images, so any earlier version opens again as it was. The newest is open unless
 * another is chosen. A version of one drawn direction is saved as the shot's storyboard frame, over the span picked here (A68).
 */
export function Station({ api, slot, current, trackStarts, words, elements, station, jobs, now, playing, onPlaySpan, onStop, onStationChanged, onJobs, onSnapshot, onCancel }: Props) {
  const wordById = useMemo(() => new Map(words.map(w => [w.id, w] as const)), [words]);
  const wordIndex = useMemo(() => new Map(words.map((w, i) => [w.id, i] as const)), [words]);
  const elementIndex = useMemo(() => { const m = new Map<string, number>(); elements.forEach((e, i) => { if (e.kind === "word") m.set(e.id, i); }); return m; }, [elements]);
  const opening = (id: string) => openingWords(elements, wordById, id, OPENING_WORDS);

  /** What this browser keeps per shot: the description being written, what it revises, the span, and the version open. */
  const [drafts, setDrafts] = useViewPreference<Readonly<Record<string, StationDraft>>>(`storyboard.station.${api.storyId}`, {}, parseStationDrafts);
  const draft = drafts[slot] ?? EMPTY_STATION_DRAFT;
  const patchDraft = useCallback((patch: Partial<StationDraft>) => setDrafts(previous => {
    const { [slot]: before = EMPTY_STATION_DRAFT, ...rest } = previous;
    const next = { ...before, ...patch };
    return isEmptyStationDraft(next) ? rest : { ...rest, [slot]: next };
  }), [setDrafts, slot]);
  const [count, setCount] = useViewPreference("storyboard.station.directions", DEFAULT_DIRECTIONS, parseDirectionCount);

  // The span: what the frame covers now, how far it may reach, and what the next version and a save cover.
  const at = current?.startSample ?? wordById.get(slot)?.startSample ?? 0;
  const bounds = useMemo(() => spanBounds(words, trackStarts, at), [words, trackStarts, at]);
  const currentSpan = current === null || bounds === null ? null : { start: wordIndex.get(current.anchorWordId) ?? bounds.first, end: bounds.last };
  const defaultSpan = currentSpan ?? (bounds === null ? null : { start: wordIndex.get(slot) ?? bounds.first, end: bounds.last });
  const picked = draft.span === null ? undefined : { start: wordIndex.get(draft.span.startWordId), end: wordIndex.get(draft.span.endWordId) };
  const span = picked?.start !== undefined && picked.end !== undefined ? { start: picked.start, end: picked.end } : defaultSpan;
  const judged = span === null || bounds === null ? null : judgeSpan(bounds, currentSpan?.start ?? null, span.start, span.end);
  const spanChanged = span !== null && defaultSpan !== null && (span.start !== defaultSpan.start || span.end !== defaultSpan.end);
  const [pickMode, setPickMode] = useState<"start" | "end">("start");

  const versions = useMemo(() => versionsForShot(station.versions, slot), [station.versions, slot]);
  const numbers = useMemo(() => new Map(versions.map((v, i) => [v.id, i + 1] as const)), [versions]);
  const open = openVersion(versions, draft.open);
  const openNumber = open === null ? null : numbers.get(open.id)!;
  const director = open === null ? null : directorOf(station.versions, open);
  const revising = draft.from !== null && station.versions.some(v => v.id === draft.from) ? draft.from : null;

  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ readonly text: string; readonly failed: boolean } | null>(null);
  const [selected, setSelected] = useState<ReadonlyArray<number>>([]);
  const [instruction, setInstruction] = useState("");
  const [motion, setMotion] = useState("");
  useEffect(() => { setSelected(open?.directions.length === 1 ? [0] : []); setInstruction(""); setMotion(""); }, [open?.id]);
  const single = open !== null && open.directions.length === 1;

  const fail = (what: string, e: unknown) => setMessage({ text: `${what} failed. ${describe(e)}`, failed: true });
  /** Make a version from the open one (or a fresh description), then open it; its drawings are polled by the section. */
  const act = async (action: StationAction, parentId: string | null) => {
    if (span === null) return;
    setBusy(action.kind); setMessage(null);
    try {
      const { version, jobs: started } = await api.postStationVersion({ shotWordId: slot, startWordId: words[span.start]!.id, endWordId: words[span.end]!.id, parentId, action });
      onJobs(started);
      patchDraft({ open: version.id, ...(action.kind === "describe" ? { from: version.id } : {}) });
      onStationChanged();
      if (version.writer !== null) setMessage({ text: `Written by ${version.writer.model} in ${Math.round(version.writer.seconds)} s${started.length > 0 ? `; drawing ${started.length === 1 ? "it" : started.length === 2 ? "both" : `all ${started.length}`} now` : ""}.`, failed: false });
    } catch (e) { fail(action.kind === "describe" ? "Getting directions" : `The ${action.kind}`, e); }
    finally { setBusy(null); }
  };
  const describeShot = () => { const text = draft.director.trim(); if (text !== "") void act({ kind: "describe", director: text, count }, revising); };
  const change = () => {
    if (open === null) return;
    const said = instruction.trim();
    if (selected.length === 1 && said !== "") void act({ kind: "edit", direction: selected[0]!, instruction: said }, open.id);
    else if (selected.length > 1) void act({ kind: "mix", directions: [...selected].sort((a, b) => a - b), instruction: said }, open.id);
  };
  const redraw = async (versionId: string, direction: number) => {
    setBusy("draw"); setMessage(null);
    try { onJobs((await api.postStationDraw({ versionId, direction })).jobs); }
    catch (e) { fail("Drawing again", e); }
    finally { setBusy(null); }
  };

  // Saving: the open version when it is one drawn direction not already the frame's, and the span picked here.
  const openDrawn = open !== null && single && stationImage(station.versions, station.images, open.id, 0).status === "drawn";
  const isFrame = open !== null && current?.shot.stationVersionId === open.id;
  const savesVersion = openDrawn && !isFrame;
  const canSave = busy === null && judged?.ok === true && span !== null && (savesVersion || spanChanged || current === null);
  const saveLabel = savesVersion ? `Save v${openNumber} as the frame` : current === null ? "Save shot" : "Save span";
  const save = async () => {
    if (!canSave || span === null || judged === null || !judged.ok) return;
    setBusy("save"); setMessage(null);
    try {
      const result = await api.postStoryboardSnapshot({ frameWordId: current?.anchorWordId ?? null, startWordId: words[span.start]!.id, endWordId: words[span.end]!.id, versionId: savesVersion ? open!.id : null });
      patchDraft({ span: null });
      onSnapshot(result, judged.moved);
      setMessage({ text: savesVersion ? `Saved v${openNumber} as the frame.` : "Saved.", failed: false });
    } catch (e) { fail("Save", e); }
    finally { setBusy(null); }
  };

  /** Clicking a word sets the span's start, then its end; a span equal to the shot's own is no change. */
  const pick = (index: number) => {
    if (span === null || defaultSpan === null) return;
    const next = pickMode === "start" ? { start: index, end: Math.max(span.end, index) } : { start: Math.min(span.start, index), end: index };
    patchDraft({ span: next.start === defaultSpan.start && next.end === defaultSpan.end ? null : { startWordId: words[next.start]!.id, endWordId: words[next.end]!.id } });
    if (pickMode === "start") setPickMode("end");
  };
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
  const playSpan = () => { if (span !== null) onPlaySpan(words[span.start]!.startSample, words[span.end]!.endSample); };
  const onCommand = (run: () => void) => (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); } };

  /** One image opened large; closes on Escape, its backdrop, or its button. */
  const [large, setLarge] = useState<{ readonly url: string; readonly title: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (large !== null && !element.open) element.showModal();
    if (large === null && element.open) element.close();
  }, [large]);

  if (span === null) return <div className="storyboard-column station"><p className="muted">The transcript has no words to anchor a shot to.</p></div>;
  const toggle = (i: number) => setSelected(previous => (previous.includes(i) ? previous.filter(x => x !== i) : [...previous, i].sort((a, b) => a - b)));
  return (
    <div className="storyboard-column station" data-testid="station">
      <div className="storyboard-column-head">
        <h4 className="storyboard-heading">Shot station{current === null ? " · new shot" : ""}</h4>
        <span className="storyboard-actions">
          <button type="button" className="primary" onClick={() => { void save(); }} disabled={!canSave} data-testid="station-save"
            title={savesVersion ? "Save this version's image and description as the storyboard frame, over the narration picked here; nothing is overwritten" : "Save the narration picked here as the shot"}>{busy === "save" ? "Saving…" : saveLabel}</button>
          {onCancel !== null && <button type="button" onClick={onCancel} disabled={busy !== null} data-testid="station-cancel">Back to the frame</button>}
        </span>
      </div>

      <div className="storyboard-label">
        Narration{spanChanged && <span className="muted"> · changed</span>}
        <button type="button" className="station-play" onClick={playing ? onStop : playSpan} data-testid="station-play" title="Play the narration this shot covers, then come back">{playing ? "■ Stop" : "▶ Play"}</button>
        <span className="storyboard-pick" role="radiogroup" aria-label="Clicking a word sets">
          <span className="muted">click a word to set its</span>
          <button type="button" className={pickMode === "start" ? "on" : ""} onClick={() => setPickMode("start")} aria-pressed={pickMode === "start"} data-testid="station-pick-start">start</button>
          <button type="button" className={pickMode === "end" ? "on" : ""} onClick={() => setPickMode("end")} aria-pressed={pickMode === "end"} data-testid="station-pick-end">end</button>
          {spanChanged && <button type="button" onClick={() => patchDraft({ span: null })} disabled={busy !== null} data-testid="station-reset-span">Reset</button>}
        </span>
      </div>
      <p className="storyboard-block storyboard-passage" data-testid="station-narration">{passage}</p>
      {lines.map(line => <p key={line} className={judged?.ok === false ? "storyboard-message" : "storyboard-status muted"}>{line}</p>)}

      <div className="storyboard-label">
        Your description<span className="muted"> · what you see, typed or dictated{revising !== null && numbers.has(revising) ? ` · revises v${numbers.get(revising)}` : ""}</span>
        {(draft.director !== "" || revising !== null) && <button type="button" className="storyboard-discard" onClick={() => patchDraft({ director: "", from: null })} disabled={busy !== null} data-testid="station-clear">New description</button>}
      </div>
      <textarea className="station-director" value={draft.director} onChange={e => patchDraft({ director: e.target.value })} onKeyDown={onCommand(describeShot)} rows={3} data-testid="station-director"
        placeholder="Listen, then say what you see, in your own words: who is there, where the camera is, the light, what moves…" />
      <div className="storyboard-actions">
        <button type="button" className="primary" onClick={describeShot} disabled={busy !== null || draft.director.trim() === ""} data-testid="station-describe" title="Ask for directions from your description (⌘↵)">
          {busy === "describe" ? "Writing…" : `Get ${count} direction${count === 1 ? "" : "s"}`}</button>
        <label className="muted station-count">directions <select value={count} onChange={e => setCount(Number(e.target.value))} data-testid="station-count">{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      </div>

      {versions.length > 0 && (
        <div className="station-history" data-testid="station-history">
          <span className="storyboard-label">Versions</span>
          <ol>
            {versions.map((v, i) => {
              const thumb = v.directions.length === 0 ? null : cardImage(station.versions, station.images, jobs, v.id, 0, now);
              return (
                <li key={v.id}>
                  <button type="button" className={`station-version${v === open ? " open" : ""}${current?.shot.stationVersionId === v.id ? " framed" : ""}`} onClick={() => patchDraft({ open: v.id })} data-testid={`station-version-${i + 1}`}
                    title={`${versionLabel(v, versions)}${current?.shot.stationVersionId === v.id ? " (the frame now)" : ""}`}>
                    {thumb?.kind === "drawn" ? <img src={thumb.url} alt="" draggable={false} loading="lazy" /> : <span className="station-thumb-blank" />}
                    <span><b>v{i + 1}</b> {versionLabel(v, versions)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {open !== null && (
        <div className="station-version-view" data-testid="station-open">
          <p className="station-version-head">
            <b>v{openNumber}</b> · {versionLabel(open, versions)}
            {open.writer !== null && <span className="muted"> · by {open.writer.model} in {Math.round(open.writer.seconds)} s</span>}
            {open.parentId !== null && numbers.has(open.parentId) && <> · <button type="button" className="link" onClick={() => patchDraft({ open: open.parentId })} data-testid="station-parent">open v{numbers.get(open.parentId)}</button></>}
            {open !== versions.at(-1) && <> · <button type="button" className="link" onClick={() => patchDraft({ open: null })} data-testid="station-newest">newest</button></>}
            {isFrame && <span className="station-framed"> · the frame now</span>}
          </p>
          {open.action.kind === "describe" && director !== null && (
            <div className="station-said">
              <span className="muted">You said:</span> “{director.text}”
              <button type="button" className="link" onClick={() => patchDraft({ director: director.text, from: open.id })} disabled={busy !== null} data-testid="station-revise">edit this description</button>
            </div>
          )}
          <div className={`station-cards${single ? " single" : ""}`}>
            {open.directions.map((d, i) => {
              const image = cardImage(station.versions, station.images, jobs, open.id, i, now);
              const chosen = selected.includes(i);
              return (
                <article key={i} className={`station-card${chosen && !single ? " selected" : ""}`} data-testid={`station-card-${i + 1}`}>
                  <div className={`station-image${image.kind === "drawn" ? "" : " empty"}`}>
                    {image.kind === "drawn" ? <button type="button" className="station-image-open" onClick={() => setLarge({ url: image.url, title: d.title })} title="Open large"><img src={image.url} alt={d.description} draggable={false} /></button>
                      : image.kind === "drawing" ? <p className="muted" data-testid="station-drawing">{image.line}</p>
                      : <div className="station-image-missing" data-testid="station-missing">
                        <p className={image.kind === "failed" ? "storyboard-message" : "muted"}>{image.kind === "failed" ? image.line : "Not drawn: the drawing was interrupted."}</p>
                        <button type="button" onClick={() => { void redraw(open.id, i); }} disabled={busy !== null} data-testid={`station-redraw-${i + 1}`}>Draw again</button>
                      </div>}
                  </div>
                  <div className="station-card-text">
                    <h5>{!single && <span className="badge">{i + 1}</span>} {d.title}</h5>
                    <p>{d.description}</p>
                    <p className="muted station-motion">Motion: {motionLabel(d)}{image.kind === "drawn" && image.by !== null ? ` · drawn by ${image.by}` : ""}</p>
                    <details><summary className="muted">Image prompt</summary><p className="station-prompt">{d.prompt}</p></details>
                  </div>
                  {!single && (
                    <div className="storyboard-actions station-card-actions">
                      <button type="button" onClick={() => { void act({ kind: "pick", direction: i }, open.id); }} disabled={busy !== null} data-testid={`station-pick-${i + 1}`} title="Keep this direction as a version of its own, image and all">Pick</button>
                      <button type="button" className={chosen ? "on" : ""} onClick={() => toggle(i)} aria-pressed={chosen} data-testid={`station-select-${i + 1}`} title="Select it to change it, or select several to mix them">{chosen ? "Selected" : "Select"}</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div className="station-change" data-testid="station-change">
            <div className="storyboard-label">
              {single ? "Change it" : selected.length === 0 ? "Change or mix" : selected.length === 1 ? `Change ${selected[0]! + 1}` : `Mix ${selected.map(i => i + 1).join(" + ")}`}
              <span className="muted"> · {single ? "say what to change, and the rest stays: “make the sky red”, “closer on her hands”"
                : selected.length === 0 ? "select a direction to change it, or several to mix them" : selected.length === 1 ? "say what to change; the rest stays" : "say what to take from each, or leave it to the AI"}</span>
            </div>
            <textarea className="station-instruction" value={instruction} onChange={e => setInstruction(e.target.value)} onKeyDown={onCommand(change)} rows={2} disabled={!single && selected.length === 0} data-testid="station-instruction"
              placeholder={selected.length > 1 ? "“The light of 1 with the framing of 3”" : "“Make the sky red”"} />
            <div className="storyboard-actions">
              {selected.length <= 1
                ? <button type="button" className="primary" onClick={change} disabled={busy !== null || selected.length !== 1 || instruction.trim() === ""} data-testid="station-edit" title="A new version with the change made (⌘↵)">{busy === "edit" ? "Changing…" : "Make the change"}</button>
                : <button type="button" className="primary" onClick={change} disabled={busy !== null} data-testid="station-mix" title="A new version combining the ones selected (⌘↵)">{busy === "mix" ? "Mixing…" : `Mix ${selected.map(i => i + 1).join(" + ")}`}</button>}
            </div>
          </div>

          {single && (
            <div className="station-motion-choice" data-testid="station-motion">
              <div className="storyboard-label">Motion<span className="muted"> · now {motionLabel(open.directions[0]!)}; a choice is a new version with the same image</span></div>
              <div className="storyboard-actions">
                {[null, ...open.directions[0]!.motionOptions].map(option => (
                  <button type="button" key={option ?? "still"} className={`chip${open.directions[0]!.motion === option ? " on" : ""}`} onClick={() => { void act({ kind: "motion", motion: option }, open.id); }}
                    disabled={busy !== null || open.directions[0]!.motion === option} data-testid={`station-motion-${option ?? "still"}`}>{option ?? "still"}</button>
                ))}
              </div>
              <div className="station-motion-own">
                <input type="text" value={motion} onChange={e => setMotion(e.target.value)} onKeyDown={onCommand(() => { if (motion.trim() !== "") void act({ kind: "motion", motion: motion.trim() }, open.id); })}
                  placeholder="Or describe the movement: “drift down through the ice to his face”" data-testid="station-motion-text" />
                <button type="button" onClick={() => { void act({ kind: "motion", motion: motion.trim() }, open.id); }} disabled={busy !== null || motion.trim() === ""} data-testid="station-motion-set">Set motion</button>
              </div>
            </div>
          )}
          {!single && !savesVersion && <p className="muted storyboard-status">Pick a direction to save it as the frame.</p>}
        </div>
      )}
      {busy !== null && <p className="storyboard-status muted" data-testid="station-busy">{BUSY_LINES[busy]}</p>}
      {message !== null && <p className={message.failed ? "storyboard-message" : "storyboard-status muted"} data-testid="station-message">{message.text}</p>}
      <dialog ref={dialog} className="image-take-dialog" onClose={() => setLarge(null)} onClick={e => { if (e.target === e.currentTarget) setLarge(null); }} data-testid="station-dialog">
        {large !== null && (
          <figure>
            <img src={large.url} alt={large.title} draggable={false} />
            <figcaption><span className="muted">{large.title}</span><button type="button" className="detail-close" onClick={() => setLarge(null)} aria-label="Close" title="Close">×</button></figcaption>
          </figure>
        )}
      </dialog>
    </div>
  );
}
