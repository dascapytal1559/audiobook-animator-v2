import { Schema } from "effect";
import { Id, Positive, Sha256, Text } from "./schema.js";

/** The verified clip an overlay, record, or cache is pinned to. Every field must equal the loaded story; a mismatch is rejected, never merged. */
export const ClipIdentity = Schema.Struct({ bookId: Id, storyId: Id, audioSha256: Sha256, transcriptSha256: Sha256, sampleRateHz: Positive, sampleCount: Positive });
export type ClipIdentity = typeof ClipIdentity.Type;
export const sameClip = (a: ClipIdentity, b: ClipIdentity): boolean => (Object.keys(ClipIdentity.fields) as Array<keyof ClipIdentity>).every(k => a[k] === b[k]);

/** Who wrote an artifact: a script, a CLI verb, or the editor, with its version. */
export const Producer = Schema.Struct({ name: Text, version: Text });
export type Producer = typeof Producer.Type;
