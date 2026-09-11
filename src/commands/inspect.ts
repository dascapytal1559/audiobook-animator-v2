import { dirname, isAbsolute, resolve, sep } from "node:path";
import { Effect, FileSystem, Schema, Stdio, Stream, Struct } from "effect";
import { CliError, Command, Flag } from "effect/unstable/cli";
import { inspectSourceMedia, SourceMediaRequest } from "../intake/source-media/index.js";

const InspectionConfig = SourceMediaRequest.mapFields(Struct.omit(["sourcePath"]));
const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(InspectionConfig), {
  errors: "all",
  onExcessProperty: "error",
});

export const inspectCommand = Command.make("inspect", {
  source: Flag.string("source").pipe(
    Flag.withSchema(SourceMediaRequest.fields.sourcePath),
    Flag.withDescription("Local source audio path, relative to the current directory or absolute."),
  ),
  run: Flag.string("run").pipe(
    Flag.withSchema(SourceMediaRequest.fields.sourcePath),
    Flag.withDescription("Required run file (JSON) with the probe settings, relative to the current directory or absolute."),
  ),
}, Effect.fn("inspectCommand")(function* ({ source, run }: { readonly source: string; readonly run: string }) {
  const fs = yield* FileSystem.FileSystem;
  const configPath = resolve(run);
  const text = yield* fs.readFileString(configPath, "utf8").pipe(
    Effect.mapError((cause) => new CliError.UserError({
      cause,
      userMessage: `Cannot read source inspection run file ${configPath}: ${cause.message}`,
    })),
  );
  const options = yield* decodeConfig(text).pipe(
    Effect.mapError((cause) => new CliError.UserError({
      cause,
      userMessage: `Invalid source inspection run file ${configPath}: ${cause.message}`,
    })),
  );
  const executable = options.ffprobePath;
  const ffprobePath = !isAbsolute(executable) && (executable.includes("/") || executable.includes(sep))
    ? resolve(dirname(configPath), executable)
    : executable;
  const inspection = yield* inspectSourceMedia({ ...options, sourcePath: source, ffprobePath }).pipe(
    Effect.mapError((cause) => new CliError.UserError({
      cause,
      userMessage: `${cause.code}: ${cause.message}`,
    })),
  );
  const stdio = yield* Stdio.Stdio;
  yield* Stream.make(`${JSON.stringify(inspection, null, 2)}\n`).pipe(
    Stream.run(stdio.stdout({ endOnDone: false })),
    Effect.mapError((cause) => new CliError.UserError({
      cause,
      userMessage: `Cannot write source inspection JSON: ${cause.message}`,
    })),
  );
})).pipe(
  Command.withShortDescription("Inspect source audio and print evidence as JSON."),
  Command.withDescription("Inspect source audio and print evidence as JSON on stdout. Metadata does not approve stories. Help and errors go to stderr. In the run file, ffprobePath is a PATH command, an absolute path, or a path relative to the run file directory."),
);
