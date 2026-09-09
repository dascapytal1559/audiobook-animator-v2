import { parseArgs } from "node:util";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Stdio, Stream } from "effect";
import { renderStoryInventory, StoryInventoryError } from "./modules/story-inventory/index.js";

const main = Effect.gen(function* () {
  const { values } = yield* Effect.try({
    try: () => parseArgs({ options: { config: { type: "string" }, help: { type: "boolean" } }, strict: true, allowPositionals: false }),
    catch: () => new StoryInventoryError({ code: "InvalidConfig", message: "Invalid arguments. Run with --help for usage." }),
  });
  if (values.help) {
    yield* Console.error("Usage: node dist/story-inventory.js --config config/story-inventory.json\n\nBuild readable inventories from verified story splits and editable synopsis files. All configured paths resolve from the config file. No audio is decoded and no network request is made. JSON results go to stdout; help and errors go to stderr.");
    return;
  }
  if (!values.config) return yield* Effect.fail(new StoryInventoryError({ code: "InvalidConfig", message: "Supply an explicit --config path. Run with --help for usage." }));
  const result = yield* renderStoryInventory({ configPath: values.config });
  const stdio = yield* Stdio.Stdio;
  yield* Stream.make(`${JSON.stringify(result, null, 2)}\n`).pipe(Stream.run(stdio.stdout({ endOnDone: false })));
});

main.pipe(
  Effect.catch((error) => Console.error("code" in error ? `${error.code}: ${error.message}` : "Cannot write the inventory result.").pipe(
    Effect.andThen(Effect.sync(() => { process.exitCode = 1; })),
  )),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
