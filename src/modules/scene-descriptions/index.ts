import { join } from "node:path";
import { Effect, FileSystem } from "effect";
import { sameClip, type Section } from "@animator/domain";
import { decodeJson, encodeJson, readBounded, writeAtomic } from "../../core/io.js";
import { clipOf, type StoryContext } from "../story/index.js";
import { mintUlid } from "../visual-timeline/ulid.js";
import { type DescriptionsCode, descriptionsError, isDescriptionsError, SCENE_DESCRIPTIONS_FILE, SceneDescriptions, type SceneDescriptionTake, type SceneDescriptionTakeBody, sceneDescriptionProblems } from "./contracts.js";
export * from "./contracts.js";

const fail = (code: DescriptionsCode, message: string) => Effect.fail(descriptionsError({ code, message }));
const wrap = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.mapError(e => isDescriptionsError(e) ? e : descriptionsError({ code: "IoFailed", message: e instanceof Error ? e.message : "Cannot read the scene descriptions." })));

export type DescriptionsTarget = { readonly story: StoryContext; readonly maxBytes: number };
const pathOf = (target: DescriptionsTarget) => join(target.story.storyDirectory, SCENE_DESCRIPTIONS_FILE);

/**
 * `<story>/scene-descriptions.json`, read fresh: decoded strictly, pinned to the verified clip, and checked for repeated takes. An absent
 * file is the normal state before any take is recorded and reads as no takes; anything else wrong is an error naming the file and the rule.
 */
export function loadSceneDescriptions(target: DescriptionsTarget): Effect.Effect<ReadonlyArray<SceneDescriptionTake>, ReturnType<typeof descriptionsError>, FileSystem.FileSystem> {
  return wrap(Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = pathOf(target);
    if (!(yield* fs.exists(path).pipe(Effect.mapError(() => descriptionsError({ code: "IoFailed", message: `Cannot inspect ${path}.` }))))) return [];
    const bytes = yield* readBounded(path, target.maxBytes).pipe(Effect.mapError(e => descriptionsError({ code: "IoFailed", message: e.message })));
    const file = yield* decodeJson(SceneDescriptions, bytes, path, true).pipe(Effect.mapError(e => descriptionsError({ code: "InvalidDescriptions", message: e.message })));
    if (!sameClip(file.clip, clipOf(target.story))) return yield* fail("IdentityMismatch", `Scene descriptions are pinned to a different clip than the verified story: ${path}.`);
    const problems = sceneDescriptionProblems(file.takes);
    if (problems.length > 0) return yield* fail("InvalidDescriptions", `${problems[0]} in ${path}.`);
    return file.takes;
  }));
}

export type AddTakeRequest = DescriptionsTarget & {
  readonly take: SceneDescriptionTakeBody;
  /** The map's sections as loaded: the take must name one of them, and records the words it covered. */
  readonly sections: ReadonlyArray<Section>;
  readonly producer: { readonly name: string; readonly version: string };
};
/**
 * Append one take: the file is reread, the take appended with a fresh id and time, and the whole file written by temp file and rename, so a
 * reader never sees a partial file and no earlier take is touched. A take that repeats an earlier one's section, model, and text is refused
 * as `TakeExists`, so a rerun of the same generation is a no-op rather than a duplicate. Callers serialize writers to one story; two writers
 * appending at once would each read the same file and the later rename would drop the earlier take.
 */
export function addSceneDescriptionTake(request: AddTakeRequest): Effect.Effect<SceneDescriptionTake, ReturnType<typeof descriptionsError>, FileSystem.FileSystem> {
  return wrap(Effect.gen(function* () {
    const path = pathOf(request);
    const section = request.sections.find(s => s.id === request.take.sectionId);
    if (section === undefined) return yield* fail("InvalidRequest", `The story map has no section ${request.take.sectionId}.`);
    const previous = yield* loadSceneDescriptions(request);
    const now = new Date().toISOString();
    const take: SceneDescriptionTake = { id: mintUlid(), ...request.take, startWordId: section.startWordId, endWordId: section.endWordId, createdAt: now, producer: request.producer };
    const takes = [...previous, take];
    const problems = sceneDescriptionProblems(takes);
    if (problems.length > 0) return yield* fail("TakeExists", `${problems[0]}: ${path}.`);
    const bytes = encodeJson({ schemaVersion: 1, kind: "scene-descriptions", clip: clipOf(request.story), updatedAt: now, takes });
    const decoded = yield* decodeJson(SceneDescriptions, bytes, "the new take", true).pipe(Effect.mapError(e => descriptionsError({ code: "InvalidRequest", message: e.message })));
    if (bytes.byteLength > request.maxBytes) return yield* fail("InvalidRequest", `The scene descriptions would exceed the ${request.maxBytes}-byte limit.`);
    yield* writeAtomic(path, bytes).pipe(Effect.mapError(e => descriptionsError({ code: "IoFailed", message: e.message })));
    return decoded.takes[decoded.takes.length - 1]!;
  }));
}
