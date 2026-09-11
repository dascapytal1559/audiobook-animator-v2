import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { promoteStoryTranscript } from "../modules/story-transcription/promote.js";
import { handle, printJson, run, runFlag, story, storyFlag } from "./shared.js";

const defaults = Command.make("defaults", { run: runFlag }, handle(({ run: runPath }) => Effect.gen(function* () {
  yield* printJson((yield* run(runPath)).transcription);
}))).pipe(Command.withDescription("Print the transcription settings a run would use, as the JSON the Python transcribe script takes with --run. Add the story's spelling hints under keywords."));

const promote = Command.make("promote", {
  story: storyFlag, run: runFlag,
  input: Flag.string("input").pipe(Flag.withDescription("The prepared transcript JSON written by scripts/prepare-story-transcript.py.")),
}, handle(({ story: id, run: runPath, input }) => Effect.gen(function* () {
  const settings = yield* run(runPath);
  const storyDirectory = yield* story(settings, id);
  yield* printJson(yield* Effect.tryPromise({ try: () => promoteStoryTranscript({ storyDirectory, inputPath: input, maxElements: settings.story.limits.maxElements }), catch: e => e instanceof Error ? e : new Error(String(e)) }));
}))).pipe(Command.withDescription("Make prepared GPT text the story's working transcript: verifies it belongs to the story, archives the prior identity and overlays, and rewrites transcript.json, transcript.txt, and the manifest. Restart the editor afterwards."));

export const transcriptionCommand = Command.make("transcription").pipe(
  Command.withDescription("Story-level re-transcription with GPT. The transcribe, stitch, and prepare steps are Python scripts under scripts/ (transcribe-story.py --run, stitch-story-transcript.py, prepare-story-transcript.py); this tree lists them and owns the promote step."),
  Command.withSubcommands([defaults, promote]),
);
