import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { loadEditorContext, loadTiming } from "../modules/editor-server/index.js";
import { loadStoryContext } from "../modules/story/index.js";
import { loadStoryMap, resolveStoryMap } from "../modules/story-map/index.js";
import { handle, printJson, run, runFlag, story, storyFlag } from "./shared.js";

const show = Command.make("show", { story: storyFlag, run: runFlag }, handle(({ story: id, run: runPath }) => Effect.gen(function* () {
  const settings = yield* run(runPath);
  const storyDirectory = yield* story(settings, id);
  yield* printJson(yield* loadStoryContext({ storyDirectory, settings: settings.story }));
}))).pipe(Command.withDescription("Verify the story's manifest against its linked files and print the working transcript for planning. No audio is decoded and no network request is made."));

const map = Command.make("map", { story: storyFlag, run: runFlag }, handle(({ story: id, run: runPath }) => Effect.gen(function* () {
  const settings = yield* run(runPath);
  yield* story(settings, id);
  const ctx = yield* loadEditorContext({ storiesDirectory: settings.storiesDirectory, settings: { story: settings.story, timeline: settings.timeline, editor: settings.editor }, storyId: id.pipe(o => o._tag === "Some" ? o.value : "") });
  const loaded = yield* loadStoryMap({ story: ctx.story, wordIds: ctx.words.map(w => w.id), maxBytes: settings.editor.limits.maxStoryMapBytes });
  const { words } = (yield* loadTiming(ctx)).effective;
  const resolved = resolveStoryMap(loaded.map, words);
  const seconds = (sample: number) => sample / ctx.clip.sampleRateHz;
  yield* printJson({ path: loaded.path, clip: loaded.map.clip, createdAt: loaded.map.createdAt, producer: loaded.map.producer,
    sections: resolved.sections.map(s => ({ id: s.id, kind: s.kind, depth: s.depth, parentId: s.parentId, title: s.title, ...(s.summary !== undefined ? { summary: s.summary } : {}),
      startWordId: s.startWordId, endWordId: s.endWordId, startSample: s.startSample, endSample: s.endSample, startSeconds: seconds(s.startSample), endSeconds: seconds(s.endSample), wordCount: s.wordCount, subjectIds: s.subjectIds })),
    subjects: resolved.subjects.map(s => ({ id: s.id, kind: s.kind, name: s.name, ...(s.description !== undefined ? { description: s.description } : {}), images: (s.images ?? []).map(i => i.path), sectionIds: s.sectionIds,
      mentions: s.mentions.map(m => ({ startWordId: m.startWordId, endWordId: m.endWordId, startSeconds: seconds(m.startSample), endSeconds: seconds(m.endSample), text: m.text })) })) });
}))).pipe(Command.withDescription("Read <story>/story-map.json (A62), check it against the verified clip and the transcript's words, and print its sections and subjects resolved onto effective word timing. Absent map: NotFound."));

export const storyCommand = Command.make("story").pipe(Command.withDescription("The story as a verified unit: its manifest, working transcript, and story map."), Command.withSubcommands([show, map]));
