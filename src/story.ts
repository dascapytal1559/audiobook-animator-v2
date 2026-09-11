import { parseArgs } from "node:util";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Stdio, Stream } from "effect";
import { loadStoryContext, StoryError } from "./modules/story/index.js";
import { loadRun, RunError, selectStory } from "./run.js";

const usage = `Usage: node dist/story.js --story <id> [--run <file>]

Verify the story's manifest against its linked files and print the working transcript for planning as JSON on stdout. Without --story the
available ids are listed. Settings are the code defaults unless --run names a JSON file that overrides some of them. No audio is decoded and
no network request is made. Help and errors go to stderr.`;
const invalid = (message: string) => new StoryError({ code: "InvalidConfig", message });

const main = Effect.gen(function* () {
  const { values } = yield* Effect.try({
    try: () => parseArgs({ options: { story: { type: "string" }, run: { type: "string" }, help: { type: "boolean" } }, strict: true, allowPositionals: false }),
    catch: () => invalid("Invalid arguments. Run with --help for usage."),
  });
  if (values.help) return yield* Console.error(usage);
  const run = yield* loadRun(values.run);
  const storyDirectory = yield* selectStory(run, values.story);
  const result = yield* loadStoryContext({ storyDirectory, settings: run.story });
  const stdio = yield* Stdio.Stdio;
  yield* Stream.make(`${JSON.stringify(result, null, 2)}\n`).pipe(Stream.run(stdio.stdout({ endOnDone: false })));
});

main.pipe(
  Effect.catch((error) => Console.error(error instanceof StoryError || error instanceof RunError ? `${error.code}: ${error.message}` : "Cannot write the story context.").pipe(
    Effect.andThen(Effect.sync(() => { process.exitCode = 1; })),
  )),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
