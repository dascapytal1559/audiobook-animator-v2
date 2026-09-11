import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { loadStoryContext } from "../modules/story/index.js";
import { handle, printJson, run, runFlag, story, storyFlag } from "./shared.js";

const show = Command.make("show", { story: storyFlag, run: runFlag }, handle(({ story: id, run: runPath }) => Effect.gen(function* () {
  const settings = yield* run(runPath);
  const storyDirectory = yield* story(settings, id);
  yield* printJson(yield* loadStoryContext({ storyDirectory, settings: settings.story }));
}))).pipe(Command.withDescription("Verify the story's manifest against its linked files and print the working transcript for planning. No audio is decoded and no network request is made."));

export const storyCommand = Command.make("story").pipe(Command.withDescription("The story as a verified unit: its manifest and working transcript."), Command.withSubcommands([show]));
