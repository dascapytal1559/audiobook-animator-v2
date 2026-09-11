import assert from "node:assert/strict";
import test from "node:test";
import { alignRange, effectiveTiming, measureRange, validateEntries } from "./index.js";
const RATE = 1000;
const word = (id, startSample, endSample) => ({ id, startSample, endSample });
const base = { sampleRateHz: RATE, leadMs: 150, boundaryPauseMs: 300 };
test("effective timing is manual, else auto, else original, counts each layer, and counts neighbouring start inversions instead of rejecting them", () => {
    const words = [{ id: "a", value: "A", startSample: 0, endSample: 10 }, { id: "b", value: "B", startSample: 10, endSample: 20 }, { id: "c", value: "C", startSample: 20, endSample: 30 }];
    const auto = { a: { startSample: 2, endSample: 12 }, b: { startSample: 12, endSample: 22 } };
    const manual = { b: { startSample: 15, endSample: 25 }, c: { startSample: 5, endSample: 8 } };
    const result = effectiveTiming(words, auto, manual);
    assert.deepEqual(result.words, [
        { id: "a", value: "A", startSample: 2, endSample: 12, original: { startSample: 0, endSample: 10 }, auto: auto.a },
        { id: "b", value: "B", startSample: 15, endSample: 25, original: { startSample: 10, endSample: 20 }, auto: auto.b, manual: manual.b },
        { id: "c", value: "C", startSample: 5, endSample: 8, original: { startSample: 20, endSample: 30 }, manual: manual.c }
    ]);
    assert.deepEqual([result.inversions, result.manualCount, result.autoCount], [1, 2, 2]);
    const untouched = effectiveTiming(words, undefined, undefined);
    assert.deepEqual(untouched.words.map(w => [w.startSample, w.endSample, "auto" in w, "manual" in w]), [[0, 10, false, false], [10, 20, false, false], [20, 30, false, false]]);
    assert.deepEqual([untouched.inversions, untouched.manualCount, untouched.autoCount], [0, 0, 0]);
});
test("overlay validation names unknown ids and bad ranges, and accepts entries that touch the clip end", () => {
    const ids = new Set(["a", "b"]);
    assert.equal(validateEntries({ a: { startSample: 0, endSample: 100 } }, ids, 100, "f.json"), null);
    assert.match(validateEntries({ zz: { startSample: 0, endSample: 1 } }, ids, 100, "f.json"), /not in the transcript: zz in f\.json/);
    assert.match(validateEntries({ a: { startSample: 5, endSample: 5 } }, ids, 100, "f.json"), /startSample < endSample/);
    assert.match(validateEntries({ a: { startSample: 6, endSample: 5 } }, ids, 100, "f.json"), /for a must satisfy/);
    assert.match(validateEntries({ b: { startSample: 0, endSample: 101 } }, ids, 100, "f.json"), /<= 100/);
});
test("align: a lone word fills its region, several words scale linearly between the region edges, order is kept, and results are integers", () => {
    const words = [word("w1", 1000, 1300), word("w2", 2000, 2200), word("w3", 2200, 2500), word("w4", 2500, 2800)];
    const regions = [{ startSample: 1100, endSample: 1500 }, { startSample: 2300, endSample: 3300 }];
    const { entries, report } = alignRange({ ...base, words, regions, range: { startSample: 0, endSample: 4000 } });
    assert.deepEqual(entries["w1"], { startSample: 1100, endSample: 1500 }, "shifted 1150..1450 overlaps region 1 most and fills it");
    // w2..w4 shift to 2150..2950 and stretch onto 2300..3300: scale 1000/800 = 1.25.
    assert.deepEqual(entries["w2"], { startSample: 2300, endSample: 2550 });
    assert.deepEqual(entries["w3"], { startSample: 2550, endSample: 2925 });
    assert.deepEqual(entries["w4"], { startSample: 2925, endSample: 3300 });
    assert.ok(Object.values(entries).every(e => Number.isInteger(e.startSample) && Number.isInteger(e.endSample) && e.startSample < e.endSample));
    assert.deepEqual([report.wordCount, report.regionCount, report.leadMs, report.boundaryPauseMs], [4, 2, 150, 300]);
    assert.deepEqual(report.before.onsetErrorMs, { median: -200, p10: -280, p90: -120 }, "two boundaries (w1, and w2 after a 700 ms pause) start 100 and 300 ms before their nearest onsets");
    assert.deepEqual(report.after.onsetErrorMs, { median: 0, p10: 0, p90: 0 });
    assert.deepEqual([report.before.insideSpeechCount, report.before.insideSpeechFraction], [1, 0.25], "only w4 already sits inside a region");
    assert.deepEqual([report.after.insideSpeechCount, report.after.insideSpeechFraction], [4, 1]);
});
test("align: a word wholly in silence attaches to the nearest region; regions with no words are ignored; ties go to the earliest region", () => {
    const words = [word("far", 100, 200), word("mid", 1000, 1100)];
    const regions = [{ startSample: 400, endSample: 500 }, { startSample: 1400, endSample: 1500 }, { startSample: 3000, endSample: 3100 }];
    const { entries } = alignRange({ ...base, words, regions, range: { startSample: 0, endSample: 4000 } });
    assert.deepEqual(entries, { far: { startSample: 400, endSample: 500 }, mid: { startSample: 1400, endSample: 1500 } }, "shifted 250..350 is nearer 400 than 1400; 1150..1250 is nearer 1400 than 500");
    const tie = alignRange({ ...base, leadMs: 0, words: [word("t", 600, 700)], regions: [{ startSample: 400, endSample: 500 }, { startSample: 800, endSample: 900 }], range: { startSample: 0, endSample: 1000 } });
    assert.deepEqual(tie.entries, { t: { startSample: 400, endSample: 500 } });
});
test("align: only words whose original start lies in the range are touched, regions are clipped to the range, and nothing ever leaves it", () => {
    const words = [word("before", 500, 900), word("in1", 1000, 1200), word("in2", 1300, 1500), word("after", 2000, 2200)];
    const regions = [{ startSample: 600, endSample: 1250 }, { startSample: 1400, endSample: 2300 }];
    const range = { startSample: 1000, endSample: 2000 };
    const { entries, report } = alignRange({ ...base, words, regions, range });
    assert.deepEqual(Object.keys(entries).sort(), ["in1", "in2"], "ids outside the range are never written; `after` starts exactly at the exclusive end");
    for (const e of Object.values(entries))
        assert.ok(e.startSample >= 1000 && e.endSample <= 2000, JSON.stringify(e));
    assert.deepEqual(entries["in1"], { startSample: 1000, endSample: 1250 }, "region 1 clipped to 1000..1250");
    assert.deepEqual(entries["in2"], { startSample: 1400, endSample: 2000 }, "region 2 clipped to 1400..2000");
    assert.equal(report.wordCount, 2);
    assert.equal(report.regionCount, 2);
    const none = alignRange({ ...base, words, regions: [{ startSample: 3000, endSample: 3500 }], range });
    assert.deepEqual(none.entries, {}, "no region inside the range means nothing to snap to, so no entries");
    assert.deepEqual([none.report.regionCount, none.report.before, none.report.after], [0, none.report.before, none.report.before]);
    const empty = alignRange({ ...base, words, regions, range: { startSample: 3000, endSample: 4000 } });
    assert.deepEqual(empty.entries, {});
    assert.deepEqual(empty.report.before, { wordCount: 0, boundaryCount: 0, onsetErrorMs: null, insideSpeechCount: 0, insideSpeechFraction: null });
    assert.throws(() => alignRange({ ...base, words, regions, range: { startSample: 10, endSample: 10 } }), RangeError);
});
test("align: heavy compression keeps every word at least one sample wide and inside its region", () => {
    const words = Array.from({ length: 5 }, (_, i) => word(`w${i}`, 1000 + i * 100, 1100 + i * 100));
    const regions = [{ startSample: 1200, endSample: 1203 }];
    const { entries } = alignRange({ ...base, words, regions, range: { startSample: 0, endSample: 2000 } });
    const spans = words.map(w => entries[w.id]);
    assert.ok(spans.every(e => e.startSample >= 1200 && e.endSample <= 1203 && e.startSample < e.endSample), JSON.stringify(spans));
    assert.deepEqual(spans[0].startSample, 1200);
    assert.deepEqual(spans[4].endSample, 1203);
    for (let i = 1; i < spans.length; i++)
        assert.ok(spans[i].startSample >= spans[i - 1].startSample, "order is preserved");
});
test("measureRange: boundaries are the first word and words after a pause, error is signed ms to the nearest onset, percentiles interpolate, inside means fully inside", () => {
    const regions = [{ startSample: 1000, endSample: 2000 }, { startSample: 3000, endSample: 4000 }];
    const words = [
        { startSample: 900, endSample: 1500 }, // boundary: -100 ms to onset 1000; not inside (starts before the region)
        { startSample: 1500, endSample: 1900 }, // butt-joined: no boundary; inside
        { startSample: 2250, endSample: 2400 }, // 350 ms pause: boundary; nearest onset 3000 → -750; not inside
        { startSample: 2600, endSample: 2800 }, // 200 ms pause: not a boundary; not inside
        { startSample: 3100, endSample: 3200 }, // 300 ms pause: boundary (>= counts); +100 to onset 3000; inside
    ];
    const measure = measureRange({ words, regions, sampleRateHz: RATE, boundaryPauseSamples: 300 });
    assert.deepEqual(measure, { wordCount: 5, boundaryCount: 3, onsetErrorMs: { median: -100, p10: -620, p90: 60 }, insideSpeechCount: 2, insideSpeechFraction: 0.4 });
    assert.deepEqual(measureRange({ words, regions: [], sampleRateHz: RATE, boundaryPauseSamples: 300 }), { wordCount: 5, boundaryCount: 3, onsetErrorMs: null, insideSpeechCount: 0, insideSpeechFraction: 0 });
    assert.deepEqual(measureRange({ words: [], regions, sampleRateHz: RATE, boundaryPauseSamples: 300 }), { wordCount: 0, boundaryCount: 0, onsetErrorMs: null, insideSpeechCount: 0, insideSpeechFraction: null });
    assert.deepEqual(measureRange({ words: [words[0]], regions, sampleRateHz: 44_100, boundaryPauseSamples: 300 }).onsetErrorMs, { median: -2.3, p10: -2.3, p90: -2.3 }, "ms are rounded to one decimal");
});
test("a word in silence follows its sentence: a sentence start joins the next region, a sentence end joins the previous one, mid-sentence stays nearest", () => {
    // Two regions with a 1400-sample gap. Shifted (lead 0) word "the" sits at 583 from the first region's end and 600 from the second's start.
    const regions = [{ startSample: 0, endSample: 1000 }, { startSample: 2400, endSample: 3400 }];
    const prev = word("prev", 800, 950), next = word("next", 2500, 2700);
    const the = word("the", 1583, 1800);
    const nearestOnly = alignRange({ ...base, leadMs: 0, words: [prev, the, next], regions, range: { startSample: 0, endSample: 4000 } }).entries;
    assert.ok(nearestOnly["the"].endSample <= 1000, "without sentence information the nearer first region wins");
    const asStart = alignRange({ ...base, leadMs: 0, words: [prev, the, next], regions, range: { startSample: 0, endSample: 4000 }, sentenceStartIds: new Set(["prev", "the"]) }).entries;
    assert.ok(asStart["the"].startSample >= 2400 && asStart["next"].startSample > asStart["the"].startSample, "a sentence start joins the following region and keeps its order");
    assert.deepEqual(asStart["prev"], { startSample: 0, endSample: 1000 }, "the previous region now holds one word and it fills it");
    const asEnd = alignRange({ ...base, leadMs: 0, words: [prev, the, next], regions, range: { startSample: 0, endSample: 4000 }, sentenceStartIds: new Set(["prev", "next"]) }).entries;
    assert.ok(asEnd["the"].endSample <= 1000, "a sentence-final word joins the preceding region");
    const mid = alignRange({ ...base, leadMs: 0, words: [prev, the, next], regions, range: { startSample: 0, endSample: 4000 }, sentenceStartIds: new Set(["prev"]) }).entries;
    assert.ok(mid["the"].endSample <= 1000, "with overlapping neighbours on both sides the nearest region still decides");
    const chain = alignRange({ ...base, leadMs: 0, words: [prev, word("a", 1500, 1600), the, next], regions, range: { startSample: 0, endSample: 4000 }, sentenceStartIds: new Set(["prev", "a"]) }).entries;
    assert.ok(chain["a"].startSample >= 2400 && chain["the"].startSample > chain["a"].startSample, "a run of silence-only words walks outward to the sentence's overlapping neighbour");
});
//# sourceMappingURL=align.test.js.map