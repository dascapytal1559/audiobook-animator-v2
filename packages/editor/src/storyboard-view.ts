import { USER_WRITER } from "@animator/domain";
import type { SceneDescriptionTakeBody, StoryboardDraft, StoryboardJob, StoryboardRenderer, StoryResponse, Word } from "./api.js";

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
 * One line on where a drawing stands, as of `now` (milliseconds): which renderer is drawing and for how long, why an earlier one failed, or
 * which one drew it and how long that took. Facts only.
 */
export function jobLine(job: StoryboardJob, now: number): string {
  const failed = job.attempts.filter(a => a.error !== undefined);
  const why = failed.map(a => `${rendererLabel(a.renderer)} failed: ${a.error}`).join(" ");
  if (job.status === "failed") return `Drawing failed. ${why}`.trim();
  const last = job.attempts.at(-1);
  if (job.status === "running") {
    if (last === undefined || last.error !== undefined) return `Drawing… ${seconds(job.startedAt, now)}${why === "" ? "" : `. ${why}`}`;
    return `Drawing with ${rendererLabel(last.renderer)}… ${seconds(last.startedAt, now)}${why === "" ? "" : `. ${why}`}`;
  }
  const took = last?.finishedAt === undefined ? "" : ` in ${seconds(last.startedAt, Date.parse(last.finishedAt))}`;
  return `Drawn by ${last === undefined ? "a renderer" : rendererLabel(last.renderer)}${took}.${why === "" ? "" : ` ${why}`}`;
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
