import { useState } from "react";
import type { ResolvedSubject, ServedSubject, SubjectKind } from "./api.js";
import { Divider } from "./Divider.js";
import { MapNotice } from "./MapNotice.js";
import { splitRatio, useViewPreference } from "./preferences.js";
import { SECTION_LABELS, clock as clipClock, currentChain, type MapView } from "./story-map-view.js";

type Props = {
  view: MapView; playhead: number; sampleRateHz: number;
  /** The subject whose detail is open; the owner keeps it so a chip in the Scenes section can open one here too. */
  selectedId: string | null; onSelect: (id: string | null) => void;
  onSeek: (sample: number, andPlay: boolean) => void;
};
type Subject = ResolvedSubject<ServedSubject>;

const SUBJECT_GROUPS: ReadonlyArray<readonly [SubjectKind, string]> = [["character", "Characters"], ["location", "Locations"], ["object", "Objects"], ["motif", "Motifs"]];
/** How much of the pane one arrow-key press on the divider moves it. */
const SPLIT_STEP = 0.02;

/**
 * The Cast & world section (A62, A63): the map's subjects grouped by kind with their first image on the left; the selected subject's
 * detail, with its description, images, the sections it appears in, and every mention, on the right, each seeking the shared playhead.
 * The list owns the section until a subject is selected. Read-only: the map file is written by agents and scripts.
 */
export function Cast({ view, playhead, sampleRateHz, selectedId, onSelect, onSeek }: Props) {
  /** Browser view preference (see preferences.ts): how much of the section the list keeps once a detail is open. */
  const [columnSplit, setColumnSplit] = useViewPreference("cast.columnSplit", 0.5, splitRatio(0.5));
  const [dragging, setDragging] = useState(false);
  const clock = (sample: number) => clipClock(sample, sampleRateHz);

  const notice = <MapNotice view={view} testId="cast" />;
  if (view.status !== "loaded") return notice;
  const { subjects, sections } = view.resolved;
  const selected = selectedId === null ? null : subjects.find(s => s.id === selectedId) ?? null;
  const sectionById = new Map(sections.map(s => [s.id, s] as const));
  const currentIds = new Set(currentChain(view, playhead).map(s => s.id));
  const pick = (subject: Subject) => onSelect(subject.id === selectedId ? null : subject.id);

  return (
    <section className={`cast${dragging ? " dragging-x" : ""}`} style={{ "--column-split": columnSplit } as React.CSSProperties} data-testid="cast">
      <div className="cast-list">
        {subjects.length === 0 && <p className="muted">The map names no subjects.</p>}
        {SUBJECT_GROUPS.map(([kind, label]) => {
          const group = subjects.filter(s => s.kind === kind);
          return group.length === 0 ? null : (
            <div key={kind} className="subject-group">
              <h3>{label}</h3>
              <ul className="subjects">
                {group.map(subject => (
                  <li key={subject.id}>
                    <button type="button" className={`subject-card${subject.id === selectedId ? " selected" : ""}`} onClick={() => pick(subject)} data-testid={`subject-${subject.id}`}>
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
        <Divider axis="x" label="Resize cast list and detail" onDragging={axis => setDragging(axis !== null)} onDrag={(p, box) => setColumnSplit(splitRatio(columnSplit)((p.x - box.left) / box.width))} onStep={d => setColumnSplit(previous => splitRatio(previous)(previous + d * SPLIT_STEP))} />
        <div className="subject-detail" data-testid="subject-detail">
          <div className="map-heading">
            <h3>{selected.name} <span className="muted">· {selected.kind}</span></h3>
            <button type="button" className="detail-close" onClick={() => onSelect(null)} aria-label={`Close ${selected.name}`} data-testid="subject-close">×</button>
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
    </section>
  );
}
