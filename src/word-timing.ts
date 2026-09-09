import { parseArgs } from "node:util";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Stdio, Stream } from "effect";
import packageJson from "../package.json" with { type: "json" };
import { alignTiming, EditorServerError, loadEditorContext, loadTiming, makeCaches } from "./modules/editor-server/index.js";
import { StoryPlanningError } from "./modules/story-planning/index.js";
import { measureRange, WordTimingError } from "./modules/word-timing/index.js";

const usage = `Usage:
  node dist/word-timing.js align   --config config/editor-server.json [--story <id>] (--from S --to S | --all) [--dry-run]
  node dist/word-timing.js measure --config config/editor-server.json [--story <id>] --from S --to S

align    runs the energy-only pass (lead shift, phrase snap, interior scale) over the words whose original start lies in [--from, --to) seconds,
         merges the result into <story>/word-timing.auto.json, and prints the before/after report as JSON on stdout. --all is the explicit
         whole-clip flag; --dry-run prints the report and writes nothing. word-timing.json (the editor's manual overlay) is never touched.
measure  prints the same statistics for the range without aligning: once for the original transcript timing and once for the effective timing.
Both need the speech regions, computed once with ffmpeg beside the waveform peaks and cached as <story>/cache/speech.json.
--story names a directory under the config's storiesDirectory; without it the story-planning config's default story is used.
Config paths resolve from the config file. Help and errors go to stderr.`;
const invalid = (message: string) => new EditorServerError({ code: "InvalidRequest", message });
const seconds = (name: string, value: string | undefined) => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed) || parsed < 0) throw invalid(`--${name} must be a non-negative finite number of seconds.`);
  return parsed;
};

const main = Effect.gen(function* () {
  const { values, positionals } = yield* Effect.try({
    try: () => parseArgs({ options: { config: { type: "string" }, story: { type: "string" }, help: { type: "boolean" }, from: { type: "string" }, to: { type: "string" }, all: { type: "boolean" }, "dry-run": { type: "boolean" } }, strict: true, allowPositionals: true }),
    catch: () => invalid("Invalid arguments. Run with --help for usage."),
  });
  if (values.help) return yield* Console.error(usage);
  const [command, ...rest] = positionals;
  if ((command !== "align" && command !== "measure") || rest.length > 0) return yield* Effect.fail(invalid("Expected exactly one command: align or measure. Run with --help for usage."));
  if (!values.config) return yield* Effect.fail(invalid("Supply an explicit --config path. Run with --help for usage."));
  const [from, to] = yield* Effect.try({ try: () => [seconds("from", values.from), seconds("to", values.to)] as const, catch: e => e as EditorServerError });
  const all = values.all === true;
  if (all && (from !== undefined || to !== undefined)) return yield* Effect.fail(invalid("--all excludes --from and --to."));
  if (!all && (from === undefined || to === undefined)) return yield* Effect.fail(invalid(command === "align" ? "Supply --from and --to in seconds, or --all for the whole clip." : "Supply --from and --to in seconds."));
  if (command === "measure" && all) return yield* Effect.fail(invalid("measure takes --from and --to, not --all."));
  if (values.story !== undefined && values.story.trim() === "") return yield* Effect.fail(invalid("--story must name a story directory."));
  const ctx = yield* loadEditorContext({ configPath: values.config, ...(values.story !== undefined ? { storyId: values.story } : {}) });
  const range = all ? { startSample: 0, endSample: ctx.clip.sampleCount } : { startSample: Math.round(from! * ctx.clip.sampleRateHz), endSample: Math.min(ctx.clip.sampleCount, Math.round(to! * ctx.clip.sampleRateHz)) };
  const caches = makeCaches(ctx);
  const stdio = yield* Stdio.Stdio;
  const print = (value: unknown) => Stream.make(`${JSON.stringify(value, null, 2)}\n`).pipe(Stream.run(stdio.stdout({ endOnDone: false })));
  if (command === "align") {
    const report = yield* alignTiming(ctx, caches, { range, wholeClip: all, dryRun: values["dry-run"] === true, producer: { name: "word-timing-cli", version: packageJson.version } });
    return yield* print({ dryRun: values["dry-run"] === true, ...report });
  }
  if (range.startSample >= range.endSample || range.endSample > ctx.clip.sampleCount) return yield* Effect.fail(invalid(`Range must satisfy 0 <= from < to <= ${ctx.clip.sampleCount / ctx.clip.sampleRateHz} seconds.`));
  const speech = yield* caches.speech;
  const timing = yield* loadTiming(ctx);
  const boundaryPauseSamples = Math.round((ctx.config.alignment.boundaryPauseMs / 1000) * ctx.clip.sampleRateHz);
  const inRange = <W extends { readonly startSample: number }>(words: ReadonlyArray<W>) => words.filter(w => w.startSample >= range.startSample && w.startSample < range.endSample);
  const measure = (words: ReadonlyArray<{ readonly startSample: number; readonly endSample: number }>) => measureRange({ words, regions: speech.regions, sampleRateHz: ctx.clip.sampleRateHz, boundaryPauseSamples });
  yield* print({ range, regionCount: speech.regions.filter(r => r.endSample > range.startSample && r.startSample < range.endSample).length, boundaryPauseMs: ctx.config.alignment.boundaryPauseMs,
    original: measure(inRange(ctx.words)), effective: measure(inRange(timing.effective.words)), inversions: timing.effective.inversions, manualCount: timing.effective.manualCount, autoCount: timing.effective.autoCount });
});

main.pipe(
  Effect.catch(error => Console.error(error instanceof EditorServerError || error instanceof StoryPlanningError || error instanceof WordTimingError ? `${error.code}: ${error.message}` : `Cannot run word timing: ${String(error)}`).pipe(
    Effect.andThen(Effect.sync(() => { process.exitCode = 1; })),
  )),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
