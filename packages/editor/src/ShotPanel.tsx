import { useState, type ChangeEvent } from "react";
import { SHOT_MODES, type CandidateGroup, type EffectiveShot, type ShotMode, type StitchedEntry } from "./api.js";
import { MODE_COLORS, MODE_LABELS } from "./modes.js";
import { formatSampleClock } from "@animator/domain";

type ShotEntry = Extract<StitchedEntry, { kind: "shot" }>;
type Props = {
  entry: StitchedEntry | null; group: CandidateGroup | null; next: ShotEntry | null; sampleRateHz: number; playhead: number;
  aspect: { width: number; height: number }; busy: boolean;
  /** The word the current shot is anchored to (A51), resolved by the owner; null when the shot is not anchored. */
  anchorWord: { id: string; value: string } | null;
  onDetach: (id: string) => void;
  onSelect: (id: string) => void; onMode: (id: string, mode: ShotMode) => void; onNotes: (id: string, notes: string) => void; onHide: (id: string) => void;
  onAttachImage: (file: File) => void; onNewShot: () => void; onMergeNext: () => void; onAspect: (width: number, height: number) => void;
};

const ASPECTS: ReadonlyArray<{ label: string; width: number; height: number }> = [
  { label: "16:9", width: 16, height: 9 }, { label: "2.39:1", width: 239, height: 100 }, { label: "4:3", width: 4, height: 3 }, { label: "1:1", width: 1, height: 1 }, { label: "9:16", width: 9, height: 16 },
];

/** The shot under the playhead: its candidates, decision fields, and the actions that create records or hide them. */
export function ShotPanel(p: Props) {
  const shot = p.entry?.kind === "shot" ? p.entry : null;
  const [notesDraft, setNotesDraft] = useState<{ id: string; value: string } | null>(null);
  const aspectKey = ASPECTS.find(a => a.width === p.aspect.width && a.height === p.aspect.height)?.label ?? "custom";
  const onAspectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const preset = ASPECTS.find(a => a.label === e.target.value);
    if (preset) p.onAspect(preset.width, preset.height);
  };
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) p.onAttachImage(file);
    e.target.value = "";
  };
  const notesValue = shot === null ? "" : notesDraft?.id === shot.id ? notesDraft.value : (shot.notes ?? "");

  return (
    <aside className="panel" data-testid="shot-panel">
      <div className="panel-section panel-actions">
        <button type="button" onClick={p.onNewShot} disabled={p.busy} data-testid="new-shot">New shot at playhead</button>
        <button type="button" onClick={p.onMergeNext} disabled={p.busy || shot === null || p.next === null} title={p.next ? `Hide ${p.next.label ?? p.next.id}` : "No later shot"}>Merge with next</button>
        <label className="field-inline">Frame
          <select value={aspectKey} onChange={onAspectChange} data-testid="aspect-select">
            {ASPECTS.map(a => <option key={a.label} value={a.label}>{a.label}</option>)}
            {aspectKey === "custom" && <option value="custom">{p.aspect.width}:{p.aspect.height}</option>}
          </select>
        </label>
      </div>
      {shot === null ? (
        <div className="panel-section">
          <h2>{p.entry === null ? "Nothing loaded" : "Gap"}</h2>
          <p className="muted">{p.entry === null ? "The timeline has not loaded." : `No shot covers ${formatSampleClock(p.playhead, p.sampleRateHz)}. Add one at the playhead to fill the gap.`}</p>
        </div>
      ) : (
        <>
          <div className="panel-section">
            <h2 style={{ color: MODE_COLORS[shot.mode] }}>{shot.label ?? "Untitled shot"}</h2>
            <div className="muted mono">{shot.id}</div>
            <div className="muted">{formatSampleClock(shot.startSample, p.sampleRateHz)} → {formatSampleClock(shot.endSample, p.sampleRateHz)} · {shot.producer.name} {shot.producer.version}</div>
            {p.anchorWord !== null && (
              <div className="anchor-row" data-testid="anchor-row">
                <span className="muted">anchored to “{p.anchorWord.value}”</span>
                <button type="button" onClick={() => p.onDetach(shot.id)} disabled={p.busy} title="Keep the current start as a plain sample position" data-testid="detach-anchor">Detach</button>
              </div>
            )}
          </div>
          <div className="panel-section">
            <div className="field-label">Mode</div>
            <div className="mode-radios" role="radiogroup">
              {SHOT_MODES.map(mode => (
                <label key={mode} className="mode-radio" style={{ borderColor: MODE_COLORS[mode] }}>
                  <input type="radio" name="mode" value={mode} checked={shot.mode === mode} onChange={() => p.onMode(shot.id, mode)} />
                  {MODE_LABELS[mode]}
                </label>
              ))}
            </div>
          </div>
          <label className="panel-section field">
            <span className="field-label">Label <span className="muted">(from record)</span></span>
            <input type="text" value={shot.label ?? ""} readOnly />
          </label>
          <label className="panel-section field">
            <span className="field-label">Notes <span className="muted">(decision)</span></span>
            <textarea rows={3} value={notesValue} data-testid="notes"
              onFocus={() => setNotesDraft({ id: shot.id, value: shot.notes ?? "" })}
              onChange={e => { setNotesDraft({ id: shot.id, value: e.target.value }); p.onNotes(shot.id, e.target.value); }}
              onBlur={() => setNotesDraft(null)} />
          </label>
          <label className="panel-section field">
            <span className="field-label">Prompt <span className="muted">(from record)</span></span>
            <textarea rows={3} value={shot.prompt ?? ""} readOnly />
          </label>
          <div className="panel-section panel-actions">
            <label className="file-button">Attach image<input type="file" accept="image/*" onChange={onFile} disabled={p.busy} data-testid="attach-image" /></label>
            <button type="button" onClick={() => p.onHide(shot.id)} disabled={p.busy} data-testid="hide-shot">Hide this candidate</button>
          </div>
          <div className="panel-section">
            <div className="field-label">Candidates at this start ({p.group?.shots.length ?? 1})</div>
            <div className="candidates">
              {(p.group?.shots ?? [shot]).map(c => <Candidate key={c.id} shot={c} selected={c.id === shot.id} onSelect={() => p.onSelect(c.id)} />)}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

function Candidate({ shot, selected, onSelect }: { shot: EffectiveShot; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`candidate${selected ? " selected" : ""}${shot.hidden ? " hidden" : ""}`} onClick={onSelect} title={`${shot.id}\n${shot.createdAt}`} data-candidate-id={shot.id}>
      {shot.imageUrl !== undefined
        ? <img src={shot.imageUrl} alt={shot.label ?? shot.id} draggable={false} />
        : <div className="candidate-card" style={{ background: `${MODE_COLORS[shot.mode]}33`, color: MODE_COLORS[shot.mode] }}>{MODE_LABELS[shot.mode]}</div>}
      <span className="candidate-caption">{shot.hidden ? "hidden · " : selected ? "selected · " : ""}{shot.label ?? shot.id.slice(-6)}</span>
    </button>
  );
}
