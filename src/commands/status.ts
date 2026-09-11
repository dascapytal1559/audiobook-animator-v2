import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { statusReport } from "../modules/status/index.js";
import { handle, printJson, run, runFlag, storyFlag } from "./shared.js";

export const statusCommand = Command.make("status", {
  story: storyFlag, run: runFlag,
  port: Flag.integer("port").pipe(Flag.withDefault(63620), Flag.withDescription("The editor server port to probe; the launcher's by default.")),
}, handle(({ story, run: runPath, port }) => Effect.gen(function* () {
  const settings = yield* run(runPath);
  yield* printJson(yield* statusReport({ storiesDirectory: settings.storiesDirectory, settings: { story: settings.story, timeline: settings.timeline, editor: settings.editor }, ...(Option.isSome(story) ? { storyId: story.value } : {}), editorPort: port }));
}))).pipe(Command.withDescription("The situation report: for every story (or --story one), verification, transcript provider, word-timing overlays and their coverage, timeline records and selections and gaps, cache freshness, and documents; plus whether the editor server answers. Facts only, nothing written. Run this first."));
