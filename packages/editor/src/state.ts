/** Editor state: loaded story and timeline, the locally edited decisions overlay, save status, and client-only playback state. */
import type { Decisions, DecisionsBody, ShotDecision, ShotRecord, StoryResponse, TimelineResponse, TimelineSettings } from "./api.js";
import type { SnapTarget } from "./snap.js";

export type SaveStatus = "saved" | "saving" | "error";
/** Client-only (Q16). Never sent to the server. `null` bounds mean clip start/end. */
export type WorkingRegion = { readonly enabled: boolean; readonly inSample: number | null; readonly outSample: number | null };
/** A decision patch; an explicit `undefined` removes that override. */
export type DecisionPatch = { [K in keyof ShotDecision]?: ShotDecision[K] | undefined };
export type Drag = { readonly id: string; readonly originalStart: number; readonly currentStart: number; readonly snap: SnapTarget | null };

export type EditorState = {
  readonly story: StoryResponse | null;
  readonly records: ReadonlyArray<ShotRecord>;
  readonly planningDirectory: string | null;
  readonly serverDecisions: Decisions | null;
  /** Local overlay. Equals the server's body whenever `editVersion === savedVersion`. */
  readonly decisions: DecisionsBody;
  readonly editVersion: number;
  readonly savedVersion: number;
  readonly saveNonce: number;
  readonly save: { readonly status: SaveStatus; readonly message?: string };
  readonly working: WorkingRegion;
  readonly loop: boolean;
  readonly follow: boolean;
  readonly playhead: number;
  readonly playing: boolean;
  readonly drag: Drag | null;
  readonly error: string | null;
};

export const DEFAULT_SETTINGS: TimelineSettings = { frameAspect: { width: 16, height: 9 } };

export const initialState: EditorState = {
  story: null, records: [], planningDirectory: null, serverDecisions: null,
  decisions: { settings: DEFAULT_SETTINGS, shots: {} }, editVersion: 0, savedVersion: 0, saveNonce: 0, save: { status: "saved" },
  working: { enabled: false, inSample: null, outSample: null }, loop: false, follow: true, playhead: 0, playing: false, drag: null, error: null,
};

export type Action =
  | { type: "story-loaded"; story: StoryResponse }
  | { type: "timeline-loaded"; timeline: TimelineResponse }
  | { type: "record-added"; record: ShotRecord }
  | { type: "save-started"; version: number }
  | { type: "save-succeeded"; version: number; timeline: TimelineResponse }
  | { type: "save-failed"; message: string }
  | { type: "save-requested" }
  | { type: "shot-edited"; id: string; patch: DecisionPatch }
  | { type: "shot-selected"; id: string; groupIds: ReadonlyArray<string> }
  | { type: "shots-hidden"; ids: ReadonlyArray<string> }
  | { type: "shot-moved"; id: string; startSample: number }
  | { type: "aspect-set"; width: number; height: number }
  | { type: "working-set-in" } | { type: "working-set-out" } | { type: "working-toggle" } | { type: "working-clear" }
  | { type: "loop-toggle" } | { type: "follow-toggle" }
  | { type: "playhead-set"; sample: number }
  | { type: "playing-set"; playing: boolean }
  | { type: "drag-start"; id: string; startSample: number }
  | { type: "drag-move"; startSample: number; snap: SnapTarget | null }
  | { type: "drag-end" } | { type: "drag-cancel" }
  | { type: "error"; message: string } | { type: "error-clear" };

export function reduce(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "story-loaded": return { ...state, story: action.story };
    case "timeline-loaded": return adoptTimeline(state, action.timeline, state.editVersion === state.savedVersion);
    case "record-added":
      return state.records.some(r => r.id === action.record.id) ? state : { ...state, records: [...state.records, action.record] };
    case "save-started": return { ...state, save: { status: "saving" } };
    case "save-succeeded": {
      const next = adoptTimeline({ ...state, savedVersion: action.version }, action.timeline, action.version === state.editVersion);
      return { ...next, save: { status: "saved" } };
    }
    case "save-failed": return { ...state, save: { status: "error", message: action.message } };
    case "save-requested": return { ...state, saveNonce: state.saveNonce + 1 };
    case "shot-edited": return edit(state, { [action.id]: applyPatch(state.decisions.shots[action.id] ?? {}, action.patch) });
    case "shot-selected": {
      const shots: Record<string, ShotDecision> = {};
      for (const id of action.groupIds) {
        const current = state.decisions.shots[id] ?? {};
        shots[id] = id === action.id ? applyPatch(current, { selected: true, hidden: undefined }) : applyPatch(current, { selected: undefined });
      }
      return edit(state, shots);
    }
    case "shots-hidden": {
      const shots: Record<string, ShotDecision> = {};
      for (const id of action.ids) shots[id] = applyPatch(state.decisions.shots[id] ?? {}, { hidden: true, selected: undefined });
      return edit(state, shots);
    }
    case "shot-moved": {
      const record = state.records.find(r => r.id === action.id);
      const patch: DecisionPatch = record !== undefined && record.startSample === action.startSample ? { startSample: undefined } : { startSample: action.startSample };
      return edit(state, { [action.id]: applyPatch(state.decisions.shots[action.id] ?? {}, patch) });
    }
    case "aspect-set": {
      if (!isPositiveInt(action.width) || !isPositiveInt(action.height)) return state;
      return bump({ ...state, decisions: { ...state.decisions, settings: { frameAspect: { width: action.width, height: action.height } } } });
    }
    case "working-set-in": {
      const out = state.working.outSample !== null && state.working.outSample <= state.playhead ? null : state.working.outSample;
      return { ...state, working: { ...state.working, inSample: state.playhead, outSample: out } };
    }
    case "working-set-out": {
      const inSample = state.working.inSample !== null && state.working.inSample >= state.playhead ? null : state.working.inSample;
      return { ...state, working: { ...state.working, inSample, outSample: state.playhead } };
    }
    case "working-toggle": return { ...state, working: { ...state.working, enabled: !state.working.enabled } };
    case "working-clear": return { ...state, working: { enabled: false, inSample: null, outSample: null } };
    case "loop-toggle": return { ...state, loop: !state.loop };
    case "follow-toggle": return { ...state, follow: !state.follow };
    case "playhead-set": return state.playhead === action.sample ? state : { ...state, playhead: action.sample };
    case "playing-set": return state.playing === action.playing ? state : { ...state, playing: action.playing };
    case "drag-start": return { ...state, drag: { id: action.id, originalStart: action.startSample, currentStart: action.startSample, snap: null } };
    case "drag-move": return state.drag === null ? state : { ...state, drag: { ...state.drag, currentStart: action.startSample, snap: action.snap } };
    case "drag-end": {
      if (state.drag === null) return state;
      const { id, originalStart, currentStart } = state.drag;
      const cleared = { ...state, drag: null };
      return currentStart === originalStart ? cleared : reduce(cleared, { type: "shot-moved", id, startSample: currentStart });
    }
    case "drag-cancel": return { ...state, drag: null };
    case "error": return { ...state, error: action.message };
    case "error-clear": return { ...state, error: null };
  }
}

/** Takes records and identity from the server; adopts its decisions only when nothing local is unsaved. Local decisions are pruned to known ids. */
function adoptTimeline(state: EditorState, timeline: TimelineResponse, adoptDecisions: boolean): EditorState {
  const known = new Set(timeline.records.map(r => r.id));
  const decisions: DecisionsBody = adoptDecisions
    ? { settings: timeline.decisions.settings, shots: { ...timeline.decisions.shots } }
    : { settings: state.decisions.settings, shots: Object.fromEntries(Object.entries(state.decisions.shots).filter(([id]) => known.has(id))) };
  return { ...state, records: timeline.records, planningDirectory: timeline.planningDirectory, serverDecisions: timeline.decisions, decisions };
}

function edit(state: EditorState, shots: Record<string, ShotDecision>): EditorState {
  const merged = { ...state.decisions.shots };
  for (const [id, decision] of Object.entries(shots)) {
    if (Object.keys(decision).length === 0) delete merged[id];
    else merged[id] = decision;
  }
  return bump({ ...state, decisions: { ...state.decisions, shots: merged } });
}

/** Every local edit bumps the version. A new edit after a failed save clears the error so the debounce retries once. */
const bump = (state: EditorState): EditorState =>
  ({ ...state, editVersion: state.editVersion + 1, save: state.save.status === "error" ? { status: "saved" } : state.save });

/** Applies a patch; `undefined` removes the key, and an empty notes string removes the notes override (the schema requires non-empty text). */
export function applyPatch(current: ShotDecision, patch: DecisionPatch): ShotDecision {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || (key === "notes" && typeof value === "string" && value.trim() === "")) delete next[key];
    else next[key] = value;
  }
  return next as ShotDecision;
}

const isPositiveInt = (n: number) => Number.isInteger(n) && n > 0;

export const isDirty = (state: EditorState) => state.editVersion !== state.savedVersion;

/** Decisions as they should render: the in-progress drag is overlaid without being committed. */
export function decisionsForView(state: EditorState): DecisionsBody {
  if (state.drag === null) return state.decisions;
  const { id, currentStart } = state.drag;
  return { ...state.decisions, shots: { ...state.decisions.shots, [id]: { ...(state.decisions.shots[id] ?? {}), startSample: currentStart } } };
}

/** Effective [start, end) of the working region when enabled, else null. */
export function workingBounds(state: EditorState, sampleCount: number): { start: number; end: number } | null {
  if (!state.working.enabled) return null;
  const start = state.working.inSample ?? 0;
  const end = state.working.outSample ?? sampleCount;
  return end > start ? { start, end } : null;
}
