import { parseArgs } from "node:util";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Layer } from "effect";
import packageJson from "../package.json" with { type: "json" };
import { EditorServerError, makeEditorServer } from "./modules/editor-server/index.js";
import { StoryPlanningError } from "./modules/story-planning/index.js";

const usage = `Usage: node dist/editor-server.js --config config/editor-server.json --port 63620 [--static <dir>]

Serve every story under the config's storiesDirectory on 127.0.0.1 with no authentication. The story-planning config names the default:
  /api/stories, then under /api/stories/:storyId: /story /timeline /decisions /word-timing /word-timing/align /shots /shots/:id/image /audio /peaks /speech /events
With --static, files under <dir> are served at / with index.html as the fallback for unknown non-API paths.
Config paths resolve from the config file. The listening URL, help, and errors go to stderr. Ctrl-C stops the server.`;
const invalid = (message: string) => new EditorServerError({ code: "InvalidRequest", message });

const main = Effect.gen(function* () {
  const { values } = yield* Effect.try({
    try: () => parseArgs({ options: { config: { type: "string" }, port: { type: "string" }, static: { type: "string" }, help: { type: "boolean" } }, strict: true, allowPositionals: false }),
    catch: () => invalid("Invalid arguments. Run with --help for usage."),
  });
  if (values.help) return yield* Console.error(usage);
  if (!values.config) return yield* Effect.fail(invalid("Supply an explicit --config path. Run with --help for usage."));
  if (!values.port || !/^\d+$/.test(values.port) || Number(values.port) < 1 || Number(values.port) > 65_535) return yield* Effect.fail(invalid("Supply an explicit --port between 1 and 65535."));
  return yield* Layer.launch(makeEditorServer({ configPath: values.config, port: Number(values.port), producer: { name: "editor", version: packageJson.version },
    ...(values.static !== undefined ? { staticDirectory: values.static } : {}) }));
});

main.pipe(
  Effect.catch(error => Console.error(error instanceof EditorServerError || error instanceof StoryPlanningError ? `${error.code}: ${error.message}` : `Cannot start the editor server: ${String(error)}`).pipe(
    Effect.andThen(Effect.sync(() => { process.exitCode = 1; })),
  )),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
