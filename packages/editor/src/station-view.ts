/** Pure rules of the shot station's view (A69): how a version reads in the history, where a direction's image stands, and what this browser keeps per shot. */
import { jobPending, stationImage, stationOrigin } from "@animator/domain";
import type { ServedStationImage, StationDirection, StationVersion, StoryboardJob } from "./api.js";
import { jobLine, rendererLabel } from "./storyboard-view.js";

/** How many directions a description asks for unless the director picks another number. */
export const DEFAULT_DIRECTIONS = 4;

/**
 * What this browser keeps of the station per shot, so a reload or following the playhead elsewhere loses nothing: the director's
 * description being written, the version it revises (null for a fresh one), the narration picked for the next version (null for the
 * shot's own), and the version open (null for the newest).
 */
export type StationDraft = {
  readonly director: string; readonly from: string | null;
  readonly span: { readonly startWordId: string; readonly endWordId: string } | null; readonly open: string | null;
};
export const EMPTY_STATION_DRAFT: StationDraft = { director: "", from: null, span: null, open: null };
export const isEmptyStationDraft = (draft: StationDraft): boolean => draft.director === "" && draft.from === null && draft.span === null && draft.open === null;
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
/** The drafts this browser kept, keyed by shot; a malformed entry or part is dropped rather than trusted. */
export function parseStationDrafts(stored: unknown): Readonly<Record<string, StationDraft>> {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
  const drafts: Record<string, StationDraft> = {};
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const { director, from, span, open } = value as Record<string, unknown>;
    const spanFields = typeof span === "object" && span !== null ? span as Record<string, unknown> : null;
    const startWordId = text(spanFields?.["startWordId"]);
    const endWordId = text(spanFields?.["endWordId"]);
    const draft: StationDraft = { director: typeof director === "string" ? director : "", from: text(from), open: text(open),
      span: startWordId !== null && endWordId !== null ? { startWordId, endWordId } : null };
    if (!isEmptyStationDraft(draft)) drafts[key] = draft;
  }
  return drafts;
}
/** A count of directions this browser remembered, held within 1 and the server's ceiling; anything else is the default. */
export const parseDirectionCount = (stored: unknown): number => (typeof stored === "number" && Number.isInteger(stored) && stored >= 1 && stored <= 6 ? stored : DEFAULT_DIRECTIONS);

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
/** A direction's motion as a card reads it. */
export const motionLabel = (direction: Pick<StationDirection, "motion">): string => direction.motion ?? "still";
/**
 * What made a version, in a few words, naming the version it came from by its number among the shot's versions, `versions` oldest
 * first: "4 directions", "picked 2 of v1", "mixed 1 + 3 of v1", "edited v2: “make the sky red”" (a direction is numbered only when its
 * version had several), "motion of v3: slow push in", "still, from v3".
 */
export function versionLabel(version: Pick<StationVersion, "parentId" | "action" | "directions">, versions: ReadonlyArray<Pick<StationVersion, "id" | "directions">>): string {
  const index = version.parentId === null ? -1 : versions.findIndex(v => v.id === version.parentId);
  const parent = index < 0 ? undefined : `v${index + 1}`;
  const several = index >= 0 && versions[index]!.directions.length > 1;
  const of = parent === undefined ? "" : ` of ${parent}`;
  const { action } = version;
  switch (action.kind) {
    case "describe": return `${plural(version.directions.length, "direction")}${parent === undefined ? "" : `, revising ${parent}`}`;
    case "pick": return `picked ${action.direction + 1}${of}`;
    case "mix": return `mixed ${action.directions.map(d => d + 1).join(" + ")}${of}${action.instruction.trim() === "" ? "" : `: “${action.instruction.trim()}”`}`;
    case "edit": return `edited ${several || parent === undefined ? `${action.direction + 1}${of}` : parent}: “${action.instruction.trim()}”`;
    case "motion": return action.motion === null ? `still${parent === undefined ? "" : `, from ${parent}`}` : `motion${of}: ${action.motion}`;
  }
}

/**
 * Where one direction's image stands, as its card shows it: drawn, with its URL and renderer; being drawn or waiting, with the job's line;
 * failed, with why, so it can be drawn again; or missing, when no try is recorded and none is running, as after a restart lost a drawing.
 * A carried direction shows the image of the direction it was carried from.
 */
export type CardImage = { readonly kind: "drawn"; readonly url: string; readonly by: string | null } | { readonly kind: "drawing"; readonly line: string } | { readonly kind: "failed"; readonly line: string } | { readonly kind: "missing" };
export function cardImage(versions: ReadonlyArray<StationVersion>, images: ReadonlyArray<ServedStationImage>, jobs: ReadonlyArray<StoryboardJob>, versionId: string, direction: number, now: number): CardImage {
  const shown = stationImage(versions, images, versionId, direction);
  if (shown.status === "drawn" && shown.image.imageUrl !== undefined) return { kind: "drawn", url: shown.image.imageUrl, by: shown.image.renderer === undefined ? null : rendererLabel(shown.image.renderer) };
  const origin = stationOrigin(versions, versionId, direction);
  const job = jobs.filter(j => j.kind === "station" && j.versionId === origin.versionId && j.direction === origin.direction)
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.id.localeCompare(b.id)).at(-1);
  if (job !== undefined && (jobPending(job) || job.status === "done")) return { kind: "drawing", line: jobPending(job) ? jobLine(job, now) : "Drawn; loading…" };
  if (shown.status === "failed") return { kind: "failed", line: `Drawing failed. ${shown.image.error ?? ""}`.trim() };
  if (job?.status === "failed") return { kind: "failed", line: jobLine(job, now) };
  return { kind: "missing" };
}

/** The newest version of a shot unless another is open and still there. */
export const openVersion = (versions: ReadonlyArray<StationVersion>, open: string | null): StationVersion | null =>
  versions.find(v => v.id === open) ?? versions.at(-1) ?? null;

/** The director's description behind a version, its own or that of the nearest description it descends from; null when none is in the list. */
export function directorOf(versions: ReadonlyArray<StationVersion>, version: StationVersion): { readonly text: string; readonly versionId: string } | null {
  const byId = new Map(versions.map(v => [v.id, v] as const));
  for (let at: StationVersion | undefined = version, hops = 0; at !== undefined && hops <= versions.length; at = at.parentId === null ? undefined : byId.get(at.parentId), hops++) {
    if (at.action.kind === "describe") return { text: at.action.director, versionId: at.id };
  }
  return null;
}
