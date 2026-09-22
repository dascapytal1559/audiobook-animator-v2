/**
 * Scene description takes (A63): what a beat looks like, as written by each model asked. A story may carry `<story>/scene-descriptions.json`,
 * a sidecar of the story map that holds every take ever recorded; nothing in it is ever replaced, and no take is picked. The Scenes
 * section shows every take for the shown beat side by side. A take names its beat by the map section's id and the word range that section
 * covered when the take was written, so a later map edit is visible rather than silent.
 */
import { Schema } from "effect";
import { ClipIdentity, Producer } from "./identity.js";
import { Id, IsoUtc, Text } from "./schema.js";
import { ShotId } from "./shots.js";
import { WordRange } from "./story-map.js";

/** A model id as its provider names it, such as `anthropic/claude-fable-5.1`: lowercase segments of letters, digits, dots, and hyphens, joined by slashes. */
export const ModelId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9.-]*(?:\/[a-z0-9][a-z0-9.-]*)*$/));
export type ModelId = typeof ModelId.Type;

/** What a writer supplies for one take: the beat, the model that wrote the text, the text, and optionally the prompt it answered and notes on the run. */
export const SceneDescriptionTakeBody = Schema.Struct({
  sectionId: Id, model: ModelId, text: Text, prompt: Schema.optionalKey(Text), notes: Schema.optionalKey(Text),
});
export type SceneDescriptionTakeBody = typeof SceneDescriptionTakeBody.Type;
/** One recorded take: the body plus the id, the section's word range at the time, when it was recorded, and who recorded it. Never edited once written. */
export const SceneDescriptionTake = Schema.Struct({ id: ShotId, ...SceneDescriptionTakeBody.fields, ...WordRange.fields, createdAt: IsoUtc, producer: Producer });
export type SceneDescriptionTake = typeof SceneDescriptionTake.Type;
/** `<story>/scene-descriptions.json`, pinned to the clip identity like every per-story artifact. `takes` only ever grows. */
export const SceneDescriptions = Schema.Struct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal("scene-descriptions"), clip: ClipIdentity, updatedAt: IsoUtc, takes: Schema.Array(SceneDescriptionTake),
});
export type SceneDescriptions = typeof SceneDescriptions.Type;

/** Every rule the takes must satisfy among themselves; empty when they are usable. Sections are checked by the writer against the map at write time, not here, since a map may change after a take is recorded. */
export function sceneDescriptionProblems(takes: ReadonlyArray<SceneDescriptionTake>): ReadonlyArray<string> {
  const problems: string[] = [];
  const ids = new Set<string>();
  const seen = new Set<string>();
  for (const take of takes) {
    if (ids.has(take.id)) problems.push(`take ${take.id} appears twice`);
    ids.add(take.id);
    const key = JSON.stringify([take.sectionId, take.model, take.text]);
    if (seen.has(key)) problems.push(`take ${take.id} repeats an earlier take by ${take.model} for section ${take.sectionId}`);
    seen.add(key);
  }
  return problems;
}

/** The takes for one section, oldest first, so the pane reads in the order the models answered. */
export const takesForSection = (takes: ReadonlyArray<SceneDescriptionTake>, sectionId: string): ReadonlyArray<SceneDescriptionTake> =>
  takes.filter(take => take.sectionId === sectionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
