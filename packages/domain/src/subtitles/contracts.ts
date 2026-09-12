import { Schema } from "effect";
import { NonNegative, Positive, Text } from "../schema.js";

/** Punctuation belongs to the text; only the original transcript token has a clock (A61). */
export const SubtitleToken = Schema.Struct({ wordId: Text, prefix: Schema.String, value: Text, suffix: Schema.String });
export type SubtitleToken = typeof SubtitleToken.Type;
export const SubtitleSentence = Schema.Struct({ id: Text, tokens: Schema.Array(SubtitleToken).check(Schema.isMinLength(1)) });
export type SubtitleSentence = typeof SubtitleSentence.Type;
export const SubtitleCue = Schema.Struct({
  id: Text,
  lines: Schema.Array(Schema.Array(SubtitleToken).check(Schema.isMinLength(1))).check(Schema.isMinLength(1), Schema.isMaxLength(2)),
  fontScale: Schema.Finite.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(1)),
});
export type SubtitleCue = typeof SubtitleCue.Type;
export const TimedSubtitleCue = Schema.Struct({ ...SubtitleCue.fields, startSample: NonNegative, endSample: Positive });
export type TimedSubtitleCue = typeof TimedSubtitleCue.Type;

/** Layout uses a fixed reference frame; the preview scales it as a whole, never regrouping on resize (A61). */
export const subtitleDefaults = {
  referenceWidth: 1000,
  fontSize: 32,
  fontFamily: "Arial, sans-serif",
  fontWeight: 500,
  lineWidth: 840,
  endHoldMs: 250,
  visible: true,
  highlight: false,
} as const;
