import { useEffect, useMemo, useState } from "react";
import type { ResolvedSection, StoryResponse, Word } from "./api.js";
import { Divider } from "./Divider.js";
import { MapNotice } from "./MapNotice.js";
import { splitRatio, useViewPreference } from "./preferences.js";
import { SECTION_LABELS, clock as clipClock, currentChain, sceneToShow, type MapView, type Resolved } from "./story-map-view.js";

type Props = {
  view: MapView; words: ReadonlyArray<Word>; elements: StoryResponse["elements"]; playhead: number; sampleRateHz: number;
  /** The subject a chip on a section row points at; the Cast & world section shows it. */
  selectedSubjectId: string | null; onSelectSubject: (id: string | null) => void;
  onSeek: (sample: number, andPlay: boolean) => void;
};

/** How much of the pane one arrow-key press on the divider moves it. */
const SPLIT_STEP = 0.02;

/**
 * The Scenes section (A62, A63): the narration's structure on the left, resolved onto the words the timeline shows (pending timing edits
 * included) and seeking the shared playhead; on the right, the detail of one scene. Clicking a section's title seeks to it and pins its
 * detail; until a click, the detail follows the innermost section under the playhead. The description and image of a scene are places
 * for a later generator to fill; this section only lays them out. Read-only: the map file is written by agents and scripts.
 */
export function Scenes({ view, words, elements, playhead, sampleRateHz, selectedSubjectId, onSelectSubject, onSeek }: Props) {
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
  const chip = (id: string) => {
    const subject = byId.get(id);
    return subject === undefined ? [] : [
      <button key={subject.id} type="button" className={`chip${subject.id === selectedSubjectId ? " on" : ""}`} onClick={() => onSelectSubject(subject.id === selectedSubjectId ? null : subject.id)} title={subject.kind}>{subject.name}</button>,
    ];
  };

  return (
    <section className={`scenes${dragging ? " dragging-x" : ""}`} style={{ "--column-split": columnSplit } as React.CSSProperties} data-testid="scenes">
      <div className="scenes-structure">
        <div className="map-heading">
          <h2>Structure</h2>
          {parents.size > 0 && <span className="map-heading-actions">
            <button type="button" onClick={() => setExpanded(new Set(parents))} data-testid="expand-all">Expand all</button>
            <button type="button" onClick={() => setExpanded(new Set())} data-testid="collapse-all">Collapse all</button>
          </span>}
        </div>
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
      <Divider axis="x" label="Resize structure and scene" onDragging={axis => setDragging(axis !== null)} onDrag={(p, box) => setColumnSplit(splitRatio(columnSplit)((p.x - box.left) / box.width))} onStep={d => setColumnSplit(previous => splitRatio(previous)(previous + d * SPLIT_STEP))} />
      <div className="scene-detail" data-testid="scene-detail">
        {shown === null ? <p className="muted">Click an act or a beat to see the scene, or play: the detail follows the playhead.</p> : (
          <SceneDetail section={shown} pinned={pinnedId !== null} clock={clock} passage={passage(shown)} chips={shown.subjectIds.flatMap(chip)} onUnpin={() => setPinnedId(null)} />
        )}
      </div>
    </section>
  );
}

type DetailProps = { section: ResolvedSection; pinned: boolean; clock: (sample: number) => string; passage: ReadonlyArray<React.ReactElement> | null; chips: ReadonlyArray<React.ReactElement>; onUnpin: () => void };
/**
 * One scene's detail: its heading, the subjects it mentions, what it looks like, and its transcript passage. The description and image
 * are not generated yet; their places are laid out so a later generator's output drops in without a redesign.
 */
function SceneDetail({ section, pinned, clock, passage, chips, onUnpin }: DetailProps) {
  return (
    <>
      <div className="map-heading">
        <h3><span className="badge">{SECTION_LABELS[section.kind]}</span> {section.title} <span className="mono muted">{clock(section.startSample)}–{clock(section.endSample)}</span></h3>
        {pinned && <button type="button" className="detail-close" onClick={onUnpin} aria-label="Follow the playhead" title="Follow the playhead" data-testid="scene-unpin">×</button>}
      </div>
      {section.summary !== undefined && <p className="scene-summary">{section.summary}</p>}
      {chips.length > 0 && <div className="chips">{chips}</div>}
      <div className="scene-look">
        <div className="scene-image placeholder" data-testid="scene-image">
          <h4>Image</h4>
          <p className="muted">Not generated yet.</p>
        </div>
        <div className="scene-description placeholder" data-testid="scene-description">
          <h4>Description</h4>
          <p className="muted">Not generated yet. What the scene looks like will be written here.</p>
        </div>
      </div>
      <h4>Transcript <span className="muted">· {section.wordCount} words</span></h4>
      {passage === null ? <p className="muted">The passage is not in the transcript.</p> : <p className="passage" data-testid="scene-passage">{passage}</p>}
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
