import { Data, Schema } from "effect";

export const Sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const JobId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/));

export type TranscriptionErrorCode = "InvalidConfig" | "InvalidResponse" | "InvalidTimestamps";

export class TranscriptionError extends Data.TaggedError("TranscriptionError")<{
  readonly code: TranscriptionErrorCode;
  readonly message: string;
}> {}

export const Punctuation = Schema.Struct({
  kind: Schema.Literal("punctuation"), id: Schema.String, speaker: Schema.Int, value: Schema.String,
});
export type Punctuation = typeof Punctuation.Type;
