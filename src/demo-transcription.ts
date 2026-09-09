import { parseArgs } from "node:util";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Console, Effect, Stdio, Stream } from "effect";
import { importRevDemoTranscript, runRevDemo, TranscriptionError } from "./modules/transcription/index.js";

const main = Effect.gen(function* () {
  const { values } = yield* Effect.try({
    try: () => parseArgs({ options: {
      config: { type: "string" }, "import-transcript": { type: "string" },
      "job-id": { type: "string" }, help: { type: "boolean" },
    }, strict: true, allowPositionals: false }),
    catch: () => new TranscriptionError({ code: "InvalidConfig", message: "Invalid arguments. Run with --help for usage." }),
  });
  if (values.help) {
    yield* Console.error("Usage:\n  node dist/demo-transcription.js --config config/rev-demo.json --import-transcript <Rev JSON> --job-id <ID>\n  REV_AI_API_KEY=<set in environment> node dist/demo-transcription.js --config config/rev-demo.json [--job-id <recovery ID>]\n\nImport makes no network request and requires no credentials. API mode can submit one paid clip, then saves its ID for subsequent runs. Paths inside config resolve relative to that config file. JSON results go to stdout; diagnostics go to stderr.");
    return;
  }
  if (!values.config) return yield* Effect.fail(new TranscriptionError({ code: "InvalidConfig", message: "Supply --config with an explicit Rev demo configuration path." }));
  const configPath = values.config;
  const result = values["import-transcript"] !== undefined
    ? yield* importRevDemoTranscript({ configPath, transcriptPath: values["import-transcript"], jobId: values["job-id"] ?? "" })
    : yield* Effect.gen(function* () {
      const token = yield* Config.redacted("REV_AI_API_KEY").pipe(
        Effect.mapError(() => new TranscriptionError({ code: "MissingCredential", message: "Set REV_AI_API_KEY in the environment, or use --import-transcript with a completed dashboard export." })),
      );
      return yield* runRevDemo({ configPath, token, ...(values["job-id"] === undefined ? {} : { resumeJobId: values["job-id"] }) });
    });
  const stdio = yield* Stdio.Stdio;
  yield* Stream.make(`${JSON.stringify(result, null, 2)}\n`).pipe(Stream.run(stdio.stdout({ endOnDone: false })));
});

main.pipe(
  Effect.catch((error) => Console.error(error instanceof TranscriptionError ? `${error.code}: ${error.message}` : "Cannot write the demo result.").pipe(
    Effect.andThen(Effect.sync(() => { process.exitCode = 1; })),
  )),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
