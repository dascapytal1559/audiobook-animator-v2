import { Schema } from "effect";
import { errorsOf } from "../../core/error.js";
import { NonNegative, Path, Positive, Text } from "@animator/domain";
export { STORYBOARD_TRACK, StoryboardDraft, StoryboardDraftRequest, StoryboardDrawRequest, StoryboardJob, StoryboardRenderer, USER_WRITER } from "@animator/domain";

/**
 * Settings for drafting and drawing storyboard frames (A66). Defaults live in code; a run file may override any of them under `storyboard`,
 * and every drawn record says which renderer made it and with what prompt.
 */
export const StoryboardSettings = Schema.Struct({
  /**
   * The primary renderer and the draft writer: `codex exec` under the ChatGPT login the Codex CLI holds, so a drawing is paid for by the
   * subscription. `model` runs the turn, which calls Codex's `image_generation` tool to draw. `home` is where Codex keeps its login and the
   * images it generates; absent, it is `$CODEX_HOME`, else `~/.codex`.
   */
  codex: Schema.Struct({
    executable: Path, model: Text, reasoningEffort: Schema.Literals(["minimal", "low", "medium", "high", "xhigh"]), home: Schema.optionalKey(Path),
    drawTimeoutMs: Positive, draftTimeoutMs: Positive,
  }),
  /**
   * The fallback renderer, tried only when the primary fails: one command line, run without a shell, that writes a PNG. `{promptFile}` is
   * replaced by a file holding the prompt and `{output}` by the PNG path to write.
   */
  fallback: Schema.Struct({ argv: Schema.NonEmptyArray(Text), timeoutMs: Positive }),
  /** How much narration a prompt quotes: words before and after the shot's first word for a draft, and words from it for a drawing. */
  excerpt: Schema.Struct({ draftWordsBefore: NonNegative, draftWordsAfter: Positive, drawWords: Positive }),
});
export type StoryboardSettings = typeof StoryboardSettings.Type;

export const storyboardDefaults: StoryboardSettings = {
  codex: { executable: "codex", model: "gpt-6-astra", reasoningEffort: "low", drawTimeoutMs: 300_000, draftTimeoutMs: 120_000 },
  // The A64 recipe for Qwen Image 2.1 through the MFLUX CLI: 8-bit weights, 1024x576, 40 steps, guidance 1.0, seed 42.
  fallback: {
    argv: ["mflux-generate-qwen-2.1", "--model", "JoyFusionAI/Qwen-Image-2.1-MLX-8bit", "--base-model", "qwen-image-2.1", "--quantize", "8", "--prompt-file", "{promptFile}",
      "--seed", "42", "--width", "1024", "--height", "576", "--steps", "40", "--guidance", "1.0", "--output", "{output}"],
    timeoutMs: 900_000,
  },
  excerpt: { draftWordsBefore: 60, draftWordsAfter: 90, drawWords: 40 },
};

export type StoryboardCode = "InvalidRequest" | "JobRunning" | "DraftFailed" | "RendererFailed" | "IoFailed";
const errors = errorsOf<"storyboard", StoryboardCode>("storyboard");
/** A storyboard failure: the shared AnimatorError with this module's code union. */
export const storyboardError = errors.make;
export const isStoryboardError = errors.is;
