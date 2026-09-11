import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import packageJson from "../../package.json" with { type: "json" };
import { alignTiming, loadEditorContext, loadTiming, makeCaches } from "../modules/editor-server/index.js";
import { measureRange } from "../modules/word-timing/index.js";
import { handle, invalid, printJson, run, runFlag, story, storyFlag } from "./shared.js";

const from = Flag.optional(Flag.float("from")).pipe(Flag.withDescription("Range start in seconds on the clip clock, inclusive."));
const to = Flag.optional(Flag.float("to")).pipe(Flag.withDescription("Range end in seconds on the clip clock, exclusive."));

/** The verified story as the editor sees it, plus the sample range the flags name. */
const open = (flags: { readonly story: Option.Option<string>; readonly run: Option.Option<string>; readonly from: Option.Option<number>; readonly to: Option.Option<number>; readonly all: boolean }) => Effect.gen(function* () {
  const settings = yield* run(flags.run);
  const storyDirectory = yield* story(settings, flags.story);
  const storyId = storyDirectory.slice(storyDirectory.lastIndexOf("/") + 1);
  const seconds = (name: string, value: Option.Option<number>) => {
    if (Option.isNone(value)) return undefined;
    if (!Number.isFinite(value.value) || value.value < 0) throw invalid(`--${name} must be a non-negative finite number of seconds.`);
    return value.value;
  };
  const [start, end] = yield* Effect.try({ try: () => [seconds("from", flags.from), seconds("to", flags.to)] as const, catch: e => e as ReturnType<typeof invalid> });
  if (flags.all && (start !== undefined || end !== undefined)) return yield* Effect.fail(invalid("--all excludes --from and --to."));
  if (!flags.all && (start === undefined || end === undefined)) return yield* Effect.fail(invalid("Supply --from and --to in seconds, or --all for the whole clip."));
  const ctx = yield* loadEditorContext({ storiesDirectory: settings.storiesDirectory, settings: { story: settings.story, timeline: settings.timeline, editor: settings.editor }, storyId });
  const range = flags.all ? { startSample: 0, endSample: ctx.clip.sampleCount } : { startSample: Math.round(start! * ctx.clip.sampleRateHz), endSample: Math.min(ctx.clip.sampleCount, Math.round(end! * ctx.clip.sampleRateHz)) };
  return { ctx, range };
});

const measure = Command.make("measure", { story: storyFlag, run: runFlag, from, to }, handle(flags => Effect.gen(function* () {
  const { ctx, range } = yield* open({ ...flags, all: false });
  if (range.startSample >= range.endSample || range.endSample > ctx.clip.sampleCount) return yield* Effect.fail(invalid(`Range must satisfy 0 <= from < to <= ${ctx.clip.sampleCount / ctx.clip.sampleRateHz} seconds.`));
  const caches = makeCaches(ctx);
  const speech = yield* caches.speech;
  const timing = yield* loadTiming(ctx);
  const boundaryPauseSamples = Math.round((ctx.settings.editor.alignment.boundaryPauseMs / 1000) * ctx.clip.sampleRateHz);
  const inRange = <W extends { readonly startSample: number }>(words: ReadonlyArray<W>) => words.filter(w => w.startSample >= range.startSample && w.startSample < range.endSample);
  const measureWords = (words: ReadonlyArray<{ readonly startSample: number; readonly endSample: number }>) => measureRange({ words, regions: speech.regions, sampleRateHz: ctx.clip.sampleRateHz, boundaryPauseSamples });
  yield* printJson({ range, regionCount: speech.regions.filter(r => r.endSample > range.startSample && r.startSample < range.endSample).length, boundaryPauseMs: ctx.settings.editor.alignment.boundaryPauseMs,
    original: measureWords(inRange(ctx.words)), effective: measureWords(inRange(timing.effective.words)), inversions: timing.effective.inversions, manualCount: timing.effective.manualCount, autoCount: timing.effective.autoCount });
}))).pipe(Command.withDescription("Print onset-error and inside-speech statistics for a range, once for the original transcript timing and once for the effective timing, without writing. Needs the speech regions, computed once with ffmpeg and cached beside the waveform peaks."));

const align = Command.make("align", {
  story: storyFlag, run: runFlag, from, to,
  all: Flag.boolean("all").pipe(Flag.withDefault(false), Flag.withDescription("The explicit whole-clip flag (A43).")),
  dryRun: Flag.boolean("dry-run").pipe(Flag.withDefault(false), Flag.withDescription("Print the report and write nothing.")),
}, handle(flags => Effect.gen(function* () {
  const { ctx, range } = yield* open(flags);
  const report = yield* alignTiming(ctx, makeCaches(ctx), { range, wholeClip: flags.all, dryRun: flags.dryRun, producer: { name: "word-timing-cli", version: packageJson.version } });
  yield* printJson({ dryRun: flags.dryRun, ...report });
}))).pipe(Command.withDescription("Run the energy-only pass (lead shift, phrase snap, interior scale) over the words whose original start lies in the range, merge the result into <story>/word-timing.auto.json, and print the before/after report. word-timing.json, the editor's manual overlay, is never touched."));

export const timingCommand = Command.make("timing").pipe(Command.withDescription("Word timing against the audio: measure a range or run the automatic pass over it."), Command.withSubcommands([measure, align]));
