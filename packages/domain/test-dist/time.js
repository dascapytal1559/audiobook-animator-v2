/** Sample/second conversion and clock formatting. Every conversion goes through the clip's sample rate. */
export function samplesToSeconds(sample, sampleRateHz) {
    assertRate(sampleRateHz);
    return sample / sampleRateHz;
}
/** Rounds to the nearest integer sample and clamps at zero. */
export function secondsToSamples(seconds, sampleRateHz) {
    assertRate(sampleRateHz);
    if (!Number.isFinite(seconds))
        throw new RangeError(`seconds must be finite, got ${seconds}.`);
    return Math.max(0, Math.round(seconds * sampleRateHz));
}
export function millisecondsToSamples(milliseconds, sampleRateHz) {
    return secondsToSamples(milliseconds / 1000, sampleRateHz);
}
/** Formats seconds as h:mm:ss.mmm, truncating (never rounding up) to the millisecond so a clock never reads past the playhead. */
export function formatClock(seconds) {
    if (!Number.isFinite(seconds))
        throw new RangeError(`seconds must be finite, got ${seconds}.`);
    const totalMs = Math.max(0, Math.floor(seconds * 1000 + 1e-6));
    const ms = totalMs % 1000;
    const totalSeconds = Math.floor(totalMs / 1000);
    const s = totalSeconds % 60;
    const m = Math.floor(totalSeconds / 60) % 60;
    const h = Math.floor(totalSeconds / 3600);
    return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
}
export function formatSampleClock(sample, sampleRateHz) {
    return formatClock(samplesToSeconds(sample, sampleRateHz));
}
export function clampSample(sample, sampleCount) {
    if (!Number.isInteger(sampleCount) || sampleCount < 1)
        throw new RangeError(`sampleCount must be a positive integer, got ${sampleCount}.`);
    return Math.min(sampleCount - 1, Math.max(0, Math.round(sample)));
}
function assertRate(sampleRateHz) {
    if (!Number.isInteger(sampleRateHz) || sampleRateHz < 1)
        throw new RangeError(`sampleRateHz must be a positive integer, got ${sampleRateHz}.`);
}
function pad(n, width) {
    return n.toString().padStart(width, "0");
}
//# sourceMappingURL=time.js.map