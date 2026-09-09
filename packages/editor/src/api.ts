/** Typed wrappers over the editor server API. Shapes mirror src/modules/visual-timeline/contracts.ts by hand; the client cannot import Effect schemas. */
import { useEffect } from "react";

export type ShotMode = "graphic-illustration" | "poetic-abstraction";
export const SHOT_MODES: ReadonlyArray<ShotMode> = ["graphic-illustration", "poetic-abstraction"];

export type ClipIdentity = { bookId: string; storyId: string; audioSha256: string; transcriptSha256: string; sampleRateHz: number; sampleCount: number };
export type Word = { id: string; value: string; startSample: number; endSample: number };
export type StoryResponse = { clip: ClipIdentity; story: { title: string; bookTitle: string }; sourceStartSample: number; words: Word[] };

export type ShotRecord = {
  schemaVersion: 1; kind: "visual-shot-generation"; id: string; clip: ClipIdentity; startSample: number; mode: ShotMode;
  label?: string; prompt?: string; imagePath?: string; notes?: string; createdAt: string; producer: { name: string; version: string };
  /** Added by the server when the record has an image. */
  imageUrl?: string;
};
export type ShotDecision = { startSample?: number; mode?: ShotMode; selected?: boolean; hidden?: boolean; notes?: string };
export type TimelineSettings = { frameAspect: { width: number; height: number } };
export type DecisionsBody = { settings: TimelineSettings; shots: Record<string, ShotDecision> };
export type Decisions = DecisionsBody & { schemaVersion: 1; kind: "visual-timeline-decisions"; clip: ClipIdentity; updatedAt: string };

export type EffectiveShot = {
  id: string; startSample: number; mode: ShotMode; label?: string; prompt?: string; imagePath?: string; imageUrl?: string; notes?: string;
  createdAt: string; producer: { name: string; version: string }; hidden: boolean; selected: boolean; selectionSource?: "decision" | "default";
};
export type CandidateGroup = { startSample: number; shots: EffectiveShot[]; selectedId: string | null; selectionSource: "decision" | "default" | null };
export type StitchedEntry = (EffectiveShot & { kind: "shot"; endSample: number }) | { kind: "gap"; startSample: number; endSample: number };

export type TimelineResponse = { clip: ClipIdentity; planningDirectory: string; records: ShotRecord[]; decisions: Decisions; candidates: CandidateGroup[]; stitched: StitchedEntry[] };
export type PeaksResponse = { schemaVersion: number; audioSha256: string; sampleRateHz: number; sampleCount: number; samplesPerBucket: number; min: number[]; max: number[] };
export type NewShotRequest = { startSample: number; mode: ShotMode; label?: string; prompt?: string; notes?: string; image?: File };

export const AUDIO_URL = "/api/audio";

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

export const getStory = () => request<StoryResponse>("/api/story");
export const getTimeline = () => request<TimelineResponse>("/api/timeline");
export const getPeaks = () => request<PeaksResponse>("/api/peaks");
export const putDecisions = (body: DecisionsBody) =>
  request<TimelineResponse>("/api/decisions", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function postShot(shot: NewShotRequest): Promise<ShotRecord> {
  const form = new FormData();
  form.set("startSample", String(shot.startSample));
  form.set("mode", shot.mode);
  if (shot.label !== undefined) form.set("label", shot.label);
  if (shot.prompt !== undefined) form.set("prompt", shot.prompt);
  if (shot.notes !== undefined) form.set("notes", shot.notes);
  if (shot.image !== undefined) form.set("image", shot.image, shot.image.name);
  return request<ShotRecord>("/api/shots", { method: "POST", body: form });
}

export type ServerEventHandlers = { onReady?: () => void; onTimelineChanged: () => void; onStatus?: (connected: boolean) => void };

/** Subscribes to /api/events for the component's lifetime. EventSource reconnects on its own after a drop. */
export function useServerEvents(handlers: ServerEventHandlers): void {
  const { onReady, onTimelineChanged, onStatus } = handlers;
  useEffect(() => {
    const source = new EventSource("/api/events");
    const ready = () => { onStatus?.(true); onReady?.(); };
    const changed = () => onTimelineChanged();
    const error = () => onStatus?.(false);
    source.addEventListener("ready", ready);
    source.addEventListener("timeline-changed", changed);
    source.addEventListener("error", error);
    return () => { source.close(); };
  }, [onReady, onTimelineChanged, onStatus]);
}
