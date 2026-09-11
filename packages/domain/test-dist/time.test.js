import { test } from "node:test";
import assert from "node:assert/strict";
import { clampSample, formatClock, formatSampleClock, millisecondsToSamples, samplesToSeconds, secondsToSamples } from "./time.js";
test("samples and seconds convert through the sample rate", () => {
    assert.equal(samplesToSeconds(48000, 48000), 1);
    assert.equal(samplesToSeconds(24000, 48000), 0.5);
    assert.equal(secondsToSamples(1.5, 44100), 66150);
    assert.equal(secondsToSamples(-1, 44100), 0);
    assert.equal(millisecondsToSamples(300, 48000), 14400);
    assert.equal(millisecondsToSamples(100, 44100), 4410);
});
test("conversions reject invalid rates and non-finite input", () => {
    assert.throws(() => samplesToSeconds(1, 0), RangeError);
    assert.throws(() => secondsToSamples(1, 44100.5), RangeError);
    assert.throws(() => secondsToSamples(Number.NaN, 44100), RangeError);
    assert.throws(() => formatClock(Number.POSITIVE_INFINITY), RangeError);
});
test("clock formatting is h:mm:ss.mmm and truncates to the millisecond", () => {
    assert.equal(formatClock(0), "0:00:00.000");
    assert.equal(formatClock(1.2345), "0:00:01.234");
    assert.equal(formatClock(61.5), "0:01:01.500");
    assert.equal(formatClock(3600 + 2 * 60 + 3.007), "1:02:03.007");
    assert.equal(formatClock(7 * 3600 + 59 * 60 + 59.9999), "7:59:59.999");
    assert.equal(formatClock(-0.5), "0:00:00.000");
    assert.equal(formatSampleClock(72000, 48000), "0:00:01.500");
});
test("clampSample keeps a sample inside [0, sampleCount)", () => {
    assert.equal(clampSample(-5, 100), 0);
    assert.equal(clampSample(100, 100), 99);
    assert.equal(clampSample(42.6, 100), 43);
    assert.throws(() => clampSample(1, 0), RangeError);
});
//# sourceMappingURL=time.test.js.map