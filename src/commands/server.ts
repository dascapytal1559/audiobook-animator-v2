import { Effect, Layer, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import packageJson from "../../package.json" with { type: "json" };
import { makeEditorServer } from "../modules/editor-server/index.js";
import { handle, run, runFlag } from "./shared.js";

const serve = Command.make("serve", {
  port: Flag.integer("port").pipe(Flag.withDescription("Loopback port to listen on.")),
  static: Flag.optional(Flag.string("static")).pipe(Flag.withDescription("Directory of built client files to serve at /, with index.html answering unknown non-API paths.")),
  run: runFlag,
}, handle(({ port, static: staticDirectory, run: runPath }) => Effect.gen(function* () {
  if (port < 1 || port > 65_535) return yield* Effect.fail(new Error("Supply --port between 1 and 65535."));
  const settings = yield* run(runPath);
  return yield* Layer.launch(makeEditorServer({ storiesDirectory: settings.storiesDirectory, settings: { story: settings.story, timeline: settings.timeline, editor: settings.editor }, port,
    producer: { name: "editor", version: packageJson.version }, ...(Option.isSome(staticDirectory) ? { staticDirectory: staticDirectory.value } : {}) }));
}))).pipe(Command.withDescription("Serve every story under the stories directory on 127.0.0.1 with no authentication and no default story. The listening URL and the effective settings go to stderr. Ctrl-C stops it."));

export const serverCommand = Command.make("server").pipe(Command.withDescription("The editor server the browser client talks to."), Command.withSubcommands([serve]));
