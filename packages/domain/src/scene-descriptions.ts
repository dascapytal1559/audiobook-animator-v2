/**
 * Scene description takes (A63, A65): what a shot looks like, as written by each model asked. A story may carry
 * `<story>/scene-descriptions.json`, which holds every take ever recorded; nothing in it is ever replaced, and no take is picked. A take
 * belongs to the declared shot it depicts and names it by the shot's anchor word, so it follows timing edits, and a shot that is moved to
 * another word or removed leaves its takes behind rather than lending them to a moment they were not written for. The story map plays no part.
 */
import { Schema } from "effect";
import { ClipIdentity, Producer } from "./identity.js";
import { IsoUtc, Text } from "./schema.js";
import { ShotId } from "./shots.js";

/** A model id as its provider names it, such as `anthropic/claude-fable-5.1`: lowercase segments of letters, digits, dots, and hyphens, joined by slashes. */
export const ModelId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9.-]*(?:\/[a-z0-9][a-z0-9.-]*)*$/));
export type ModelId = typeof ModelId.Type;

/** What a writer supplies for one take: the anchor word of the declared shot it depicts, the model that wrote the text, the text, and optionally the prompt it answered and notes on the run. */
export const SceneDescriptionTakeBody = Schema.Struct({
  anchorWordId: Text, model: ModelId, text: Text, prompt: Schema.optionalKey(Text), notes: Schema.optionalKey(Text),
});
export type SceneDescriptionTakeBody = typeof SceneDescriptionTakeBody.Type;
/** One recorded take: the body plus the id, when it was recorded, and who recorded it. Never edited once written. */
export const SceneDescriptionTake = Schema.Struct({ id: ShotId, ...SceneDescriptionTakeBody.fields, createdAt: IsoUtc, producer: Producer });
export type SceneDescriptionTake = typeof SceneDescriptionTake.Type;
/** `<story>/scene-descriptions.json`, pinned to the clip identity like every per-story artifact. `takes` only ever grows. Version 1 keyed takes to map sections and is gone (A65). */
export const SceneDescriptions = Schema.Struct({
  schemaVersion: Schema.Literal(2), kind: Schema.Literal("scene-descriptions"), clip: ClipIdentity, updatedAt: IsoUtc, takes: Schema.Array(SceneDescriptionTake),
});
export type SceneDescriptions = typeof SceneDescriptions.Type;

/** Every rule the takes must satisfy among themselves; empty when they are usable. The shot is checked by the writer against the timeline at write time, not here, since a shot may move or go after a take is recorded. */
export function sceneDescriptionProblems(takes: ReadonlyArray<SceneDescriptionTake>): ReadonlyArray<string> {
  const problems: string[] = [];
  const ids = new Set<string>();
  const seen = new Set<string>();
  for (const take of takes) {
    if (ids.has(take.id)) problems.push(`take ${take.id} appears twice`);
    ids.add(take.id);
    const key = JSON.stringify([take.anchorWordId, take.model, take.text]);
    if (seen.has(key)) problems.push(`take ${take.id} repeats an earlier take by ${take.model} for the shot at ${take.anchorWordId}`);
    seen.add(key);
  }
  return problems;
}

/** The takes for the shot anchored at one word, oldest first, so the pane reads in the order the models answered. */
export const takesForShot = (takes: ReadonlyArray<SceneDescriptionTake>, anchorWordId: string): ReadonlyArray<SceneDescriptionTake> =>
  takes.filter(take => take.anchorWordId === anchorWordId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
