/** Book intake: frozen tools that turn an audiobook into story directories. Each takes its per-book run file as --run. */
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { Effect, FileSystem, Option, Schema, Struct } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { inspectSourceMedia, SourceMediaRequest } from "../intake/source-media/index.js";
import { formatSplitFailure } from "../intake/story-split/diagnostics.js";
import { splitStories, validateStorySplit } from "../intake/story-split/index.js";
import { importRevBookTranscript, prepareRevBook } from "../intake/transcription/book.js";
import { handle, invalid, printJson } from "./shared.js";

const runFile = (description: string) => Flag.string("run").pipe(Flag.withDescription(description));
const InspectionRun = SourceMediaRequest.mapFields(Struct.omit(["sourcePath"]));

const inspect = Command.make("inspect", {
  source: Flag.string("source").pipe(Flag.withDescription("Local source audio path, relative to the current directory or absolute.")),
  run: runFile("Run file (JSON) with the probe settings; ffprobePath is a PATH command, an absolute path, or a path relative to the run file."),
}, handle(({ source, run }) => Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const runPath = resolve(run);
  const text = yield* fs.readFileString(runPath, "utf8").pipe(Effect.mapError(cause => invalid(`Cannot read source inspection run file ${runPath}: ${cause.message}`)));
  const options = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(InspectionRun), { errors: "all", onExcessProperty: "error" })(text)
    .pipe(Effect.mapError(cause => invalid(`Invalid source inspection run file ${runPath}: ${cause.message}`)));
  const executable = options.ffprobePath;
  const ffprobePath = !isAbsolute(executable) && (executable.includes("/") || executable.includes(sep)) ? resolve(dirname(runPath), executable) : executable;
  yield* printJson(yield* inspectSourceMedia({ ...options, sourcePath: source, ffprobePath }));
}))).pipe(Command.withDescription("Inspect source audio and print evidence as JSON on stdout. Metadata does not approve stories. Help and errors go to stderr."));

const prepare = Command.make("prepare", { run: runFile("The book's run file: pinned source, limits, inspection settings. Copied into artifacts/preparation.json.") },
  handle(({ run }) => Effect.flatMap(prepareRevBook({ configPath: run }), printJson)))
  .pipe(Command.withDescription("Verify the pinned source and write the whole-book preparation record. Makes no network request."));

const importCommand = Command.make("import", {
  run: runFile("The book's run file, the same one prepare was given."),
  transcript: Flag.optional(Flag.string("transcript")).pipe(Flag.withDescription("The Rev JSON export downloaded from the dashboard.")),
  jobId: Flag.optional(Flag.string("job-id")).pipe(Flag.withDescription("The Rev job id shown for that export.")),
}, handle(({ run, transcript, jobId }) => Effect.gen(function* () {
  if (Option.isNone(transcript) || Option.isNone(jobId)) return yield* Effect.fail(invalid("import requires both --transcript and --job-id."));
  yield* printJson(yield* importRevBookTranscript({ configPath: run, transcriptPath: transcript.value, jobId: jobId.value }));
}))).pipe(Command.withDescription("Import a whole-book Rev export as the book's timed transcript. Import makes no network request; its job, source, and export association is supplied by the operator, and provider timestamps remain uncalibrated to extraction clocks."));

const split = Command.make("split", {
  plan: Flag.string("plan").pipe(Flag.withDescription("The reviewed split plan; its paths resolve from the plan file.")),
  run: runFile("The split run file: concurrency, limits, tool paths (resolved from the run file). Copied into split/run-manifest.json."),
  source: Flag.optional(Flag.string("source")).pipe(Flag.withDescription("Current location of a moved source; must match the plan's pinned bytes.")),
  output: Flag.optional(Flag.string("output")).pipe(Flag.withDescription("Directory to write into; required unless --validate-only.")),
  validateOnly: Flag.boolean("validate-only").pipe(Flag.withDefault(false), Flag.withDescription("Check the plan and identities without extracting anything.")),
}, ({ plan, run, source, output, validateOnly }) => Effect.gen(function* () {
  if ((!validateOnly && Option.isNone(output)) || (validateOnly && Option.isSome(output))) return yield* Effect.fail(invalid("Supply --plan and --run, plus either --output or --validate-only."));
  const inputs = { planPath: plan, configPath: run, ...(Option.isSome(source) ? { sourcePath: source.value } : {}) };
  const result = validateOnly ? yield* validateStorySplit(inputs) : yield* splitStories({ ...inputs, artifactDirectory: Option.getOrElse(output, () => "") });
  yield* printJson(result);
}).pipe(Effect.mapError(e => e instanceof Error && "userMessage" in e ? e : invalid(formatSplitFailure(e, { summaryBytes: 2048, detailBytes: 8192 })))))
  .pipe(Command.withDescription("Split a book into story and extra pairs from a reviewed plan. The plan supplies every transcript range and decoded-audio sample interval; the splitter does not discover or choose cuts. It verifies all input identities, extracts each pair, and publishes the duration inventory only after every pair succeeds."));

export const intakeCommand = Command.make("intake").pipe(
  Command.withDescription("Book intake, run once per book: inspect the source, prepare and import the whole-book transcript, split it into stories. Frozen; new books may need bespoke handling."),
  Command.withSubcommands([inspect, prepare, importCommand, split]),
);
