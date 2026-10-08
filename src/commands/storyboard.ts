import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import packageJson from "../../package.json" with { type: "json" };
import { applyFirstPass, loadEditorContext, planFirstPass, type StoryboardRun } from "../modules/editor-server/index.js";
import { StoryboardJobBook } from "../modules/storyboard/index.js";
import { handle, printJson, run, runFlag, story, storyFlag } from "./shared.js";

const firstPass = Command.make("first-pass", {
  story: storyFlag, run: runFlag,
  section: Flag.string("section").pipe(Flag.withDescription("The story map's id of the beat or scene to plan, such as beat-01.")),
  dryRun: Flag.boolean("dry-run").pipe(Flag.withDefault(false), Flag.withDescription("Print the plan and write nothing.")),
}, handle(flags => Effect.gen(function* () {
  const settings = yield* run(flags.run);
  const storyDirectory = yield* story(settings, flags.story);
  const ctx = yield* loadEditorContext({ storiesDirectory: settings.storiesDirectory, settings: { story: settings.story, timeline: settings.timeline, editor: settings.editor }, storyId: storyDirectory.slice(storyDirectory.lastIndexOf("/") + 1) });
  const storyboard: StoryboardRun = { settings: settings.storyboard, producer: { name: "storyboard-cli", version: packageJson.version }, jobs: new StoryboardJobBook(settings.storyboard.concurrentDraws) };
  yield* Console.error(`Planning ${flags.section} of ${ctx.clip.storyId} with ${settings.storyboard.codex.writerModel}…`);
  const plan = yield* planFirstPass(ctx, storyboard, flags.section);
  yield* Console.error(`Planned ${plan.shots.length} shots in ${Math.round(plan.seconds)} s${plan.unmatched.length === 0 ? "" : `; ${plan.unmatched.length} proposed shots could not be placed`}.`);
  if (flags.dryRun) return yield* printJson({ dryRun: true, plan });
  const { result, runs } = yield* applyFirstPass(ctx, storyboard, { sectionId: plan.sectionId, model: plan.model, prompt: plan.prompt, shots: plan.shots.map(({ anchorWordId, text }) => ({ anchorWordId, text })) });
  yield* Console.error(`Drawing ${runs.length} frames, ${settings.storyboard.concurrentDraws} at a time…`);
  const jobs = yield* Effect.all(runs.map(drawing => drawing.pipe(Effect.tap(job => Console.error(`${job.anchorWordId}: ${job.status === "done" ? `drawn by ${job.attempts.at(-1)?.renderer}` : `failed: ${job.error}`}`)))), { concurrency: "unbounded" });
  yield* printJson({ dryRun: false, plan, result: { ...result, jobs } });
}))).pipe(Command.withDescription("Plan one beat or scene of the story map through the Codex CLI under the ChatGPT login: propose its shots, each anchored to its first word with a 30 to 60 word description; then declare each new storyboard frame, record each new description as the planning model's take, and draw every frame that has no drawing, a few at a time, waiting until they finish (A67). Shots, descriptions, and drawings that exist are kept. Progress goes to stderr; the plan and what was done, to stdout."));

export const storyboardCommand = Command.make("storyboard").pipe(Command.withDescription("The storyboard of one story: rough hand-drawn frames for its declared shots (A66, A67)."), Command.withSubcommands([firstPass]));
