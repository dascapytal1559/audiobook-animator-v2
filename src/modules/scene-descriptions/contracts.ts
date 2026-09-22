import { errorsOf } from "../../core/error.js";
export { ModelId, SceneDescriptions, SceneDescriptionTake, SceneDescriptionTakeBody, sceneDescriptionProblems, takesForShot } from "@animator/domain";

/** The one file this module reads and appends to, at the top of the story directory (A63, A65). */
export const SCENE_DESCRIPTIONS_FILE = "scene-descriptions.json";

export type DescriptionsCode = "InvalidRequest" | "InvalidDescriptions" | "IdentityMismatch" | "TakeExists" | "IoFailed";
const errors = errorsOf<"descriptions", DescriptionsCode>("descriptions");
/** A scene-descriptions failure: the shared AnimatorError with this module's code union. */
export const descriptionsError = errors.make;
export const isDescriptionsError = errors.is;
