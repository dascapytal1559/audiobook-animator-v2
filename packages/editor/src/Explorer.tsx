import { useEffect, useMemo, useState } from "react";
import { currentSections, resolveStoryMap } from "@animator/domain";
import type { ResolvedSection, ResolvedStoryMap, ResolvedSubject, SectionKind, ServedSubject, StoryResponse, SubjectKind, Word } from "./api.js";
import { splitRatio, useViewPreference } from "./preferences.js";
import type { MapState } from "./state.js";

type Props = { map: MapState; words: ReadonlyArray<Word>; elements: StoryResponse["elements"]; playhead: number; sampleRateHz: number; onSeek: (sample: number, andPlay: boolean) => void };
type Resolved = ResolvedStoryMap<ServedSubject>;
type Subject = ResolvedSubject<ServedSubject>;

const SUBJECT_GROUPS: ReadonlyArray<readonly [SubjectKind, string]> = [["character", "Characters"], ["location", "Locations"], ["object", "Objects"], ["motif", "Motifs"]];
const SECTION_LABELS: Readonly<Record<SectionKind, string>> = { act: "Act", chapter: "Chapter", scene: "Scene", beat: "Beat" };

/**
 * The story explorer (A62): the narration's structure on the left, its cast on the right, both resolved onto the words the timeline shows
 * (pending timing edits included) and both seeking the shared playhead. Read-only: the map file is written by agents and scripts.
 */
export function Explorer({ map, words, elements, playhead, sampleRateHz, onSeek }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Browser view preferences (see preferences.ts): how much of the explorer the structure column takes, and how much of the cast column the list keeps. */
  const [columnSplit, setColumnSplit] = useViewPreference("explorer.columnSplit", 0.6, splitRatio(0.6));
  const [castSplit, setCastSplit] = useViewPreference("explorer.castSplit", 0.5, splitRatio(0.5));
  const [dragging, setDragging] = useState<"x" | "y" | null>(null);
  /** Beats whose transcript passage is shown. */
  const [transcripts, setTranscripts] = useState<ReadonlySet<string>>(() => new Set());
  const elementIndex = useMemo(() => { const m = new Map<string, number>(); elements.forEach((e, i) => { if (e.kind === "word") m.set(e.id, i); }); return m; }, [elements]);
  const wordById = useMemo(() => new Map(words.map(w => [w.id, w] as const)), [words]);
  /** Sections whose children are shown. Collapsed by default so every act reads at a glance; the chain under the playhead opens itself. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const resolved = useMemo<Resolved | { error: string } | null>(() => {
    if (map.status !== "loaded" || words.length === 0) return null;
    try { return resolveStoryMap(map.map, words); }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  }, [map, words]);
  const current = useMemo(() => (resolved === null || "error" in resolved ? [] : currentSections(resolved.sections, playhead)), [resolved, playhead]);
  const leaf = current[current.length - 1]?.id ?? null;
  const chainKey = current.map(s => s.id).join("/");
  useEffect(() => {
    if (current.length === 0) return;
    setExpanded(previous => { const next = new Set(previous); for (const section of current) next.add(section.id); return next; });
  }, [chainKey]);
  useEffect(() => { if (leaf !== null) document.getElementById(`explorer-section-${leaf}`)?.scrollIntoView({ block: "nearest" }); }, [leaf, expanded]);
  const clock = (sample: number) => {
    const seconds = sample / Math.max(1, sampleRateHz);
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}`;
  };

  if (map.status === "loading") return <section className="explorer explorer-empty" data-testid="explorer"><p className="muted">Loading the story map…</p></section>;
  if (map.status === "absent") {
    return (
      <section className="explorer explorer-empty" data-testid="explorer">
        <p><strong>No story map yet.</strong></p>
        <p className="muted">An agent or script writes <span className="mono">story-map.json</span> in the story directory: the characters, locations, objects, and motifs with the words that mention them, and the acts and beats as word ranges. The explorer fills in as soon as the file exists.</p>
      </section>
    );
  }
  if (map.status === "error") return <section className="explorer explorer-empty" data-testid="explorer"><p className="error">Story map failed. {map.message}</p></section>;
  if (resolved === null) return <section className="explorer explorer-empty" data-testid="explorer"><p className="muted">Waiting for the transcript…</p></section>;
  if ("error" in resolved) return <section className="explorer explorer-empty" data-testid="explorer"><p className="error">Story map does not fit this transcript. {resolved.error}</p></section>;

  const byId = new Map(resolved.subjects.map(s => [s.id, s] as const));
  const selected = selectedId === null ? null : byId.get(selectedId) ?? null;
  const currentIds = new Set(current.map(s => s.id));
  const sectionById = new Map(resolved.sections.map(s => [s.id, s] as const));
  const parents = new Set(resolved.sections.flatMap(s => (s.parentId === null ? [] : [s.parentId])));
  const visible = (section: ResolvedSection): boolean => { for (let id = section.parentId; id !== null; id = sectionById.get(id)?.parentId ?? null) if (!expanded.has(id)) return false; return true; };
  const toggle = (id: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const childCount = (id: string) => resolved.sections.filter(s => s.parentId === id).length;
  const toggleTranscript = (id: string) => setTranscripts(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
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
  const chip = (subject: Subject) => (
    <button key={subject.id} type="button" className={`chip${subject.id === selectedId ? " on" : ""}`} onClick={() => setSelectedId(subject.id === selectedId ? null : subject.id)} title={subject.kind}>{subject.name}</button>
  );

  return (
    <section className={`explorer${dragging === null ? "" : ` dragging-${dragging}`}`} style={{ "--column-split": columnSplit, "--cast-split": castSplit } as React.CSSProperties} data-testid="explorer">
      <div className="explorer-structure">
        <div className="explorer-heading">
          <h2>Structure</h2>
          {parents.size > 0 && <span className="explorer-heading-actions">
            <button type="button" onClick={() => setExpanded(new Set(parents))} data-testid="expand-all">Expand all</button>
            <button type="button" onClick={() => setExpanded(new Set())} data-testid="collapse-all">Collapse all</button>
          </span>}
        </div>
        {resolved.sections.length === 0 && <p className="muted">The map names no sections.</p>}
        <ol className="sections">
          {resolved.sections.filter(visible).map(section => (
            <SectionRow key={section.id} section={section} current={currentIds.has(section.id)} leaf={section.id === leaf} clock={clock} onSeek={onSeek}
              children={parents.has(section.id) ? childCount(section.id) : null} expanded={expanded.has(section.id)} onToggle={() => toggle(section.id)}
              chips={section.subjectIds.flatMap(id => { const s = byId.get(id); return s === undefined ? [] : [chip(s)]; })}
              transcript={parents.has(section.id) ? null : transcripts.has(section.id) ? passage(section) : false} onToggleTranscript={() => toggleTranscript(section.id)} />
          ))}
        </ol>
      </div>
      <Divider axis="x" label="Resize structure and cast" onResize={setColumnSplit} onDragging={setDragging} />
      <div className="explorer-cast">
        <div className="cast-list">
        <h2>Cast</h2>
        {resolved.subjects.length === 0 && <p className="muted">The map names no subjects.</p>}
        {SUBJECT_GROUPS.map(([kind, label]) => {
          const group = resolved.subjects.filter(s => s.kind === kind);
          return group.length === 0 ? null : (
            <div key={kind} className="subject-group">
              <h3>{label}</h3>
              <ul className="subjects">
                {group.map(subject => (
                  <li key={subject.id}>
                    <button type="button" className={`subject-card${subject.id === selectedId ? " selected" : ""}`} onClick={() => setSelectedId(subject.id === selectedId ? null : subject.id)} data-testid={`subject-${subject.id}`}>
                      {subject.images?.[0] !== undefined ? <img className="subject-thumb" src={subject.images[0].url} alt={subject.images[0].role} /> : <div className="subject-thumb placeholder">no image</div>}
                      <span className="subject-name">{subject.name}</span>
                      <span className="muted">{subject.mentions.length} {subject.mentions.length === 1 ? "mention" : "mentions"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        </div>
        {selected !== null && <>
          <Divider axis="y" label="Resize cast list and detail" onResize={setCastSplit} onDragging={setDragging} />
          <div className="subject-detail" data-testid="subject-detail">
            <div className="explorer-heading">
              <h3>{selected.name} <span className="muted">· {selected.kind}</span></h3>
              <button type="button" className="detail-close" onClick={() => setSelectedId(null)} aria-label={`Close ${selected.name}`} data-testid="subject-close">×</button>
            </div>
            {selected.description !== undefined && <p className="subject-description">{selected.description}</p>}
            {selected.images !== undefined && selected.images.length > 0 && (
              <div className="subject-images">
                {selected.images.map((image, i) => <figure key={i}><img src={image.url} alt={image.role} /><figcaption>{image.role}</figcaption></figure>)}
              </div>
            )}
            <h4>Appears in</h4>
            {selected.sectionIds.length === 0 ? <p className="muted">No section holds a mention.</p> : (
              <div className="chips">
                {selected.sectionIds.flatMap(id => { const s = sectionById.get(id); return s === undefined ? [] : [
                  <button key={id} type="button" className={`chip${currentIds.has(id) ? " on" : ""}`} onClick={() => onSeek(s.startSample, false)}>{SECTION_LABELS[s.kind]} · {s.title}</button>]; })}
              </div>
            )}
            <h4>Mentions</h4>
            {selected.mentions.length === 0 ? <p className="muted">No mentions recorded.</p> : (
              <ol className="mentions">
                {selected.mentions.map((mention, i) => (
                  <li key={i}>
                    <button type="button" className={`mention${mention.startSample <= playhead && playhead < mention.endSample ? " current" : ""}`} onClick={() => onSeek(mention.startSample, false)}>
                      <span className="clock">{clock(mention.startSample)}</span>
                      <span className="quote">“{mention.text}”</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>}
      </div>
    </section>
  );
}

type DividerProps = { axis: "x" | "y"; label: string; onResize: (ratio: number) => void; onDragging: (axis: "x" | "y" | null) => void };
/** A drag handle between two panes. From press to release it reports the pointer's position as a fraction of the parent along `axis`, clamped so neither pane vanishes. */
function Divider({ axis, label, onResize, onDragging }: DividerProps) {
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const parent = e.currentTarget.parentElement!;
    const move = (ev: PointerEvent) => {
      const box = parent.getBoundingClientRect();
      const ratio = axis === "x" ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height;
      onResize(Math.min(0.85, Math.max(0.15, ratio)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop);
      onDragging(null);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop); window.addEventListener("pointercancel", stop);
    onDragging(axis);
  };
  return <div className={`divider divider-${axis}`} role="separator" aria-label={label} aria-orientation={axis === "x" ? "vertical" : "horizontal"} data-testid={`divider-${axis}`} onPointerDown={start} />;
}

type RowProps = {
  section: ResolvedSection; current: boolean; leaf: boolean; clock: (sample: number) => string; onSeek: Props["onSeek"];
  /** How many sections sit directly inside this one, or null for a leaf. */
  children: number | null; expanded: boolean; onToggle: () => void; chips: ReadonlyArray<React.ReactElement>;
  /** null: no transcript control (the section has children). false: collapsed. Otherwise the rendered passage. */
  transcript: ReadonlyArray<React.ReactElement> | null | false; onToggleTranscript: () => void;
};
function SectionRow({ section, current, leaf, clock, onSeek, children, expanded, onToggle, chips, transcript, onToggleTranscript }: RowProps) {
  return (
    <li id={`explorer-section-${section.id}`} className={`section${current ? " current" : ""}${leaf ? " current-leaf" : ""}`} style={{ "--depth": section.depth } as React.CSSProperties} data-testid={`section-${section.id}`}>
      <div className="section-row">
      {children === null ? <span className="section-spacer" /> : (
        <button type="button" className={`section-toggle${expanded ? " open" : ""}`} onClick={onToggle} aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} ${section.title}`} title={`${children} inside`}>
          <span className="chevron">▸</span>
        </button>
      )}
      <button type="button" className="section-head" onClick={() => onSeek(section.startSample, false)} title={`Seek to ${clock(section.startSample)}`}>
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
