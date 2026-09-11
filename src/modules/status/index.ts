/**
 * The situation report: facts about every story (or one), read through the same loaders every tool uses, with nothing decoded and
 * nothing written. No field judges readiness; the reader decides.
 */

import { Effect, FileSystem, Option } from "effect";
import type { StorySummary } from "@animator/domain";
import { type EditorShared, listStories, openStory } from "../editor-server/routes.js";
import { readPeaksCache, readSpeechCache } from "../editor-server/peaks.js";
import { loadTiming } from "../editor-server/timing.js";
import { loadVisualTimeline } from "../visual-timeline/index.js";

export type CacheState = "fresh" | "stale" | "absent";
export type StoryStatus = {
  readonly id: string; readonly title: string; readonly bookId: string; readonly durationSeconds: number; readonly wordCount: number;
} & ({
  readonly verified: false;
  /** The loader's code and message: the file and rule that failed. */
  readonly error: { readonly code: string; readonly message: string };
} | {
  readonly verified: true;
  readonly transcriptProvider: "rev-ai" | "openai";
  readonly timing: {
    /** null when no auto overlay exists. `coverage` is aligned words over all words; `parametersMatch` compares the overlay's recorded parameters with this run's settings. */
    readonly auto: { readonly words: number; readonly coverage: number; readonly runs: number; readonly lastRunAt: string | null; readonly parametersMatch: boolean } | null;
    readonly manual: number; readonly inversions: number;
  };
  readonly timeline: {
    readonly records: number; readonly withImage: number; readonly selected: number; readonly hidden: number;
    /** Sample ranges no selected shot covers: today only an opening gap can exist. */
    readonly gaps: ReadonlyArray<{ readonly startSample: number; readonly endSample: number }>;
    /** Candidate groups with more than one visible shot and no explicit selection: newest-wins is deciding there. */
    readonly undecidedGroups: number;
    readonly unresolvedAnchors: ReadonlyArray<string>;
  };
  readonly caches: { readonly peaks: CacheState; readonly speech: CacheState };
  /** Markdown documents at the top of the story directory: analyses and treatments written by agents. */
  readonly documents: ReadonlyArray<string>;
});
export type StatusReport = {
  readonly storiesDirectory: string;
  readonly stories: ReadonlyArray<StoryStatus>;
  /** Whether the editor server answers on the launcher's port, and how many stories it lists. */
  readonly editorServer: { readonly url: string; readonly listening: boolean; readonly stories: number | null };
};

const cacheState = (path: string, read: Effect.Effect<Option.Option<unknown>, never, FileSystem.FileSystem>) => Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false));
  if (!exists) return "absent" as const;
  return Option.isSome(yield* read) ? ("fresh" as const) : ("stale" as const);
});

/** One story's facts. A story that fails verification is reported with the failure, never omitted. */
export function storyStatus(shared: EditorShared, summary: StorySummary): Effect.Effect<StoryStatus, never, FileSystem.FileSystem> {
  const head = { id: summary.id, title: summary.title, bookId: summary.bookId, durationSeconds: summary.durationSeconds, wordCount: summary.wordCount };
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const ctx = yield* openStory(shared, summary.id);
    const timing = yield* loadTiming(ctx);
    const timeline = yield* loadVisualTimeline({ story: ctx.story, settings: shared.settings.timeline, wordStarts: timing.wordStarts });
    const editor = shared.settings.editor;
    const auto = timing.auto === undefined ? null : {
      words: Object.keys(timing.auto.words).length, coverage: ctx.words.length === 0 ? 0 : Math.round((Object.keys(timing.auto.words).length / ctx.words.length) * 10_000) / 10_000,
      runs: timing.auto.runs.length, lastRunAt: timing.auto.runs.at(-1)?.ranAt ?? null,
      parametersMatch: timing.auto.parameters.leadMs === editor.alignment.leadMs && timing.auto.parameters.thresholdDbfs === editor.speech.thresholdDbfs
        && timing.auto.parameters.minSilenceMs === editor.speech.minSilenceMs && timing.auto.parameters.minSpeechMs === editor.speech.minSpeechMs,
    };
    const shots = timeline.candidates.flatMap(g => g.shots);
    const documents = (yield* fs.readDirectory(ctx.storyDirectory).pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>))).filter(n => n.endsWith(".md") && !n.startsWith(".")).sort();
    const status: StoryStatus = { ...head, verified: true, transcriptProvider: ctx.story.story.transcriptProvider,
      timing: { auto, manual: timing.effective.manualCount, inversions: timing.effective.inversions },
      timeline: {
        records: timeline.records.length, withImage: timeline.records.filter(r => r.imagePath !== undefined).length,
        selected: shots.filter(s => s.selected).length, hidden: shots.filter(s => s.hidden).length,
        gaps: timeline.stitched.flatMap(e => e.kind === "gap" ? [{ startSample: e.startSample, endSample: e.endSample }] : []),
        undecidedGroups: timeline.candidates.filter(g => g.selectionSource === "default" && g.shots.filter(s => !s.hidden).length > 1).length,
        unresolvedAnchors: timeline.unresolvedAnchors,
      },
      caches: {
        peaks: yield* cacheState(ctx.peaksPath, readPeaksCache(ctx.peaksPath, editor.peaks.maxCacheBytes, ctx.peaksIdentity)),
        speech: yield* cacheState(ctx.speechPath, readSpeechCache(ctx.speechPath, editor.peaks.maxCacheBytes, ctx.speechIdentity)),
      },
      documents,
    };
    return status;
  }).pipe(Effect.catch(e => Effect.succeed<StoryStatus>({ ...head, verified: false, error: { code: "code" in e ? String(e.code) : "Unknown", message: e.message } })));
}

/** Every story under the stories directory, or the one named, plus whether the editor server answers. */
export function statusReport(options: EditorShared & { readonly storyId?: string; readonly editorPort: number }) {
  return Effect.gen(function* () {
    const listed = yield* listStories(options);
    const chosen = options.storyId === undefined ? listed : listed.filter(s => s.id === options.storyId);
    const stories: StoryStatus[] = [];
    for (const summary of chosen) stories.push(yield* storyStatus(options, summary));
    const url = `http://127.0.0.1:${options.editorPort}`;
    const editorServer = yield* Effect.tryPromise({
      try: async () => { const r = await fetch(`${url}/api/stories`, { signal: AbortSignal.timeout(1_000) }); const body = (await r.json()) as { stories?: unknown[] }; return { url, listening: r.ok, stories: Array.isArray(body.stories) ? body.stories.length : null }; },
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null));
    return { storiesDirectory: options.storiesDirectory, stories, editorServer: editorServer ?? { url, listening: false, stories: null } } satisfies StatusReport;
  });
}

