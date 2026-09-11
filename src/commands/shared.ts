/** What every verb shares: the run and story flags, JSON on stdout, and module errors rendered as `code: message` on stderr. */
import { Effect, Option, Stdio, Stream } from "effect";
import { CliError, Flag } from "effect/unstable/cli";
import { loadRun, type RunSettings, selectStory } from "../run.js";

export const runFlag = Flag.optional(Flag.string("run")).pipe(Flag.withDescription("JSON run file laid over the code defaults; any subset of storiesDirectory, booksDirectory, story, timeline, editor, inventory, transcription."));
export const storyFlag = Flag.optional(Flag.string("story")).pipe(Flag.withDescription("Story id: the folder name under the stories directory. Omit it to list the ids."));

/** Every module error carries a stable code and a message naming the file or rule; that pair is the whole of what a user needs. */
export const userError = (cause: unknown): CliError.UserError => new CliError.UserError({
  cause,
  userMessage: typeof cause === "object" && cause !== null && "code" in cause && "message" in cause ? `${String(cause.code)}: ${String(cause.message)}` : cause instanceof Error ? cause.message : String(cause),
});
/** Run a verb body and render any module failure as a user error. */
export const handle = <I, A, E, R>(body: (input: I) => Effect.Effect<A, E, R>) => (input: I) => body(input).pipe(Effect.mapError(e => CliError.isCliError(e) ? e : userError(e)));

export const printJson = (value: unknown) => Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio;
  yield* Stream.make(`${JSON.stringify(value, null, 2)}\n`).pipe(Stream.run(stdio.stdout({ endOnDone: false })));
});

/** The run for this invocation: defaults, or a run file over them. */
export const run = (flag: Option.Option<string>) => loadRun(Option.getOrUndefined(flag));
/** The story directory for `--story`, or NotFound listing what is there. */
export const story = (settings: RunSettings, flag: Option.Option<string>) => selectStory(settings, Option.getOrUndefined(flag));
export const invalid = (message: string): CliError.UserError => new CliError.UserError({ cause: new Error(message), userMessage: message });
