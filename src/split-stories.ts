import { parseArgs } from "node:util";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Stdio, Stream } from "effect";
import { splitStories, StorySplitError, validateStorySplit } from "./intake/story-split/index.js";
import { formatSplitFailure } from "./intake/story-split/diagnostics.js";

const diagnosticLimits = { summaryBytes: 2048, detailBytes: 8192 };

const main = Effect.gen(function* () {
  const { values } = yield* Effect.try({
    try: () => parseArgs({ options: { plan: { type: "string" }, config: { type: "string" }, source: { type: "string" }, output: { type: "string" }, "validate-only": { type: "boolean" }, help: { type: "boolean" } }, strict: true, allowPositionals: false }),
    catch: () => new StorySplitError({ code: "InvalidConfig", message: "Invalid arguments. Run with --help for usage." }),
  });
  if (values.help) {
    yield* Console.error("Usage:\n  node dist/split-stories.js --plan <split-plan.json> --config config/story-split.json [--source <current-source>] --validate-only\n  node dist/split-stories.js --plan <split-plan.json> --config config/story-split.json [--source <current-source>] --output <directory>\n\nThe plan supplies every transcript range and decoded-audio sample interval. The splitter does not discover or choose cuts. It verifies all input identities, extracts each story/extra, and publishes a complete duration inventory only after every pair succeeds. Plan paths resolve from the plan file; tool paths resolve from config. An optional --source resolves from the working directory and must match the plan's pinned bytes. Source moves preserve historical plans and output manifests. JSON results go to stdout; diagnostics go to stderr.");
    return;
  }
  if (!values.plan || !values.config || (!values["validate-only"] && !values.output) || (values["validate-only"] && values.output !== undefined)) {
    return yield* Effect.fail(new StorySplitError({ code: "InvalidConfig", message: "Supply --plan and --config, plus either --output or --validate-only." }));
  }
  const inputs = { planPath: values.plan, configPath: values.config, ...(values.source === undefined ? {} : { sourcePath: values.source }) };
  const result = values["validate-only"]
    ? yield* validateStorySplit(inputs)
    : yield* splitStories({ ...inputs, artifactDirectory: values.output ?? "" });
  const stdio = yield* Stdio.Stdio;
  yield* Stream.make(`${JSON.stringify(result, null, 2)}\n`).pipe(Stream.run(stdio.stdout({ endOnDone: false })));
});

main.pipe(
  Effect.catch((error) => Console.error(formatSplitFailure(error, diagnosticLimits)).pipe(
    Effect.andThen(Effect.sync(() => { process.exitCode = 1; })),
  )),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
