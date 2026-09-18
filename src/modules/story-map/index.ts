import { join, resolve, sep } from "node:path";
import { Effect, FileSystem } from "effect";
import { decodeJson, imageContentType, readBounded } from "../../core/io.js";
import { clipOf, type StoryContext } from "../story/index.js";
import { isMapError, type MapCode, mapError, STORY_MAP_FILE, StoryMap, storyMapProblems } from "./contracts.js";
import { sameClip } from "@animator/domain";
export * from "./contracts.js";

const fail = (code: MapCode, message: string) => Effect.fail(mapError({ code, message }));

/** One reference image the map names, resolved: the subject it belongs to, its index in that subject's list, the absolute path, and the content type. */
export type MapImage = { readonly subjectId: string; readonly index: number; readonly path: string; readonly contentType: string };
export type LoadedStoryMap = { readonly path: string; readonly map: StoryMap; readonly images: ReadonlyArray<MapImage> };

/**
 * `<story>/story-map.json`, read fresh: decoded strictly, pinned to the verified clip, checked against the transcript's word order
 * (`storyMapProblems`), and every image resolved inside the story directory to an existing image file. An absent file is `NotFound`,
 * which the explorer shows as "no map yet"; anything else wrong is an error naming the file and the rule.
 */
export function loadStoryMap(options: { readonly story: StoryContext; readonly wordIds: ReadonlyArray<string>; readonly maxBytes: number }): Effect.Effect<LoadedStoryMap, ReturnType<typeof mapError>, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const storyDirectory = options.story.storyDirectory;
    const path = join(storyDirectory, STORY_MAP_FILE);
    if (!(yield* fs.exists(path).pipe(Effect.mapError(() => mapError({ code: "IoFailed", message: `Cannot inspect ${path}.` }))))) return yield* fail("NotFound", `No story map: ${path}.`);
    const bytes = yield* readBounded(path, options.maxBytes).pipe(Effect.mapError(e => mapError({ code: "IoFailed", message: e.message })));
    const map = yield* decodeJson(StoryMap, bytes, path, true).pipe(Effect.mapError(e => mapError({ code: "InvalidMap", message: e.message })));
    if (!sameClip(map.clip, clipOf(options.story))) return yield* fail("IdentityMismatch", `Story map is pinned to a different clip than the verified story: ${path}.`);
    const problems = storyMapProblems(map, options.wordIds);
    if (problems.length > 0) return yield* fail("InvalidMap", `${problems[0]} in ${path}.`);
    const images: MapImage[] = [];
    for (const subject of map.subjects) {
      for (const [index, image] of (subject.images ?? []).entries()) {
        const absolute = resolve(storyDirectory, image.path);
        if (!absolute.startsWith(`${storyDirectory}${sep}`)) return yield* fail("InvalidMap", `subject ${subject.id} image ${index} leaves the story directory in ${path}.`);
        const contentType = imageContentType(absolute);
        if (contentType === undefined) return yield* fail("InvalidMap", `subject ${subject.id} image ${index} must be a .png, .jpg, .jpeg, or .webp file, not ${image.path}, in ${path}.`);
        const info = yield* fs.stat(absolute).pipe(Effect.mapError(() => mapError({ code: "InvalidMap", message: `subject ${subject.id} image ${index} does not exist: ${absolute}, named in ${path}.` })));
        if (info.type !== "File") return yield* fail("InvalidMap", `subject ${subject.id} image ${index} is not a regular file: ${absolute}, named in ${path}.`);
        images.push({ subjectId: subject.id, index, path: absolute, contentType });
      }
    }
    return { path, map, images };
  }).pipe(Effect.mapError(e => isMapError(e) ? e : mapError({ code: "IoFailed", message: "Cannot read the story map." })));
}
