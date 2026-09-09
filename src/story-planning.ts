import { parseArgs } from "node:util";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Stdio, Stream } from "effect";
import { loadStoryContext, StoryPlanningError } from "./modules/story-planning/index.js";

const main = Effect.gen(function* () {
  const { values } = yield* Effect.try({
    try: () => parseArgs({ options: { config: { type: "string" }, help: { type: "boolean" } }, strict: true, allowPositionals: false }),
    catch: () => new StoryPlanningError({ code: "InvalidConfig", message: "Invalid arguments. Run with --help for usage." }),
  });
  if (values.help) {
    yield* Console.error("Usage: node dist/story-planning.js --config config/story-planning.json\n\nLoad the selected story and its complete existing paired transcript for planning. All configured paths resolve from the config file. No audio is decoded and no network request is made. JSON results go to stdout; help and errors go to stderr.");
    return;
  }
  if (!values.config) return yield* Effect.fail(new StoryPlanningError({ code: "InvalidConfig", message: "Supply an explicit --config path. Run with --help for usage." }));
  const result = yield* loadStoryContext({ configPath: values.config });
  const stdio = yield* Stdio.Stdio;
  yield* Stream.make(`${JSON.stringify(result, null, 2)}\n`).pipe(Stream.run(stdio.stdout({ endOnDone: false })));
});

main.pipe(
  Effect.catch((error) => Console.error("code" in error ? `${error.code}: ${error.message}` : "Cannot write the story context.").pipe(
    Effect.andThen(Effect.sync(() => { process.exitCode = 1; })),
  )),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
