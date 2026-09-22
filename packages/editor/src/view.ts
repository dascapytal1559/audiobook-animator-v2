import { DEFAULT_IMAGE_TRACK, ImageTrackId, decodeStrict } from "@animator/domain";

/** Browser-only opening position (A60, A63): the requested track and clip time in seconds. The editor is one page of sections now, so a retired `view` parameter in an old link is ignored. */
export function viewFromSearch(search: string) {
  const params = new URLSearchParams(search);
  const track = params.get("track");
  const at = params.get("at");
  const seconds = at === null || at.trim() === "" ? 0 : Number(at);
  let trackId = DEFAULT_IMAGE_TRACK;
  try { trackId = decodeStrict(ImageTrackId, track); } catch { /* malformed opening preference: use the normal track */ }
  return { trackId, seconds: Number.isFinite(seconds) && seconds >= 0 ? seconds : 0 };
}
