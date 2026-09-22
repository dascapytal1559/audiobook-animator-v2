import { useEffect, useMemo, useRef, useState } from "react";
import type { ResolvedSection, SceneDescriptionTake, StitchedEntry, StoryResponse, Word } from "./api.js";
import { Divider } from "./Divider.js";
import { MapNotice } from "./MapNotice.js";
import { splitRatio, useViewPreference } from "./preferences.js";
import { SECTION_LABELS, clock as clipClock, currentChain, sceneShots, sceneToShow, type ImageTake, type MapView, type Resolved, type SceneShot } from "./story-map-view.js";

type Props = {
  view: MapView; words: ReadonlyArray<Word>; elements: StoryResponse["elements"]; playhead: number; sampleRateHz: number;
  /** Every track's stitched timeline (A60), which declares the shots (A65) and shows what each track holds in them, and the seek tolerance the preview uses. */
  stitched: ReadonlyArray<StitchedEntry>; tolerance: number;
  /** Every description take recorded for the story, each naming its shot's anchor word (A63, A65). */
  takes: ReadonlyArray<SceneDescriptionTake>;
  /** The subject a chip on a section row points at; the Cast & world section shows it. */
  selectedSubjectId: string | null; onSelectSubject: (id: string | null) => void;
  onSeek: (sample: number, andPlay: boolean) => void;
};

/** How many words of a shot's opening its heading quotes. */
const OPENING_WORDS = 6;
/** How much of the pane one arrow-key press on the divider moves it. */
const SPLIT_STEP = 0.02;

/**
 * The Scenes section (A62, A63): the narration's structure on the left, resolved onto the words the timeline shows (pending timing edits
 * included) and seeking the shared playhead; on the right, the detail of one scene. Clicking a section's title seeks to it and pins its
 * detail; until a click, the detail follows the innermost section under the playhead. What the scene looks like is shown shot by shot
 * (A65): the declared shots on screen during it, each with every image track's take and every description written for it, side by side,
 * none of them picked. The map only navigates; it declares no shot. Read-only: the map and the takes are written by agents and scripts.
 */
export function Scenes({ view, words, elements, playhead, sampleRateHz, stitched, tolerance, takes, selectedSubjectId, onSelectSubject, onSeek }: Props) {
  /** Browser view preference (see preferences.ts): how much of the section the structure column takes. The value saved under the explorer's old key is read until the first drag here. */
  const [columnSplit, setColumnSplit] = useViewPreference("scenes.columnSplit", 0.5, splitRatio(0.5), "explorer.columnSplit");
  const [dragging, setDragging] = useState(false);
  /** The scene whose detail is pinned, or null to follow the playhead. */
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  /** Beats whose transcript passage is unfolded in the structure column. */
  const [transcripts, setTranscripts] = useState<ReadonlySet<string>>(() => new Set());
  /** Sections whose children are shown. Collapsed by default so every act reads at a glance; the chain under the playhead opens itself. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const elementIndex = useMemo(() => { const m = new Map<string, number>(); elements.forEach((e, i) => { if (e.kind === "word") m.set(e.id, i); }); return m; }, [elements]);
  const wordById = useMemo(() => new Map(words.map(w => [w.id, w] as const)), [words]);
  const current = useMemo(() => currentChain(view, playhead), [view, playhead]);
  const leaf = current[current.length - 1]?.id ?? null;
  const chainKey = current.map(s => s.id).join("/");
  useEffect(() => {
    if (current.length === 0) return;
    setExpanded(previous => { const next = new Set(previous); for (const section of current) next.add(section.id); return next; });
  }, [chainKey]);
  useEffect(() => { if (leaf !== null) document.getElementById(`scene-row-${leaf}`)?.scrollIntoView({ block: "nearest" }); }, [leaf, expanded]);
  const clock = (sample: number) => clipClock(sample, sampleRateHz);

  const notice = <MapNotice view={view} testId="scenes" />;
  if (view.status !== "loaded") return notice;
  const resolved: Resolved = view.resolved;
  const byId = new Map(resolved.subjects.map(s => [s.id, s] as const));
  const currentIds = new Set(current.map(s => s.id));
  const sectionById = new Map(resolved.sections.map(s => [s.id, s] as const));
  const parents = new Set(resolved.sections.flatMap(s => (s.parentId === null ? [] : [s.parentId])));
  const shown = sceneToShow(resolved.sections, pinnedId, current);
  const visible = (section: ResolvedSection): boolean => { for (let id = section.parentId; id !== null; id = sectionById.get(id)?.parentId ?? null) if (!expanded.has(id)) return false; return true; };
  const toggle = (id: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const childCount = (id: string) => resolved.sections.filter(s => s.parentId === id).length;
  const toggleTranscript = (id: string) => setTranscripts(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  /** Seek to a section and pin its detail: one click does both, as the section's title promises. */
  const open = (section: ResolvedSection) => { setPinnedId(section.id); onSeek(section.startSample, false); };
  /** The section's words and the punctuation between them, in transcript order, so the passage reads as written (A61). */
  const passage = (section: ResolvedSection) => {
    const from = elementIndex.get(section.startWordId);
    const to = elementIndex.get(section.endWordId);
    if (from === undefined || to === undefined) return null;
    return elements.slice(from, to + 1).map((element, i) => {
      if (element.kind === "punctuation") return <span key={i}>{element.value}</span>;
      const word = wordById.get(element.id);
      if (word === undefined) return <span key={i}>{element.id}</span>;
      const current = word.startSample <= playhead && playhead < word.endSample;
      return <span key={i} className={`passage-word${current ? " current" : ""}`} onClick={() => onSeek(word.startSample, false)} role="button" tabIndex={-1}>{word.value}</span>;
    });
  };
  /** The first words spoken from a shot's anchor word, so a shot reads by where it begins. */
  const opening = (anchorWordId: string): string => {
    const from = elementIndex.get(anchorWordId);
    if (from === undefined) return anchorWordId;
    const said: string[] = [];
    for (let i = from; i < elements.length && said.length < OPENING_WORDS; i++) { const element = elements[i]!; if (element.kind === "word") said.push(wordById.get(element.id)?.value ?? element.id); }
    return said.join(" ");
  };
  const chip = (id: string) => {
    const subject = byId.get(id);
    return subject === undefined ? [] : [
      <button key={subject.id} type="button" className={`chip${subject.id === selectedSubjectId ? " on" : ""}`} onClick={() => onSelectSubject(subject.id === selectedSubjectId ? null : subject.id)} title={subject.kind}>{subject.name}</button>,
    ];
  };

  return (
    <section className={`scenes${dragging ? " dragging-x" : ""}`} style={{ "--column-split": columnSplit } as React.CSSProperties} data-testid="scenes">
      <div className="scenes-structure">
        {parents.size > 0 && <div className="map-heading">
          <span className="map-heading-actions">
            <button type="button" onClick={() => setExpanded(new Set(parents))} data-testid="expand-all">Expand all</button>
            <button type="button" onClick={() => setExpanded(new Set())} data-testid="collapse-all">Collapse all</button>
          </span>
        </div>}
        {resolved.sections.length === 0 && <p className="muted">The map names no sections.</p>}
        <ol className="sections">
          {resolved.sections.filter(visible).map(section => (
            <SectionRow key={section.id} section={section} current={currentIds.has(section.id)} leaf={section.id === leaf} shown={section.id === shown?.id} clock={clock} onOpen={() => open(section)}
              children={parents.has(section.id) ? childCount(section.id) : null} expanded={expanded.has(section.id)} onToggle={() => toggle(section.id)}
              chips={section.subjectIds.flatMap(chip)}
              transcript={parents.has(section.id) ? null : transcripts.has(section.id) ? passage(section) : false} onToggleTranscript={() => toggleTranscript(section.id)} />
          ))}
        </ol>
      </div>
      <Divider axis="x" label="Resize acts and scene" onDragging={axis => setDragging(axis !== null)} onDrag={(p, box) => setColumnSplit(splitRatio(columnSplit)((p.x - box.left) / box.width))} onStep={d => setColumnSplit(previous => splitRatio(previous)(previous + d * SPLIT_STEP))} />
      <div className="scene-detail" data-testid="scene-detail">
        {shown === null ? <p className="muted">Click an act or a beat to see the scene, or play: the detail follows the playhead.</p> : (
          <SceneDetail section={shown} pinned={pinnedId !== null} clock={clock} passage={passage(shown)} chips={shown.subjectIds.flatMap(chip)} shots={sceneShots(stitched, takes, shown, tolerance)} opening={opening} onSeek={sample => onSeek(sample, false)} onUnpin={() => setPinnedId(null)} />
        )}
      </div>
    </section>
  );
}

type DetailProps = {
  section: ResolvedSection; pinned: boolean; clock: (sample: number) => string; passage: ReadonlyArray<React.ReactElement> | null; chips: ReadonlyArray<React.ReactElement>;
  shots: ReadonlyArray<SceneShot>; opening: (anchorWordId: string) => string; onSeek: (sample: number) => void; onUnpin: () => void;
};
/**
 * One scene's detail: its heading, the subjects it mentions, its shots, and its transcript passage. Each shot (A65) is headed by where it
 * begins and shows what each source produced for it (A63): the image every track holds there, labelled by track, and every description
 * written for it, labelled by model, side by side and none of them picked. A place stays visible when it is empty, so the pane reads the
 * same before and after generation.
 */
function SceneDetail({ section, pinned, clock, passage, chips, shots, opening, onSeek, onUnpin }: DetailProps) {
  return (
    <>
      <div className="map-heading">
        <h3><span className="badge">{SECTION_LABELS[section.kind]}</span> {section.title} <span className="mono muted">{clock(section.startSample)}–{clock(section.endSample)}</span></h3>
        {pinned && <button type="button" className="detail-close" onClick={onUnpin} aria-label="Follow the playhead" title="Follow the playhead" data-testid="scene-unpin">×</button>}
      </div>
      {section.summary !== undefined && <p className="scene-summary">{section.summary}</p>}
      {chips.length > 0 && <div className="chips">{chips}</div>}
      {shots.map((shot, i) => (
        <section key={shot.anchorWordId ?? "opening"} className="scene-shot" data-testid={`scene-shot-${shot.anchorWordId ?? "opening"}`}>
          <h4>
            <button type="button" className="scene-shot-head" onClick={() => onSeek(Math.max(shot.startSample, section.startSample))} title={`Seek to ${clock(Math.max(shot.startSample, section.startSample))}`}>
              {shot.anchorWordId === null ? "Also on screen at the scene's start" : <>Shot {shots.slice(0, i + 1).filter(s => s.anchorWordId !== null).length} <span className="scene-shot-opening">“{opening(shot.anchorWordId)}…”</span></>}
            </button>
            {" "}<span className="mono muted">{clock(shot.startSample)}</span>
            {shot.anchorWordId !== null && shot.startSample < section.startSample && <span className="muted"> · holding since before the scene</span>}
            {shot.anchorWordId === null && <span className="muted"> · no declared shot</span>}
          </h4>
          <ShotTakes shot={shot} clock={clock} />
        </section>
      ))}
      <h4>Transcript <span className="muted">· {section.wordCount} words</span></h4>
      {passage === null ? <p className="muted">The passage is not in the transcript.</p> : <p className="passage" data-testid="scene-passage">{passage}</p>}
    </>
  );
}

/** One shot's takes: its image takes and its description takes side by side, each place visible and saying so when empty. */
function ShotTakes({ shot, clock }: { shot: SceneShot; clock: (sample: number) => string }) {
  const { images, descriptions } = shot;
  return (
    <div className="scene-look">
      <div className={`scene-images${images.length === 0 ? " placeholder" : ""}`} data-testid="scene-images">
        <h5>Images <span className="muted">· {images.length === 0 ? "none" : `${images.length} ${images.length === 1 ? "take" : "takes"}`}</span></h5>
        {images.length === 0 ? <p className="muted">{shot.anchorWordId === null ? `No image track holds a shot at ${clock(shot.startSample)}.` : "No image track starts a shot here."}</p> : <ImageGallery takes={images} from={shot.startSample} clock={clock} />}
      </div>
      <div className={`scene-descriptions${descriptions.length === 0 ? " placeholder" : ""}`} data-testid="scene-descriptions">
        <h5>Descriptions <span className="muted">· {descriptions.length === 0 ? "none" : `${descriptions.length} ${descriptions.length === 1 ? "take" : "takes"}`}</span></h5>
        {descriptions.length === 0 ? <p className="muted">{shot.anchorWordId === null ? "A description names a declared shot; none starts here." : "No description has been written for this shot."}</p> : descriptions.map(take => (
          <article key={take.id} className="description-take" data-testid={`description-take-${take.id}`}>
            <h6><span className="take-label">{take.model}</span> <span className="mono muted" title={take.createdAt}>{take.createdAt.slice(0, 10)}</span></h6>
            <p className="take-text">{take.text}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

type GalleryProps = { takes: ReadonlyArray<ImageTake>; from: number; clock: (sample: number) => string };
/** The image takes as thumbnails, one per track; clicking one opens it large in a dialog that closes on Escape, its backdrop, or its own button. */
function ImageGallery({ takes, from, clock }: GalleryProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const open = takes.find(take => take.shot.id === openId) ?? null;
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open !== null && !element.open) element.showModal();
    if (open === null && element.open) element.close();
  }, [open]);
  return (
    <>
      <div className="image-takes">
        {takes.map(({ trackId, shot }) => (
          <figure key={shot.id} className="image-take" data-testid={`image-take-${trackId}`}>
            <button type="button" className="image-take-open" onClick={() => setOpenId(shot.id)} title={`Open ${shot.label ?? shot.id} large`} aria-label={`Open the ${trackId} take large`}>
              <img src={shot.imageUrl} alt={shot.label ?? shot.id} draggable={false} loading="lazy" />
            </button>
            <figcaption>
              <span className="take-label">{trackId}</span>
              {shot.label !== undefined && <span className="muted image-take-title" title={shot.label}>{shot.label}</span>}
              {shot.startSample < from && <span className="mono muted" title="This image started earlier and is still holding.">holding since {clock(shot.startSample)}</span>}
            </figcaption>
          </figure>
        ))}
      </div>
      <dialog ref={dialog} className="image-take-dialog" onClose={() => setOpenId(null)} onClick={e => { if (e.target === e.currentTarget) setOpenId(null); }} data-testid="image-take-dialog">
        {open !== null && (
          <figure>
            <img src={open.shot.imageUrl} alt={open.shot.label ?? open.shot.id} draggable={false} />
            <figcaption><span className="take-label">{open.trackId}</span> {open.shot.label !== undefined && <span className="muted">{open.shot.label}</span>}
              <button type="button" className="detail-close" onClick={() => setOpenId(null)} aria-label="Close" title="Close">×</button></figcaption>
          </figure>
        )}
      </dialog>
    </>
  );
}

type RowProps = {
  section: ResolvedSection; current: boolean; leaf: boolean; shown: boolean; clock: (sample: number) => string; onOpen: () => void;
  /** How many sections sit directly inside this one, or null for a leaf. */
  children: number | null; expanded: boolean; onToggle: () => void; chips: ReadonlyArray<React.ReactElement>;
  /** null: no transcript control (the section has children). false: collapsed. Otherwise the rendered passage. */
  transcript: ReadonlyArray<React.ReactElement> | null | false; onToggleTranscript: () => void;
};
function SectionRow({ section, current, leaf, shown, clock, onOpen, children, expanded, onToggle, chips, transcript, onToggleTranscript }: RowProps) {
  return (
    <li id={`scene-row-${section.id}`} className={`section${current ? " current" : ""}${leaf ? " current-leaf" : ""}${shown ? " shown" : ""}`} style={{ "--depth": section.depth } as React.CSSProperties} data-testid={`section-${section.id}`}>
      <div className="section-row">
      {children === null ? <span className="section-spacer" /> : (
        <button type="button" className={`section-toggle${expanded ? " open" : ""}`} onClick={onToggle} aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} ${section.title}`} title={`${children} inside`}>
          <span className="chevron">▸</span>
        </button>
      )}
      <button type="button" className="section-head" onClick={onOpen} title={`Show this scene and seek to ${clock(section.startSample)}`} aria-current={shown ? "true" : undefined}>
        <span className="badge">{SECTION_LABELS[section.kind]}</span>
        <span className="section-title">{section.title}</span>
        <span className="mono muted">{clock(section.startSample)}–{clock(section.endSample)}</span>
        {children !== null && !expanded && <span className="muted section-count">{children} {children === 1 ? "beat" : "beats"}</span>}
      </button>
      </div>
      {section.summary !== undefined && <p className="section-summary">{section.summary}</p>}
      {chips.length > 0 && (children === null || expanded) && <div className="chips">{chips}</div>}
      {transcript !== null && (
        <div className="section-transcript">
          <button type="button" className={`transcript-toggle${transcript !== false ? " open" : ""}`} onClick={onToggleTranscript} aria-expanded={transcript !== false} data-testid={`transcript-${section.id}`}>
            <span className="chevron">▸</span> Transcript <span className="muted">· {section.wordCount} words</span>
          </button>
          {transcript !== false && <p className="passage">{transcript}</p>}
        </div>
      )}
    </li>
  );
}
