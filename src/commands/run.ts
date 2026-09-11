import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { handle, printJson, run, runFlag } from "./shared.js";

const show = Command.make("show", { run: runFlag }, handle(({ run: runPath }) => Effect.flatMap(run(runPath), printJson)))
  .pipe(Command.withDescription("Print the effective settings: the code defaults, or the defaults with --run laid over them. Pipe it into a file to start a run file."));

export const runCommand = Command.make("run").pipe(Command.withDescription("Settings are code defaults plus an optional run file; this shows the result."), Command.withSubcommands([show]));
