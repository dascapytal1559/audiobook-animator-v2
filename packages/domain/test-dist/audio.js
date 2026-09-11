import { Schema } from "effect";
import { NonNegative, Positive, Sha256 } from "./schema.js";
const Int16 = Schema.Int.check(Schema.isBetween({ minimum: -32768, maximum: 32767 }));
/** `<story>/cache/peaks.json` and `GET .../peaks`: int16 min/max per bucket of decoded mono samples, pinned to the clip's audio hash. The last bucket may be partial. */
export const PeaksFile = Schema.Struct({
    schemaVersion: Schema.Literal(1), audioSha256: Sha256, sampleRateHz: Positive, sampleCount: Positive, samplesPerBucket: Positive,
    min: Schema.Array(Int16), max: Schema.Array(Int16),
});
/** `<story>/cache/speech.json` and `GET .../speech`: detected speech regions on the clip clock, pinned to the audio hash and the detection parameters (A46). */
export const SpeechFile = Schema.Struct({
    schemaVersion: Schema.Literal(1), kind: Schema.Literal("speech-regions"), audioSha256: Sha256, sampleRateHz: Positive, sampleCount: Positive,
    frameSamples: Positive, thresholdDbfs: Schema.Number, minSilenceMs: Positive, minSpeechMs: Positive,
    regions: Schema.Array(Schema.Struct({ startSample: NonNegative, endSample: NonNegative })),
});
//# sourceMappingURL=audio.js.map