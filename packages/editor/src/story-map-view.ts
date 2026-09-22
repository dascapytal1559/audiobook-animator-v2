import { currentSections, entryAt, resolveStoryMap } from "@animator/domain";
import type { ResolvedSection, ResolvedStoryMap, SectionKind, ServedSubject, StitchedEntry, Word } from "./api.js";
import type { MapState } from "./state.js";

export type Resolved = ResolvedStoryMap<ServedSubject>;

/**
 * The story map as the Scenes and Cast & world sections see it (A62, A63): the served map resolved onto the words the timeline shows, or
 * the reason there is nothing to show yet. Both sections read the same view, so the map is resolved once per change of map or words.
 */
export type MapView =
  | { readonly status: "loading" }
  | { readonly status: "absent" }
  | { readonly status: "error"; readonly message: string }
  /** The map is here but the transcript is not yet, so nothing can be resolved. */
  | { readonly status: "waiting" }
  /** The map does not fit the transcript it was written against. */
  | { readonly status: "unresolvable"; readonly message: string }
  | { readonly status: "loaded"; readonly resolved: Resolved };

export const resolveMapView = (map: MapState, words: ReadonlyArray<Word>): MapView => {
  if (map.status !== "loaded") return map;
  if (words.length === 0) return { status: "waiting" };
  try { return { status: "loaded", resolved: resolveStoryMap(map.map, words) }; }
  catch (e) { return { status: "unresolvable", message: e instanceof Error ? e.message : String(e) }; }
};

/** The chain of sections that hold the playhead, outermost first: at each depth, the last section that has started. */
export const currentChain = (view: MapView, playhead: number): ReadonlyArray<ResolvedSection> =>
  view.status === "loaded" ? currentSections(view.resolved.sections, playhead) : [];

/**
 * Which scene the Scenes section details: the one the user selected, for as long as the map still holds it; otherwise the innermost
 * section under the playhead, so the detail follows playback until a click pins it.
 */
export const sceneToShow = (sections: ReadonlyArray<ResolvedSection>, selectedId: string | null, chain: ReadonlyArray<ResolvedSection>): ResolvedSection | null => {
  if (selectedId !== null) {
    const selected = sections.find(s => s.id === selectedId);
    if (selected !== undefined) return selected;
  }
  return chain[chain.length - 1] ?? null;
};

/** One image take of a scene (A63): the shot an image track shows at the scene's start, with the track it came from. */
export type ImageTake = { readonly trackId: string; readonly shot: Extract<StitchedEntry, { kind: "shot" }> & { readonly imageUrl: string } };

/**
 * The image takes at a sample: for every image track, in the order the tracks first appear, the shot that track holds at the sample by the
 * same rule the preview uses (`entryAt`), when it is a shot with an image. A track in a gap there, or holding a shot without an image, has
 * no take. The shot may have started before the scene; `shot.startSample` says where.
 */
export function imageTakesAt(stitched: ReadonlyArray<StitchedEntry>, sample: number, toleranceSamples: number): ReadonlyArray<ImageTake> {
  const trackIds = [...new Set(stitched.map(entry => entry.trackId))];
  return trackIds.flatMap(trackId => {
    const entry = entryAt(stitched.filter(e => e.trackId === trackId), sample, toleranceSamples);
    return entry !== null && entry.kind === "shot" && entry.imageUrl !== undefined ? [{ trackId, shot: { ...entry, imageUrl: entry.imageUrl } }] : [];
  });
}

export const SECTION_LABELS: Readonly<Record<SectionKind, string>> = { act: "Act", chapter: "Chapter", scene: "Scene", beat: "Beat" };

/** A clip time as minutes and tenths of a second, for display only. */
export const clock = (sample: number, sampleRateHz: number): string => {
  const seconds = sample / Math.max(1, sampleRateHz);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}`;
};
