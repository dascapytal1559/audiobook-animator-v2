import { DEFAULT_IMAGE_TRACK, ImageTrackId, decodeStrict } from "@animator/domain";

/** What the main area shows: the timeline, or the story explorer (A62). */
export type EditorView = "timeline" | "explorer";
export const EDITOR_VIEWS: ReadonlyArray<EditorView> = ["timeline", "explorer"];

/** Browser-only opening view (A60, A62); seconds become clip samples after the story loads. */
export function viewFromSearch(search: string) {
  const params = new URLSearchParams(search);
  const requested = params.get("view");
  const view: EditorView = requested === "explorer" ? "explorer" : "timeline";
  const track = params.get("track");
  const at = params.get("at");
  const seconds = at === null || at.trim() === "" ? 0 : Number(at);
  let trackId = DEFAULT_IMAGE_TRACK;
  try { trackId = decodeStrict(ImageTrackId, track); } catch { /* malformed opening preference: use the normal track */ }
  return { view, trackId, seconds: Number.isFinite(seconds) && seconds >= 0 ? seconds : 0 };
}
