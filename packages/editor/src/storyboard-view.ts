import { USER_WRITER } from "@animator/domain";
import type { ResolvedSection, SceneDescriptionTakeBody, StoryboardDraft, StoryboardFirstPassShot, StoryboardJob, StoryboardRenderer, StoryResponse, Word } from "./api.js";

/** The first `count` words spoken from a word on, so a shot reads by where it begins; the id itself when the word is not in the transcript. */
export function openingWords(elements: StoryResponse["elements"], wordById: ReadonlyMap<string, Pick<Word, "value">>, anchorWordId: string, count: number): string {
  const from = elements.findIndex(e => e.kind === "word" && e.id === anchorWordId);
  if (from < 0) return anchorWordId;
  const said: string[] = [];
  for (let i = from; i < elements.length && said.length < count; i++) { const element = elements[i]!; if (element.kind === "word") said.push(wordById.get(element.id)?.value ?? element.id); }
  return said.join(" ");
}

export const RENDERER_LABELS: Readonly<Record<StoryboardRenderer, string>> = { "codex-chatgpt": "ChatGPT (Codex CLI)", "qwen-image-2.1": "local Qwen Image 2.1" };
/** A record's renderer as the section names it; an unknown one as written. */
export const rendererLabel = (renderer: string): string => RENDERER_LABELS[renderer as StoryboardRenderer] ?? renderer;

const seconds = (from: string, to: number) => `${Math.max(0, Math.round((to - Date.parse(from)) / 1000))} s`;
/**
 * One line on where a drawing stands, as of `now` (milliseconds): that it waits for a free renderer, which renderer is drawing and for how
 * long, why an earlier one failed, or which one drew it and how long that took. Facts only.
 */
export function jobLine(job: StoryboardJob, now: number): string {
  const failed = job.attempts.filter(a => a.error !== undefined);
  const why = failed.map(a => `${rendererLabel(a.renderer)} failed: ${a.error}`).join(" ");
  if (job.status === "failed") return `Drawing failed. ${why}`.trim();
  if (job.status === "queued") return `Waiting for a free renderer… ${seconds(job.requestedAt, now)}`;
  const last = job.attempts.at(-1);
  if (job.status === "running") {
    if (last === undefined || last.error !== undefined) return `Drawing… ${seconds(job.requestedAt, now)}${why === "" ? "" : `. ${why}`}`;
    return `Drawing with ${rendererLabel(last.renderer)}… ${seconds(last.startedAt, now)}${why === "" ? "" : `. ${why}`}`;
  }
  const took = last?.finishedAt === undefined ? "" : ` in ${seconds(last.startedAt, Date.parse(last.finishedAt))}`;
  return `Drawn by ${last === undefined ? "a renderer" : rendererLabel(last.renderer)}${took}.${why === "" ? "" : ` ${why}`}`;
}

/** The section a first pass at the cursor plans (A67): the innermost beat or scene holding the playhead, or null outside any. */
export const firstPassSection = (chain: ReadonlyArray<ResolvedSection>): ResolvedSection | null => chain.findLast(s => s.kind === "beat" || s.kind === "scene") ?? null;

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** What a first pass would do, or did, in one line of counts (A67): the shots, then what is new and what is kept. */
export function firstPassLine(shots: ReadonlyArray<StoryboardFirstPassShot>): string {
  const n = (key: "frame" | "description" | "drawing", value: string) => shots.filter(s => s[key] === value).length;
  const kept = [n("frame", "kept") > 0 ? count(n("frame", "kept"), "frame") : null, n("description", "kept") > 0 ? count(n("description", "kept"), "description") : null,
    n("drawing", "kept") > 0 ? count(n("drawing", "kept"), "drawing") : null].filter(part => part !== null);
  const busy = n("drawing", "busy") > 0 ? `; ${count(n("drawing", "busy"), "frame")} already being drawn` : "";
  const bare = n("drawing", "none") > 0 ? `; ${count(n("drawing", "none"), "frame")} with nothing to draw from` : "";
  return `${count(shots.length, "shot")}: ${count(n("frame", "new"), "new frame")}, ${count(n("description", "new"), "new description")}, ${count(n("drawing", "new"), "drawing")} to make${kept.length > 0 ? `; keeps ${kept.join(", ")}` : ""}${busy}${bare}.`;
}

/** Where the newest first pass's drawings stand, from the jobs that name it (A67), or null when no job does. Facts only. */
export function firstPassProgress(jobs: ReadonlyArray<StoryboardJob>): string | null {
  const newest = jobs.filter(j => j.firstPassId !== undefined).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.id.localeCompare(b.id)).at(-1)?.firstPassId;
  if (newest === undefined) return null;
  const pass = jobs.filter(j => j.firstPassId === newest);
  const n = (status: StoryboardJob["status"]) => pass.filter(j => j.status === status).length;
  const parts = [n("done") > 0 ? `${n("done")} drawn` : null, n("failed") > 0 ? `${n("failed")} failed` : null, n("running") > 0 ? `${n("running")} drawing` : null, n("queued") > 0 ? `${n("queued")} waiting` : null].filter(p => p !== null);
  return `First pass drawings, ${pass.length} in all: ${parts.join(", ")}.`;
}

/**
 * The take saving `text` records (A66): a draft saved word for word is the drafting model's take, with the prompt it answered; anything the
 * user wrote or changed is the user's, noting the draft it started from.
 */
export function takeToSave(anchorWordId: string, text: string, draft: StoryboardDraft | null): SceneDescriptionTakeBody {
  const trimmed = text.trim();
  if (draft !== null && draft.anchorWordId === anchorWordId && draft.text.trim() === trimmed) return { anchorWordId, model: draft.model, text: trimmed, prompt: draft.prompt, notes: "Drafted in the Storyboard section and saved unchanged." };
  return { anchorWordId, model: USER_WRITER, text: trimmed, ...(draft !== null && draft.anchorWordId === anchorWordId ? { notes: `Edited from a draft by ${draft.model}.` } : {}) };
}
