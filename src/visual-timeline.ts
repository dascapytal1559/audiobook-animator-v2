import { parseArgs } from "node:util";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Stdio, Stream } from "effect";
import packageJson from "../package.json" with { type: "json" };
import { addShot, loadVisualTimeline, ShotMode, VisualTimelineError } from "./modules/visual-timeline/index.js";

const usage = `Usage:
  node dist/visual-timeline.js show --config config/visual-timeline.json
  node dist/visual-timeline.js add  --config config/visual-timeline.json (--at-sample N | --at-seconds S) --mode <graphic-illustration|poetic-abstraction>
                                    [--label TEXT] [--prompt TEXT] [--image PATH] [--notes TEXT] [--producer-name NAME] [--producer-version VERSION]

show  loads every generation record under <story>/shots/ and the decisions overlay, verifies them against the story selected by the
      story-planning config, and prints the merged candidates and stitched timeline as JSON on stdout.
add   mints a ULID, copies --image (resolved from the working directory) beside a new record.json, and prints the record.
Config paths resolve from the config file. Help and errors go to stderr. Default producer is ${packageJson.name}/visual-timeline-cli ${packageJson.version}.`;
const invalid = (message: string) => new VisualTimelineError({ code: "InvalidRequest", message });
const number = (name: string, value: string | undefined) => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed)) throw invalid(`--${name} must be a finite number.`);
  return parsed;
};

const main = Effect.gen(function* () {
  const { values, positionals } = yield* Effect.try({
    try: () => parseArgs({ options: { config: { type: "string" }, help: { type: "boolean" }, "at-sample": { type: "string" }, "at-seconds": { type: "string" }, mode: { type: "string" },
      label: { type: "string" }, prompt: { type: "string" }, image: { type: "string" }, notes: { type: "string" }, "producer-name": { type: "string" }, "producer-version": { type: "string" } },
      strict: true, allowPositionals: true }),
    catch: () => invalid("Invalid arguments. Run with --help for usage."),
  });
  if (values.help) return yield* Console.error(usage);
  const [command, ...rest] = positionals;
  if ((command !== "show" && command !== "add") || rest.length > 0) return yield* Effect.fail(invalid("Expected exactly one command: show or add. Run with --help for usage."));
  if (!values.config) return yield* Effect.fail(invalid("Supply an explicit --config path. Run with --help for usage."));
  const stdio = yield* Stdio.Stdio;
  const print = (value: unknown) => Stream.make(`${JSON.stringify(value, null, 2)}\n`).pipe(Stream.run(stdio.stdout({ endOnDone: false })));
  if (command === "show") return yield* print(yield* loadVisualTimeline({ configPath: values.config }));
  const mode = values.mode;
  if (mode !== "graphic-illustration" && mode !== "poetic-abstraction") return yield* Effect.fail(invalid(`--mode must be one of ${ShotMode.literals.join(", ")}.`));
  const [startSample, startSeconds] = yield* Effect.try({ try: () => [number("at-sample", values["at-sample"]), number("at-seconds", values["at-seconds"])] as const, catch: e => e as VisualTimelineError });
  const record = yield* addShot({ configPath: values.config, mode,
    ...(startSample !== undefined ? { startSample } : {}), ...(startSeconds !== undefined ? { startSeconds } : {}),
    ...(values.label !== undefined ? { label: values.label } : {}), ...(values.prompt !== undefined ? { prompt: values.prompt } : {}),
    ...(values.image !== undefined ? { imageSourcePath: values.image } : {}), ...(values.notes !== undefined ? { notes: values.notes } : {}),
    producer: { name: values["producer-name"] ?? "visual-timeline-cli", version: values["producer-version"] ?? packageJson.version } });
  yield* print(record);
});

main.pipe(
  Effect.catch((error) => Console.error("code" in error ? `${error.code}: ${error.message}` : "Cannot write the visual timeline.").pipe(
    Effect.andThen(Effect.sync(() => { process.exitCode = 1; })),
  )),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
