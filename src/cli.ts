import { Console as NodeConsole } from "node:console";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Console, Effect, Logger } from "effect";
import { CliError, Command } from "effect/unstable/cli";
import packageJson from "../package.json" with { type: "json" };
import { inspectCommand } from "./commands/inspect.js";

const command = Command.make("animator").pipe(
  Command.withDescription("Turn audiobooks into movies. Data goes to stdout; help and diagnostics go to stderr."),
  Command.withSubcommands([inspectCommand]),
);

const diagnosticConsole = new NodeConsole({
  stdout: process.stderr,
  stderr: process.stderr,
  colorMode: false,
});

command.pipe(
  Command.run({ version: packageJson.version, renderErrors: true }),
  Effect.tapCause((cause) => {
    if (Cause.hasInterruptsOnly(cause) || CliError.isCliError(Cause.squash(cause))) return Effect.void;
    return Console.error(Cause.pretty(cause));
  }),
  Effect.provideService(Console.Console, diagnosticConsole),
  Effect.provideService(Logger.LogToStderr, true),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
