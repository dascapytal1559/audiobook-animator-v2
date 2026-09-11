/**
 * Editor state: loaded story and timeline, the locally edited decisions overlay, the locally edited word-timing overlay with its undo
 * stack (A41), the word selection (A38), save status, and client-only playback state.
 */
import { DEFAULT_SETTINGS } from "@animator/domain";
import type { AlignReport, Decisions, DecisionsBody, ShotDecision, ShotRecord, StoryResponse, TimelineResponse, Word } from "./api.js";
import { selectedRange, type Selection } from "./selection.js";
import type { SnapTarget } from "./snap.js";
import { clampDelta, effectiveWords, manualMapOf, moveWords, shiftedWords, type ManualMap } from "./timing.js";

export type SaveStatus = "saved" | "saving" | "error";
/** Client-only (Q16). Never sent to the server. `null` bounds mean clip start/end. */
export type WorkingRegion = { readonly enabled: boolean; readonly inSample: number | null; readonly outSample: number | null };
/** A decision patch; an explicit `undefined` removes that override. */
export type DecisionPatch = { [K in keyof ShotDecision]?: ShotDecision[K] | undefined };
export type Drag = { readonly id: string; readonly originalStart: number; readonly currentStart: number; readonly snap: SnapTarget | null };
/** A group move in progress: the sample delta applied to every selected word, already snapped and clamped. */
export type WordDrag = { readonly delta: number; readonly snap: SnapTarget | null };

export type EditorState = {
  readonly story: StoryResponse | null;
  readonly records: ReadonlyArray<ShotRecord>;
  readonly storyDirectory: string | null;
  readonly serverDecisions: Decisions | null;
  /** Local overlay. Equals the server's body whenever `editVersion === savedVersion`. */
  readonly decisions: DecisionsBody;
  readonly editVersion: number;
  readonly savedVersion: number;
  readonly saveNonce: number;
  readonly save: { readonly status: SaveStatus; readonly message?: string };
  /** Local manual word-timing overlay (A36, A42). Equals the story's manual layer whenever `timingEditVersion === timingSavedVersion`. */
  readonly manual: ManualMap;
  readonly timingPast: ReadonlyArray<ManualMap>;
  readonly timingFuture: ReadonlyArray<ManualMap>;
  readonly timingEditVersion: number;
  readonly timingSavedVersion: number;
  readonly selection: Selection | null;
  readonly wordDrag: WordDrag | null;
  readonly alignReport: AlignReport | null;
  readonly working: WorkingRegion;
  readonly loop: boolean;
  readonly follow: boolean;
  readonly playhead: number;
  readonly playing: boolean;
  readonly drag: Drag | null;
  readonly error: string | null;
};

export { DEFAULT_SETTINGS };

export const initialState: EditorState = {
  story: null, records: [], storyDirectory: null, serverDecisions: null,
  decisions: { settings: DEFAULT_SETTINGS, shots: {} }, editVersion: 0, savedVersion: 0, saveNonce: 0, save: { status: "saved" },
  manual: {}, timingPast: [], timingFuture: [], timingEditVersion: 0, timingSavedVersion: 0, selection: null, wordDrag: null, alignReport: null,
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
  | { type: "timing-save-succeeded"; version: number; story: StoryResponse }
  | { type: "timing-committed"; manual: ManualMap }
  | { type: "timing-nudge"; deltaSamples: number }
  | { type: "timing-undo" } | { type: "timing-redo" }
  | { type: "selection-set"; selection: Selection | null }
  | { type: "word-drag-start" }
  | { type: "word-drag-move"; delta: number; snap: SnapTarget | null }
  | { type: "word-drag-end" } | { type: "word-drag-cancel" }
  | { type: "align-report-set"; report: AlignReport | null }
  | { type: "shot-edited"; id: string; patch: DecisionPatch }
  | { type: "shot-selected"; id: string; groupIds: ReadonlyArray<string> }
  | { type: "shots-hidden"; ids: ReadonlyArray<string> }
  | { type: "shot-moved"; id: string; startSample: number; anchorWordId?: string }
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
    case "story-loaded": return adoptStory(state, action.story, state.timingEditVersion === state.timingSavedVersion);
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
    case "timing-save-succeeded": {
      const next = adoptStory({ ...state, timingSavedVersion: action.version }, action.story, action.version === state.timingEditVersion);
      return { ...next, save: { status: "saved" } };
    }
    case "timing-committed": return commitTiming(state, action.manual);
    case "timing-nudge": {
      if (state.story === null || state.wordDrag !== null) return state;
      const words = effectiveWords(state.story.words, state.manual);
      const range = selectedRange(words.map(w => w.id), state.selection);
      if (range === null) return state;
      const delta = clampDelta(words, range, action.deltaSamples, state.story.clip.sampleCount);
      return delta === 0 ? state : commitTiming(state, moveWords(state.manual, words, range, delta));
    }
    case "timing-undo": {
      const previous = state.timingPast[state.timingPast.length - 1];
      if (previous === undefined) return state;
      return bumpTiming({ ...state, manual: previous, timingPast: state.timingPast.slice(0, -1), timingFuture: [state.manual, ...state.timingFuture] });
    }
    case "timing-redo": {
      const next = state.timingFuture[0];
      if (next === undefined) return state;
      return bumpTiming({ ...state, manual: next, timingPast: [...state.timingPast, state.manual], timingFuture: state.timingFuture.slice(1) });
    }
    case "selection-set": return state.wordDrag !== null ? state : { ...state, selection: action.selection };
    case "word-drag-start": return state.selection === null || state.drag !== null ? state : { ...state, wordDrag: { delta: 0, snap: null } };
    case "word-drag-move": {
      if (state.wordDrag === null || state.story === null) return state;
      const words = effectiveWords(state.story.words, state.manual);
      const range = selectedRange(words.map(w => w.id), state.selection);
      if (range === null) return { ...state, wordDrag: null };
      const delta = clampDelta(words, range, action.delta, state.story.clip.sampleCount);
      return { ...state, wordDrag: { delta, snap: delta === action.delta ? action.snap : null } };
    }
    case "word-drag-end": {
      if (state.wordDrag === null || state.story === null) return state;
      const { delta } = state.wordDrag;
      const cleared = { ...state, wordDrag: null };
      const words = effectiveWords(state.story.words, state.manual);
      const range = selectedRange(words.map(w => w.id), state.selection);
      return delta === 0 || range === null ? cleared : commitTiming(cleared, moveWords(state.manual, words, range, delta));
    }
    case "word-drag-cancel": return { ...state, wordDrag: null };
    case "align-report-set": return { ...state, alignReport: action.report };
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
      // Landing on a word anchors the shot to it (A51); landing anywhere else writes a plain sample position and drops any anchor.
      const record = state.records.find(r => r.id === action.id);
      const patch: DecisionPatch = action.anchorWordId !== undefined
        ? { anchorWordId: action.anchorWordId, startSample: undefined }
        : { anchorWordId: undefined, startSample: record !== undefined && record.startSample === action.startSample ? undefined : action.startSample };
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
    case "drag-start": return state.wordDrag !== null ? state : { ...state, drag: { id: action.id, originalStart: action.startSample, currentStart: action.startSample, snap: null } };
    case "drag-move": return state.drag === null ? state : { ...state, drag: { ...state.drag, currentStart: action.startSample, snap: action.snap } };
    case "drag-end": {
      if (state.drag === null) return state;
      const { id, originalStart, currentStart, snap } = state.drag;
      const cleared = { ...state, drag: null };
      if (currentStart === originalStart) return cleared;
      const anchorWordId = snap?.kind === "word-start" ? snap.wordId : snap?.kind === "chunk-start" ? snap.firstWordId : undefined;
      return reduce(cleared, { type: "shot-moved", id, startSample: currentStart, ...(anchorWordId !== undefined ? { anchorWordId } : {}) });
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
  return { ...state, records: timeline.records, storyDirectory: timeline.storyDirectory, serverDecisions: timeline.decisions, decisions };
}

/** Takes the story from the server; adopts its manual layer only when nothing local is unsaved. The selection survives when its words still exist. */
function adoptStory(state: EditorState, story: StoryResponse, adoptManual: boolean): EditorState {
  const manual = adoptManual ? manualMapOf(story.words) : state.manual;
  const ids = new Set(story.words.map(w => w.id));
  const selection = state.selection !== null && [state.selection.anchor, state.selection.focus].every(i => ids.has(i.first) && ids.has(i.last)) ? state.selection : null;
  return { ...state, story, manual, selection };
}

/** Every committed timing change is one undo step; a new change after undo discards the redo branch. */
function commitTiming(state: EditorState, manual: ManualMap): EditorState {
  return bumpTiming({ ...state, manual, timingPast: [...state.timingPast, state.manual], timingFuture: [] });
}

const bumpTiming = (state: EditorState): EditorState =>
  ({ ...state, timingEditVersion: state.timingEditVersion + 1, save: state.save.status === "error" ? { status: "saved" } : state.save });

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

export const isDecisionsDirty = (state: EditorState) => state.editVersion !== state.savedVersion;
export const isTimingDirty = (state: EditorState) => state.timingEditVersion !== state.timingSavedVersion;
export const isDirty = (state: EditorState) => isDecisionsDirty(state) || isTimingDirty(state);

/** Decisions as they should render: the in-progress drag is overlaid without being committed, and a dragged shot leaves its anchor. */
export function decisionsForView(state: EditorState): DecisionsBody {
  if (state.drag === null) return state.decisions;
  const { id, currentStart } = state.drag;
  const { anchorWordId: _a, ...rest } = state.decisions.shots[id] ?? {};
  return { ...state.decisions, shots: { ...state.decisions.shots, [id]: { ...rest, startSample: currentStart } } };
}

/** The Edited row's words: story words under the local manual overlay, with an in-progress group move applied to the selection. */
export function wordsForView(state: EditorState): ReadonlyArray<Word> {
  if (state.story === null) return [];
  const words = effectiveWords(state.story.words, state.manual);
  if (state.wordDrag === null || state.wordDrag.delta === 0) return words;
  const range = selectedRange(words.map(w => w.id), state.selection);
  return range === null ? words : shiftedWords(words, range, state.wordDrag.delta);
}

/** Effective [start, end) of the working region when enabled, else null. */
export function workingBounds(state: EditorState, sampleCount: number): { start: number; end: number } | null {
  if (!state.working.enabled) return null;
  const start = state.working.inSample ?? 0;
  const end = state.working.outSample ?? sampleCount;
  return end > start ? { start, end } : null;
}
