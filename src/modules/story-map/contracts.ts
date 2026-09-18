import { errorsOf } from "../../core/error.js";
export { currentSections, isInsidePath, type MapWord, resolveStoryMap, type ResolvedSection, type ResolvedStoryMap, type ResolvedSubject, Section, SectionKind, StoryMap, storyMapProblems, Subject, SubjectImage, SubjectKind, WordRange } from "@animator/domain";

/** The one file this module reads, at the top of the story directory beside `decisions.json` (A62). */
export const STORY_MAP_FILE = "story-map.json";

export type MapCode = "NotFound" | "InvalidMap" | "IdentityMismatch" | "IoFailed";
const errors = errorsOf<"map", MapCode>("map");
/** A story-map failure: the shared AnimatorError with this module's code union. */
export const mapError = errors.make;
export const isMapError = errors.is;
