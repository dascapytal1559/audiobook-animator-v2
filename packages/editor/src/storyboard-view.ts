import type { SpanJudgement } from "@animator/domain";
import type { ResolvedSection, StoryboardFirstPassShot, StoryboardJob, StoryboardRenderer, StoryResponse, Word } from "./api.js";

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

/** The narration from one word through another, as written: the words and the punctuation between and after them, in transcript order (A68). */
export function spanText(elements: StoryResponse["elements"], wordById: ReadonlyMap<string, Pick<Word, "value">>, startWordId: string, endWordId: string): string {
  const from = elements.findIndex(e => e.kind === "word" && e.id === startWordId);
  const to = elements.findIndex((e, i) => i >= from && e.kind === "word" && e.id === endWordId);
  if (from < 0 || to < 0) return "";
  let last = to;
  while (elements[last + 1]?.kind === "punctuation") last++;
  return elements.slice(from, last + 1).map(e => (e.kind === "word" ? wordById.get(e.id)?.value ?? e.id : e.value)).join("").replace(/\s+/g, " ").trim();
}

const words = (n: number) => count(n, "word");
/**
 * What saving a span does to the shots around it, in plain lines (A68): words given to or taken from the shot before, the frame
 * saved anew at a moved start, and the empty frame a drawn-in end declares. Indexes are into the words sorted by start; `current` is the
 * frame's span, null for a new shot; `hasBefore` says a storyboard shot holds before it; `opening` quotes a word's opening. Facts only.
 */
export function spanLines(options: { readonly current: { readonly start: number; readonly end: number } | null; readonly start: number; readonly end: number; readonly judged: SpanJudgement; readonly hasBefore: boolean; readonly opening: (index: number) => string }): ReadonlyArray<string> {
  const { current, start, judged, hasBefore, opening } = options;
  if (!judged.ok) return [judged.reason];
  const before = hasBefore ? "the shot before" : "the opening, before any frame";
  const keepsOld = current !== null && judged.moved && judged.splitAt === current.start;
  const lines: string[] = [];
  if (current === null) { if (hasBefore) lines.push("A new shot inside the one before: that shot ends where this one starts."); }
  else {
    if (start > current.start) lines.push(`${start - current.start === 1 ? "Its first word goes" : `Its first ${words(start - current.start)} go`} to ${before}.`);
    if (start < current.start) lines.push(`It takes ${words(current.start - start)} from ${before}.`);
    if (judged.moved) lines.push(`Its start moves to “${opening(start)}…”: it is saved as a frame there${keepsOld ? "" : ", and the frame at its old start is hidden, kept in history"}.`);
  }
  if (keepsOld) lines.push("It ends just before its old start, so the frame there stays, as the shot after it.");
  else if (judged.splitAt !== null) lines.push(`Its end is drawn in: a new, empty frame will begin at “${opening(judged.splitAt)}…”.`);
  return lines;
}
