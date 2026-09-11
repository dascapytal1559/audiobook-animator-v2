import { Console as NodeConsole } from "node:console";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Console, Effect, Logger } from "effect";
import { CliError, Command } from "effect/unstable/cli";
import packageJson from "../package.json" with { type: "json" };
import { intakeCommand } from "./commands/intake.js";
import { inventoryCommand } from "./commands/inventory.js";
import { runCommand } from "./commands/run.js";
import { serverCommand } from "./commands/server.js";
import { statusCommand } from "./commands/status.js";
import { storyCommand } from "./commands/story.js";
import { timelineCommand } from "./commands/timeline.js";
import { timingCommand } from "./commands/timing.js";
import { transcriptionCommand } from "./commands/transcription.js";

/** One tree, one help. Every story-level verb takes --story <id> and an optional --run <file>; data goes to stdout, help and diagnostics to stderr. */
const command = Command.make("animator").pipe(
  Command.withDescription("Turn audiobooks into movies. Settings are code defaults plus an optional --run file. Story-level verbs take --story <id>, the folder under data/stories/. Data goes to stdout; help and diagnostics go to stderr."),
  Command.withSubcommands([statusCommand, intakeCommand, storyCommand, inventoryCommand, timelineCommand, timingCommand, transcriptionCommand, serverCommand, runCommand]),
);

const diagnosticConsole = new NodeConsole({ stdout: process.stderr, stderr: process.stderr, colorMode: false });

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
