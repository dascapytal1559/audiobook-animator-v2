import { parseArgs } from "node:util";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Stdio, Stream } from "effect";
import { BookTranscriptionError, importRevBookTranscript, prepareRevBook } from "./intake/transcription/book.js";

const main = Effect.gen(function* () {
  const { values, positionals } = yield* Effect.try({
    try: () => parseArgs({ options: { run: { type: "string" }, transcript: { type: "string" }, "job-id": { type: "string" }, help: { type: "boolean" } }, strict: true, allowPositionals: true }),
    catch: () => new BookTranscriptionError({ code: "InvalidConfig", message: "Invalid arguments. Run with --help for usage." }),
  });
  if (values.help) {
    yield* Console.error("Usage:\n  node dist/book-transcription.js prepare --run <run.json>\n  node dist/book-transcription.js import --run <run.json> --transcript <Rev JSON export> --job-id <Rev ID>\n\nBoth commands verify the pinned source file and preserve source inspection. Import makes no network request; its job/source/export association is supplied by the operator. Provider timestamps remain uncalibrated to extraction clocks. Run-file paths resolve relative to the run file, whose content is copied into the preparation record; command paths resolve from the working directory. JSON results go to stdout; help and errors go to stderr.");
    return;
  }
  const command = positionals[0];
  if (positionals.length !== 1 || (command !== "prepare" && command !== "import") || !values.run) {
    return yield* Effect.fail(new BookTranscriptionError({ code: "InvalidConfig", message: "Supply prepare or import and an explicit --run path. Run with --help for usage." }));
  }
  if (command === "prepare" && (values.transcript !== undefined || values["job-id"] !== undefined)) return yield* Effect.fail(new BookTranscriptionError({ code: "InvalidConfig", message: "prepare accepts only --run; transcript and job ID belong to import." }));
  if (command === "import" && (!values.transcript || !values["job-id"])) return yield* Effect.fail(new BookTranscriptionError({ code: "InvalidConfig", message: "import requires both --transcript and --job-id." }));
  const result = command === "prepare"
    ? yield* prepareRevBook({ configPath: values.run })
    : yield* importRevBookTranscript({ configPath: values.run, transcriptPath: values.transcript ?? "", jobId: values["job-id"] ?? "" });
  const stdio = yield* Stdio.Stdio;
  yield* Stream.make(`${JSON.stringify(result, null, 2)}\n`).pipe(Stream.run(stdio.stdout({ endOnDone: false })));
});

main.pipe(
  Effect.catch((error) => Console.error("code" in error ? `${error.code}: ${error.message}` : "Cannot write the whole-book result.").pipe(
    Effect.andThen(Effect.sync(() => { process.exitCode = 1; })),
  )),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
