/**
 * Draft drawings (A68): drawings made in the Storyboard section's drafting space and not yet saved. Each lives in its own directory under
 * `<story>/storyboard-drafts/`, published by one rename like a shot record, so a reader never meets a half-written one, and a page reload
 * finds it again. A draft is never on the timeline; saving copies its image into a new storyboard record, and saving or discarding removes
 * it. A shot has at most one draft drawing: publishing a newer one removes the one before.
 */
import { extname, join } from "node:path";
import { Effect, FileSystem } from "effect";
import { type ClipIdentity, sameClip, type StoryboardDraftDrawing as DraftDrawing, StoryboardDraftDrawing, type StoryboardRenderer } from "@animator/domain";
import { decodeJson, encodeJson, readBounded, writeAtomic } from "../../core/io.js";
import { mintUlid } from "../visual-timeline/index.js";
import { storyboardError } from "./contracts.js";

/** The drafts directory of a story. */
export const draftsDirectory = (storyDirectory: string): string => join(storyDirectory, "storyboard-drafts");
const DRAFT_FILE = "draft.json";
const MAX_DRAFT_BYTES = 262_144;
const io = <A>(effect: Effect.Effect<A, unknown>, message: string) => effect.pipe(Effect.mapError(() => storyboardError({ code: "IoFailed", message })));

export type DraftTarget = { readonly storyDirectory: string; readonly clip: ClipIdentity; readonly maxImageBytes: number };

/**
 * Every draft drawing of a story, oldest first. A draft whose file is malformed or names another clip fails the listing, naming the file,
 * since it would otherwise be offered for saving into this story.
 */
export function listDraftDrawings(target: DraftTarget): Effect.Effect<ReadonlyArray<DraftDrawing>, ReturnType<typeof storyboardError>, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = draftsDirectory(target.storyDirectory);
    if (!(yield* io(fs.exists(directory), `Cannot inspect ${directory}.`))) return [];
    const names = (yield* io(fs.readDirectory(directory), `Cannot list ${directory}.`)).filter(name => !name.startsWith(".")).sort();
    const drafts = yield* Effect.forEach(names, name => Effect.gen(function* () {
      const path = join(directory, name, DRAFT_FILE);
      const bytes = yield* readBounded(path, MAX_DRAFT_BYTES).pipe(Effect.mapError(e => storyboardError({ code: "InvalidDraft", message: e.message })));
      const draft = yield* decodeJson(StoryboardDraftDrawing, bytes, path, true).pipe(Effect.mapError(e => storyboardError({ code: "InvalidDraft", message: e.message })));
      if (draft.id !== name) return yield* Effect.fail(storyboardError({ code: "InvalidDraft", message: `${path} names draft ${draft.id}, not its directory's ${name}.` }));
      if (!sameClip(draft.clip, target.clip)) return yield* Effect.fail(storyboardError({ code: "InvalidDraft", message: `${path} belongs to another clip than ${target.clip.storyId}'s.` }));
      return draft;
    }));
    return drafts.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  });
}

/** One draft drawing by id, or a failure naming it when it does not exist. */
export function readDraftDrawing(target: DraftTarget, id: string) {
  return Effect.flatMap(listDraftDrawings(target), drafts => {
    const draft = drafts.find(d => d.id === id);
    return draft === undefined ? Effect.fail(storyboardError({ code: "InvalidRequest", message: `No draft drawing ${id}; it may have been saved or discarded already.` })) : Effect.succeed(draft);
  });
}

/** The image file of a draft drawing. */
export const draftImagePath = (storyDirectory: string, draft: Pick<DraftDrawing, "id" | "imagePath">): string => join(draftsDirectory(storyDirectory), draft.id, draft.imagePath);

/** Remove every draft drawing of the shot drafted at a word; the ids removed. */
export function removeDraftDrawings(target: DraftTarget, anchorWordId: string, keep?: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const gone = (yield* listDraftDrawings(target)).filter(d => d.anchorWordId === anchorWordId && d.id !== keep);
    for (const draft of gone) {
      const directory = join(draftsDirectory(target.storyDirectory), draft.id);
      yield* io(fs.remove(directory, { recursive: true }), `Cannot remove the draft drawing ${directory}.`);
    }
    return gone.map(d => d.id);
  });
}

export type NewDraftDrawing = {
  readonly anchorWordId: string; readonly startWordId: string; readonly description: string;
  readonly renderer: StoryboardRenderer; readonly prompt: string; readonly notes: string; readonly imageSourcePath: string;
  readonly producer: { readonly name: string; readonly version: string };
};
/** Publish a draft drawing with a copy of its image, then remove the shot's earlier draft drawings: a newer drawing replaces the one before. */
export function writeDraftDrawing(target: DraftTarget, draft: NewDraftDrawing): Effect.Effect<DraftDrawing, ReturnType<typeof storyboardError>, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const parent = draftsDirectory(target.storyDirectory);
    const id = mintUlid();
    const image = yield* readBounded(draft.imageSourcePath, target.maxImageBytes).pipe(Effect.mapError(e => storyboardError({ code: "IoFailed", message: e.message })));
    const imagePath = `image${extname(draft.imageSourcePath).toLowerCase() || ".png"}`;
    const { imageSourcePath: _, ...fields } = draft;
    const written: DraftDrawing = { schemaVersion: 1, kind: "storyboard-draft-drawing", clip: target.clip, id, ...fields, imagePath, createdAt: new Date().toISOString() };
    const bytes = encodeJson(written);
    yield* decodeJson(StoryboardDraftDrawing, bytes, `the new draft drawing ${id}`, true).pipe(Effect.mapError(e => storyboardError({ code: "InvalidRequest", message: e.message })));
    yield* io(fs.makeDirectory(parent, { recursive: true }), `Cannot create ${parent}.`);
    yield* Effect.acquireUseRelease(
      io(fs.makeTempDirectory({ directory: parent, prefix: `.${id}.` }), `Cannot stage the draft drawing ${id}.`),
      staging => Effect.gen(function* () {
        yield* writeAtomic(join(staging, imagePath), image).pipe(Effect.mapError(e => storyboardError({ code: "IoFailed", message: e.message })));
        yield* writeAtomic(join(staging, DRAFT_FILE), bytes).pipe(Effect.mapError(e => storyboardError({ code: "IoFailed", message: e.message })));
        yield* io(fs.rename(staging, join(parent, id)), `Cannot publish the draft drawing ${join(parent, id)}.`);
      }),
      staging => fs.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore));
    yield* removeDraftDrawings(target, draft.anchorWordId, id);
    return written;
  });
}
