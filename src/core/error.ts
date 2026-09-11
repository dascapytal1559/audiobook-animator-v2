import { Data } from "effect";

/** Which part of the system failed; the code within it names the rule and the message names the file. One class, so a caller can always read `module` and `code`. */
export type Module = "core" | "run" | "story" | "inventory" | "timeline" | "timing" | "editor";
export class AnimatorError extends Data.TaggedError("AnimatorError")<{
  readonly module: Module;
  readonly code: string;
  readonly message: string;
  /** The file the failure is about, when there is one. */
  readonly path?: string;
}> {}
/** A module's typed constructor: its own code union, the shared class. */
export const errorsOf = <M extends Module, C extends string>(module: M) => ({
  make: (props: { readonly code: C; readonly message: string; readonly path?: string }) => new AnimatorError({ module, ...props }),
  is: (value: unknown): value is AnimatorError & { readonly module: M; readonly code: C } => value instanceof AnimatorError && value.module === module,
});
