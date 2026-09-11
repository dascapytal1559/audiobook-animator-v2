import { parseArgs } from "node:util";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Stdio, Stream } from "effect";
import packageJson from "../package.json" with { type: "json" };
import { loadStoryContext, StoryError } from "./modules/story/index.js";
import { addShot, loadVisualTimeline, ShotMode, VisualTimelineError } from "./modules/visual-timeline/index.js";
import { loadRun, RunError, selectStory } from "./run.js";

const usage = `Usage:
  node dist/visual-timeline.js show --story <id> [--run <file>]
  node dist/visual-timeline.js add  --story <id> [--run <file>] (--at-sample N | --at-seconds S) --mode <graphic-illustration|poetic-abstraction>
                                    [--label TEXT] [--prompt TEXT] [--image PATH] [--notes TEXT] [--producer-name NAME] [--producer-version VERSION]

show  loads every generation record under <story>/shots/ and the decisions overlay, verifies them against the verified story, and prints the
      merged candidates and stitched timeline as JSON on stdout.
add   mints a ULID, copies --image (resolved from the working directory) beside a new record.json, and prints the record.
Without --story the available ids are listed. Settings are the code defaults unless --run names a JSON file that overrides some of them.
Help and errors go to stderr. Default producer is ${packageJson.name}/visual-timeline-cli ${packageJson.version}.`;
const invalid = (message: string) => new VisualTimelineError({ code: "InvalidRequest", message });
const number = (name: string, value: string | undefined) => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed)) throw invalid(`--${name} must be a finite number.`);
  return parsed;
};

const main = Effect.gen(function* () {
  const { values, positionals } = yield* Effect.try({
    try: () => parseArgs({ options: { story: { type: "string" }, run: { type: "string" }, help: { type: "boolean" }, "at-sample": { type: "string" }, "at-seconds": { type: "string" }, mode: { type: "string" },
      label: { type: "string" }, prompt: { type: "string" }, image: { type: "string" }, notes: { type: "string" }, "producer-name": { type: "string" }, "producer-version": { type: "string" } },
      strict: true, allowPositionals: true }),
    catch: () => invalid("Invalid arguments. Run with --help for usage."),
  });
  if (values.help) return yield* Console.error(usage);
  const [command, ...rest] = positionals;
  if ((command !== "show" && command !== "add") || rest.length > 0) return yield* Effect.fail(invalid("Expected exactly one command: show or add. Run with --help for usage."));
  const run = yield* loadRun(values.run);
  const storyDirectory = yield* selectStory(run, values.story);
  const story = yield* loadStoryContext({ storyDirectory, settings: run.story });
  const stdio = yield* Stdio.Stdio;
  const print = (value: unknown) => Stream.make(`${JSON.stringify(value, null, 2)}\n`).pipe(Stream.run(stdio.stdout({ endOnDone: false })));
  if (command === "show") return yield* print(yield* loadVisualTimeline({ story, settings: run.timeline }));
  const mode = values.mode;
  if (mode !== "graphic-illustration" && mode !== "poetic-abstraction") return yield* Effect.fail(invalid(`--mode must be one of ${ShotMode.literals.join(", ")}.`));
  const [startSample, startSeconds] = yield* Effect.try({ try: () => [number("at-sample", values["at-sample"]), number("at-seconds", values["at-seconds"])] as const, catch: e => e as VisualTimelineError });
  const record = yield* addShot({ story, settings: run.timeline, mode,
    ...(startSample !== undefined ? { startSample } : {}), ...(startSeconds !== undefined ? { startSeconds } : {}),
    ...(values.label !== undefined ? { label: values.label } : {}), ...(values.prompt !== undefined ? { prompt: values.prompt } : {}),
    ...(values.image !== undefined ? { imageSourcePath: values.image } : {}), ...(values.notes !== undefined ? { notes: values.notes } : {}),
    producer: { name: values["producer-name"] ?? "visual-timeline-cli", version: values["producer-version"] ?? packageJson.version } });
  yield* print(record);
});

main.pipe(
  Effect.catch((error) => Console.error(error instanceof VisualTimelineError || error instanceof StoryError || error instanceof RunError ? `${error.code}: ${error.message}` : "Cannot write the visual timeline.").pipe(
    Effect.andThen(Effect.sync(() => { process.exitCode = 1; })),
  )),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
