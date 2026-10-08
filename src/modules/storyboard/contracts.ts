import { Schema } from "effect";
import { errorsOf } from "../../core/error.js";
import { NonNegative, Path, Positive, Text } from "@animator/domain";
export { STORYBOARD_TRACK, StationDrawRequest, StationVersionRequest, StoryboardFirstPassApply, StoryboardFirstPassPlan, StoryboardFirstPassPlanRequest, StoryboardFirstPassResult, StoryboardJob, StoryboardRenderer, StoryboardSnapshotRequest, StoryboardSnapshotResult } from "@animator/domain";

/**
 * Settings for drawing storyboard frames (A66), a section's first pass (A67), and the shot station (A69). Defaults live in code; a run file
 * may override any of them under `storyboard`, and every drawn image and written text says which model made it and with what prompt.
 */
export const StoryboardSettings = Schema.Struct({
  /**
   * The Codex CLI under the ChatGPT login it holds, so its turns are paid for by the subscription. `writerModel` writes every text the
   * storyboard asks for: a first pass's plan and the shot station's directions, mixes, and edits; it is the one setting to change to try
   * another writer. `drawModel` runs a drawing turn, which calls Codex's `image_generation` tool. `home` is where Codex keeps its login and
   * the images it generates; absent, it is `$CODEX_HOME`, else `~/.codex`. A plan has its own, longer limit than the station's writing.
   */
  codex: Schema.Struct({
    executable: Path, writerModel: Text, drawModel: Text, reasoningEffort: Schema.Literals(["minimal", "low", "medium", "high", "xhigh"]), home: Schema.optionalKey(Path),
    drawTimeoutMs: Positive, writeTimeoutMs: Positive, planTimeoutMs: Positive,
  }),
  /**
   * How many drawings run at once; the rest wait their turn (A67). Four, so a shot station description's four directions draw together
   * (A69); a first pass's frames then draw four at a time too, still a small share of the subscription's limits.
   */
  concurrentDraws: Positive,
  /**
   * The fallback renderer, tried only when the primary fails: one command line, run without a shell, that writes a PNG. `{promptFile}` is
   * replaced by a file holding the prompt and `{output}` by the PNG path to write.
   */
  fallback: Schema.Struct({ argv: Schema.NonEmptyArray(Text), timeoutMs: Positive }),
  /**
   * How much narration a prompt quotes: words before and after a shot's first word for the station's writer (after at least the words the
   * shot covers), words from it for a first pass's drawing, and words before the section, as context, for a first pass's plan.
   */
  excerpt: Schema.Struct({ spanWordsBefore: NonNegative, spanWordsAfter: Positive, drawWords: Positive, planWordsBefore: NonNegative }),
  /** The shot station (A69): the most directions one description may ask for; the editor asks for four unless the director picks another number. */
  station: Schema.Struct({ maxDirections: Positive }),
});
export type StoryboardSettings = typeof StoryboardSettings.Type;

export const storyboardDefaults: StoryboardSettings = {
  codex: { executable: "codex", writerModel: "gpt-6-astra", drawModel: "gpt-6-astra", reasoningEffort: "low", drawTimeoutMs: 300_000, writeTimeoutMs: 180_000, planTimeoutMs: 300_000 },
  concurrentDraws: 4,
  // The A64 recipe for Qwen Image 2.1 through the MFLUX CLI: 8-bit weights, 1024x576, 40 steps, guidance 1.0, seed 42.
  fallback: {
    argv: ["mflux-generate-qwen-2.1", "--model", "JoyFusionAI/Qwen-Image-2.1-MLX-8bit", "--base-model", "qwen-image-2.1", "--quantize", "8", "--prompt-file", "{promptFile}",
      "--seed", "42", "--width", "1024", "--height", "576", "--steps", "40", "--guidance", "1.0", "--output", "{output}"],
    timeoutMs: 900_000,
  },
  excerpt: { spanWordsBefore: 60, spanWordsAfter: 90, drawWords: 40, planWordsBefore: 60 },
  station: { maxDirections: 6 },
};

export type StoryboardCode = "InvalidRequest" | "JobRunning" | "WriteFailed" | "PlanFailed" | "RendererFailed" | "InvalidStation" | "IoFailed";
const errors = errorsOf<"storyboard", StoryboardCode>("storyboard");
/** A storyboard failure: the shared AnimatorError with this module's code union. */
export const storyboardError = errors.make;
export const isStoryboardError = errors.is;
