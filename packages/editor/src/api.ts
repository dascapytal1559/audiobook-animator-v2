/** Typed wrappers over the editor server API. Every response is decoded with the shared domain schema before the client trusts it (Q9). */
import { useEffect } from "react";
import { AlignResponse, ApiErrorBody, decodeStrict, PeaksFile, SceneDescriptionsResponse, ServedShotRecord, SpeechFile, StoriesResponse, StoryMapResponse, StoryResponse, TimelineResponse, type AlignRequest, type DecisionsBody, type ShotMode, type WordTimingBody } from "@animator/domain";
export type {
  AlignReport, AlignRequest, AlignResponse, AlignRun, CandidateGroup, Chunk, ClipIdentity, Decisions, DecisionsBody, EffectiveShot, ShotDecision, ShotMode,
  StitchedEntry, StoriesResponse, StoryChunking, StoryResponse, StorySummary, TimelineResponse, TimelineSettings, TimingMeasure, TimingSummary, WordTimingBody,
  ResolvedSection, ResolvedStoryMap, ResolvedSubject, SectionKind, ServedSubject, StoryMapResponse, SubjectKind, SceneDescriptionsResponse, SceneDescriptionTake,
  ServedShotRecord as ShotRecord, TimingEntry as Span, StoryWord as Word, PeaksFile as PeaksResponse, SpeechFile as SpeechResponse,
} from "@animator/domain";
export { SHOT_MODES } from "@animator/domain";

export type NewShotRequest = { startSample: number; mode: ShotMode; trackId?: string; label?: string; prompt?: string; notes?: string; image?: File };

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "ApiError"; }
}

type AnySchema = Parameters<typeof decodeStrict>[0];
/** Fetch, then decode the JSON body strictly. A non-2xx answer becomes an ApiError with the server's code; a 2xx body that does not match the schema is a SchemaMismatch. */
async function request<S extends AnySchema>(schema: S, input: string, init?: RequestInit): Promise<S["Type"]> {
  const response = await fetch(input, init);
  const body: unknown = await response.json().catch(() => undefined);
  const label = `${init?.method ?? "GET"} ${input}`;
  if (!response.ok) {
    let code = "HttpError";
    let message = `${label} failed with status ${response.status}.`;
    try { const error = decodeStrict(ApiErrorBody, body); code = error.code; message = error.message; } catch { /* non-JSON or unshaped error body: keep the status message */ }
    throw new ApiError(response.status, code, message);
  }
  try { return decodeStrict(schema, body); }
  catch (e) { throw new ApiError(response.status, "SchemaMismatch", `${label} answered with a body that does not match the shared schema. ${e instanceof Error ? e.message.replace(/\s+/g, " ") : String(e)}`); }
}

export const getStories = () => request(StoriesResponse, "/api/stories");

/** Every request the editor makes for one story lives under `/api/stories/:storyId` (A18). One instance per opened story. */
export function storyApi(storyId: string) {
  const base = `/api/stories/${encodeURIComponent(storyId)}`;
  const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return {
    storyId,
    audioUrl: `${base}/audio`,
    eventsUrl: `${base}/events`,
    getStory: () => request(StoryResponse, `${base}/story`),
    getTimeline: () => request(TimelineResponse, `${base}/timeline`),
    getPeaks: () => request(PeaksFile, `${base}/peaks`),
    getSpeech: () => request(SpeechFile, `${base}/speech`),
    getMap: () => request(StoryMapResponse, `${base}/map`),
    /** Every description take recorded for the story (A63); the Scenes section shows those of the shown beat. Writers append through POST on the same path; the browser never does. */
    getSceneDescriptions: () => request(SceneDescriptionsResponse, `${base}/scene-descriptions`),
    putWordTiming: (body: WordTimingBody) => request(StoryResponse, `${base}/word-timing`, jsonInit("PUT", body)),
    postAlign: (body: AlignRequest) => request(AlignResponse, `${base}/word-timing/align`, jsonInit("POST", body)),
    putDecisions: (body: DecisionsBody) => request(TimelineResponse, `${base}/decisions`, jsonInit("PUT", body)),
    postShot(shot: NewShotRequest) {
      const form = new FormData();
      form.set("startSample", String(shot.startSample));
      form.set("mode", shot.mode);
      if (shot.trackId !== undefined) form.set("trackId", shot.trackId);
      if (shot.label !== undefined) form.set("label", shot.label);
      if (shot.prompt !== undefined) form.set("prompt", shot.prompt);
      if (shot.notes !== undefined) form.set("notes", shot.notes);
      if (shot.image !== undefined) form.set("image", shot.image, shot.image.name);
      return request(ServedShotRecord, `${base}/shots`, { method: "POST", body: form });
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
