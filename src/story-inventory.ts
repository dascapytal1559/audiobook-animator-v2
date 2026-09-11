import { parseArgs } from "node:util";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Stdio, Stream } from "effect";
import { renderStoryInventory, StoryInventoryError } from "./modules/story-inventory/index.js";
import { loadRun, RunError } from "./run.js";

const usage = `Usage: node dist/story-inventory.js [--run <file>]

Build the reading inventories from every story directory and its manifest: one Markdown view per book beside that book's intake, and the
combined Markdown and JSON views beside the stories. Books are discovered from the manifests; each needs its extras inventory under
<booksDirectory>/<bookId>/split/. Settings and the two directories are the code defaults unless --run names a JSON file that overrides some
of them. No audio is decoded and no network request is made. JSON results go to stdout; help and errors go to stderr.`;

const main = Effect.gen(function* () {
  const { values } = yield* Effect.try({
    try: () => parseArgs({ options: { run: { type: "string" }, help: { type: "boolean" } }, strict: true, allowPositionals: false }),
    catch: () => new StoryInventoryError({ code: "InvalidConfig", message: "Invalid arguments. Run with --help for usage." }),
  });
  if (values.help) return yield* Console.error(usage);
  const run = yield* loadRun(values.run);
  const result = yield* renderStoryInventory({ storiesDirectory: run.storiesDirectory, booksDirectory: run.booksDirectory, settings: run.inventory });
  const stdio = yield* Stdio.Stdio;
  yield* Stream.make(`${JSON.stringify(result, null, 2)}\n`).pipe(Stream.run(stdio.stdout({ endOnDone: false })));
});

main.pipe(
  Effect.catch((error) => Console.error(error instanceof StoryInventoryError || error instanceof RunError ? `${error.code}: ${error.message}` : "Cannot write the inventory result.").pipe(
    Effect.andThen(Effect.sync(() => { process.exitCode = 1; })),
  )),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
