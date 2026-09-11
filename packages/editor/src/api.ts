/** Typed wrappers over the editor server API. Shapes mirror src/modules/visual-timeline/contracts.ts by hand; the client cannot import Effect schemas. */
import { useEffect } from "react";

export type ShotMode = "graphic-illustration" | "poetic-abstraction";
export const SHOT_MODES: ReadonlyArray<ShotMode> = ["graphic-illustration", "poetic-abstraction"];

export type ClipIdentity = { bookId: string; storyId: string; audioSha256: string; transcriptSha256: string; sampleRateHz: number; sampleCount: number };
export type Span = { startSample: number; endSample: number };
/**
 * A transcript word with its three timing layers (A42): `original` from the transcriber, `auto` from the align script, `manual` from this
 * editor. The top-level `startSample`/`endSample` are the server's effective times (manual, else auto, else original).
 */
export type Word = { id: string; value: string; startSample: number; endSample: number; original: Span; auto?: Span; manual?: Span };
/** A sentence, or a shorter run of words cut by a pause of at least the server's `chunking.pauseBreakMs`. Every word belongs to exactly one chunk. */
export type Chunk = { id: string; startSample: number; endSample: number; text: string; wordIds: string[]; breakReason: "sentence" | "pause" | "end" };
export type AlignStats = { boundaryMedianMs: number; boundaryP10Ms: number; boundaryP90Ms: number; insideSpeechFraction: number; wordCount: number };
/** Before/after measurements of one align run (A48). Extra fields from the server are carried but not interpreted. */
export type AlignReport = { before: AlignStats; after: AlignStats } & Record<string, unknown>;
export type AutoRun = { startSample: number; endSample: number; ranAt: string; report: AlignReport };
export type TimingSummary = { inversions: unknown; autoRuns: AutoRun[]; manualCount: number; autoCount: number };
/** Explicit server grouping settings and sentence marks merged because the effective gap was too short. */
export type StoryChunking = { pauseBreakMs: number; minSentenceBreakMs: number; mergedSentenceBreaks: Array<{ afterWordId: string; nextWordId: string; gapSamples: number; gapMs: number; text: string }> };
export type StoryResponse = { clip: ClipIdentity; story: { title: string; bookTitle: string; transcriptProvider?: "openai" | "rev-ai" }; sourceStartSample: number; words: Word[]; chunks: Chunk[]; chunking: StoryChunking; timing?: TimingSummary };
/** Detected speech regions on the clip clock (A45, A46). */
export type SpeechResponse = { schemaVersion: number; audioSha256: string; sampleRateHz: number; sampleCount: number; frameSamples: number; thresholdDbfs: number; minSilenceMs: number; minSpeechMs: number; regions: Span[] };
/** The complete manual overlay, keyed by word id (A36). A PUT replaces the file wholesale, like decisions. */
export type WordTimingBody = { words: Record<string, Span> };
export type AlignRequest = { startSample: number; endSample: number; wholeClip?: boolean };
export type AlignResponse = { report: AlignReport; story: StoryResponse };

export type ShotRecord = {
  schemaVersion: 1; kind: "visual-shot-generation"; id: string; clip: ClipIdentity; startSample: number; mode: ShotMode;
  label?: string; prompt?: string; imagePath?: string; notes?: string; createdAt: string; producer: { name: string; version: string };
  /** Added by the server when the record has an image. */
  imageUrl?: string;
};
/** `anchorWordId` pins the shot start to that word's effective start (A51); it wins over `startSample`, which wins over the record. */
export type ShotDecision = { startSample?: number; anchorWordId?: string; mode?: ShotMode; selected?: boolean; hidden?: boolean; notes?: string };
export type TimelineSettings = { frameAspect: { width: number; height: number } };
export type DecisionsBody = { settings: TimelineSettings; shots: Record<string, ShotDecision> };
export type Decisions = DecisionsBody & { schemaVersion: 1; kind: "visual-timeline-decisions"; clip: ClipIdentity; updatedAt: string };

export type EffectiveShot = {
  id: string; startSample: number; mode: ShotMode; label?: string; prompt?: string; imagePath?: string; imageUrl?: string; notes?: string;
  createdAt: string; producer: { name: string; version: string }; hidden: boolean; selected: boolean; selectionSource?: "decision" | "default";
  /** Set by the client merge when the decision anchors the shot to a word (A51). */
  anchorWordId?: string;
};
export type CandidateGroup = { startSample: number; shots: EffectiveShot[]; selectedId: string | null; selectionSource: "decision" | "default" | null };
export type StitchedEntry = (EffectiveShot & { kind: "shot"; endSample: number }) | { kind: "gap"; startSample: number; endSample: number };

export type TimelineResponse = { clip: ClipIdentity; storyDirectory: string; records: ShotRecord[]; decisions: Decisions; candidates: CandidateGroup[]; stitched: StitchedEntry[] };
/** One entry of `GET /api/stories`: the story's manifest identity and size, in directory order. */
export type StorySummary = { id: string; title: string; bookId: string; bookTitle: string; wordCount: number; sampleRateHz: number; sampleCount: number; durationSeconds: number; durationDisplay: string };
export type StoriesResponse = { defaultStoryId: string; stories: StorySummary[] };
export type PeaksResponse = { schemaVersion: number; audioSha256: string; sampleRateHz: number; sampleCount: number; samplesPerBucket: number; min: number[]; max: number[] };
export type NewShotRequest = { startSample: number; mode: ShotMode; label?: string; prompt?: string; notes?: string; image?: File };

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "ApiError"; }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    let code = "HttpError";
    let message = `${init?.method ?? "GET"} ${input} failed with status ${response.status}.`;
    try {
      const body = (await response.json()) as { code?: unknown; message?: unknown };
      if (typeof body.code === "string") code = body.code;
      if (typeof body.message === "string") message = body.message;
    } catch { /* non-JSON error body: keep the status message */ }
    throw new ApiError(response.status, code, message);
  }
  return (await response.json()) as T;
}

export const getStories = () => request<StoriesResponse>("/api/stories");

/** Every request the editor makes for one story lives under `/api/stories/:storyId` (A18). One instance per opened story. */
export function storyApi(storyId: string) {
  const base = `/api/stories/${encodeURIComponent(storyId)}`;
  const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return {
    storyId,
    audioUrl: `${base}/audio`,
    eventsUrl: `${base}/events`,
    getStory: () => request<StoryResponse>(`${base}/story`),
    getTimeline: () => request<TimelineResponse>(`${base}/timeline`),
    getPeaks: () => request<PeaksResponse>(`${base}/peaks`),
    getSpeech: () => request<SpeechResponse>(`${base}/speech`),
    putWordTiming: (body: WordTimingBody) => request<StoryResponse>(`${base}/word-timing`, jsonInit("PUT", body)),
    postAlign: (body: AlignRequest) => request<AlignResponse>(`${base}/word-timing/align`, jsonInit("POST", body)),
    putDecisions: (body: DecisionsBody) => request<TimelineResponse>(`${base}/decisions`, jsonInit("PUT", body)),
    postShot(shot: NewShotRequest): Promise<ShotRecord> {
      const form = new FormData();
      form.set("startSample", String(shot.startSample));
      form.set("mode", shot.mode);
      if (shot.label !== undefined) form.set("label", shot.label);
      if (shot.prompt !== undefined) form.set("prompt", shot.prompt);
      if (shot.notes !== undefined) form.set("notes", shot.notes);
      if (shot.image !== undefined) form.set("image", shot.image, shot.image.name);
      return request<ShotRecord>(`${base}/shots`, { method: "POST", body: form });
    },
  };
}
export type StoryApi = ReturnType<typeof storyApi>;

export type ServerEventHandlers = { onReady?: () => void; onTimelineChanged: () => void; onStatus?: (connected: boolean) => void };

/** Subscribes to the story's events route for the component's lifetime. EventSource reconnects on its own after a drop. */
export function useServerEvents(url: string, handlers: ServerEventHandlers): void {
  const { onReady, onTimelineChanged, onStatus } = handlers;
  useEffect(() => {
    const source = new EventSource(url);
    const ready = () => { onStatus?.(true); onReady?.(); };
    const changed = () => onTimelineChanged();
    const error = () => onStatus?.(false);
    source.addEventListener("ready", ready);
    source.addEventListener("timeline-changed", changed);
    source.addEventListener("error", error);
    return () => { source.close(); };
  }, [url, onReady, onTimelineChanged, onStatus]);
}
