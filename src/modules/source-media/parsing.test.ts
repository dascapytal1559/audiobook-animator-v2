import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { SourceMediaError } from "./contracts.js";
import { parseEmbeddedCue } from "./cue.js";
import { parseFfprobeOutput } from "./probe.js";

const audio = { index: 0, codec_type: "audio", codec_name: "mp3", channels: 1, sample_rate: "44100", duration: "60.000000", start_time: "0.025056" };
const options = { cueChapterToleranceSeconds: 0.02 };
const cue = 'FILE "a different filename.mp3" MP3\nTRACK 01 AUDIO\n TITLE "First title"\n INDEX 01 0:00:00\nTRACK 02 AUDIO\n TITLE "Second’s title"\n INDEX 01 0:18:68\n';
const decode = (value: unknown, audioStreamIndex?: number) => Effect.runPromise(parseFfprobeOutput(JSON.stringify(value), { ...options, ...(audioStreamIndex === undefined ? {} : { audioStreamIndex }) }));
const hasCode = (code: string) => (error: unknown) => error instanceof SourceMediaError && error.code === code;

test("CUE times are minutes:seconds:75fps frames, preserving Unicode titles and exact frame counts", () => {
  const parsed = parseEmbeddedCue(cue.replace("0:18:68", "107:39:34"));
  assert.equal(parsed.status, "valid");
  assert.equal(parsed.tracks[1]?.title, "Second’s title");
  assert.deepEqual(parsed.tracks[1]?.index01, { raw: "107:39:34", totalFrames: "484459", framesPerSecond: 75, seconds: 6459 + 34 / 75 });
  assert.equal(parsed.raw, cue.replace("0:18:68", "107:39:34"));
});

test("missing CUE titles remain absent and do not borrow album or file titles", () => {
  const parsed = parseEmbeddedCue('TITLE "Collection"\nFILE "book.mp3" MP3\nTRACK 1 AUDIO\nINDEX 01 0:00:00');
  assert.equal(parsed.status, "valid");
  assert.equal(parsed.title, "Collection");
  assert.equal(parsed.tracks[0]?.title, null);
});

test("CUE unsupported features remain visible instead of looking valid", () => {
  const parsed = parseEmbeddedCue(cue + 'PREGAP 00:02:00\nFILE "second.wav" WAVE\nTRACK 03 AUDIO\nINDEX 00 00:00:00\nINDEX 01 00:02:00');
  assert.equal(parsed.status, "unsupported");
  assert.deepEqual(new Set(parsed.issues.map((issue) => issue.code)), new Set(["CueUnsupportedDirective", "CueMultipleFiles", "CueIndexType"]));
});

test("CUE rejects invalid frame/second values, duplicate indexes, and non-increasing starts", () => {
  for (const time of ["0:18:75", "0:60:00", "0:18.68", "-1:00:00"]) {
    assert.equal(parseEmbeddedCue(cue.replace("0:18:68", time)).status, "invalid", time);
  }
  assert.equal(parseEmbeddedCue(cue.replace("0:18:68", "0:00:00")).issues.some((issue) => issue.code === "CueTimeOrder"), true);
  assert.equal(parseEmbeddedCue(cue + "INDEX 01 00:20:00").issues.some((issue) => issue.code === "CueDuplicateIndex"), true);
  assert.equal(parseEmbeddedCue("").status, "invalid");
});

test("audio selection excludes JPEG cover art and keeps generic chapter titles separate from CUE", async () => {
  const chapters = [
    { id: 0, start: 0, end: 18914, time_base: "1/1000", tags: { title: "Collection" } },
    { id: 1, start: 18914, end: 60000, time_base: "1/1000", tags: { title: "Collection" } },
  ];
  const result = await decode({ streams: [audio, { index: 1, codec_type: "video", codec_name: "mjpeg" }], chapters, format: { duration: "60.000000", tags: { CUESHEET: cue } } });
  assert.equal(result.audio.index, 0);
  assert.equal(result.audio.sampleRateHz, 44100);
  assert.equal(result.audio.channels, 1);
  assert.deepEqual(result.audioStreamIndices, [0]);
  assert.deepEqual(result.chapters[1]?.raw, chapters[1]);
  assert.equal(result.chapters[1]?.timing?.startTicks, "18914");
  assert.equal(result.chapters[1]?.timing?.timeBase, "1/1000");
  assert.equal(result.cueSheets[0]?.evidence.tracks[1]?.title, "Second’s title");
  assert.equal(result.chapterCueComparison.basis, "ordinal-diagnostic-only");
  assert.ok(Math.abs(result.chapterCueComparison.entries[1]!.cueMinusChapterSeconds + 0.007333333333) < 1e-10);
  assert.equal(result.issues.length, 0);
});

test("a local source needs no chapters or CUE metadata", async () => {
  const result = await decode({ streams: [audio] });
  assert.deepEqual(result.chapters, []);
  assert.deepEqual(result.cueSheets, []);
  assert.deepEqual(result.duration, { seconds: 60, source: "audio-stream" });
});

test("structural probe failures, no audio, and duplicate stream indices are typed errors", async () => {
  await assert.rejects(Effect.runPromise(parseFfprobeOutput("{", options)), hasCode("MalformedProbe"));
  await assert.rejects(decode({ format: {} }), hasCode("MalformedProbe"));
  await assert.rejects(decode({ streams: ["audio"] }), hasCode("MalformedProbe"));
  await assert.rejects(decode({ streams: [audio, audio] }), hasCode("MalformedProbe"));
  await assert.rejects(decode({ streams: [{ index: 0, codec_type: "video" }] }), hasCode("NoAudioStream"));
});

test("multiple audio streams require a valid explicit audio stream index", async () => {
  const document = { streams: [audio, { ...audio, index: 2, sample_rate: "22050" }, { index: 1, codec_type: "video" }] };
  await assert.rejects(decode(document), hasCode("AmbiguousAudioStreams"));
  await assert.rejects(decode(document, 1), hasCode("AudioStreamNotFound"));
  assert.equal((await decode(document, 2)).audio.sampleRateHz, 22050);
});

test("unsafe numeric chapter ticks are flagged; exact integer strings remain intact", async () => {
  const huge = "9007199254740993";
  const result = await decode({ streams: [audio], chapters: [
    { start: Number(huge), end: 9007199254741000, time_base: "1/1000" },
    { start: huge, end: "9007199254740994", time_base: "1/1000000000000000" },
    { start: 0, end: 1, time_base: "1/0" },
  ] });
  assert.equal(result.chapters[0]?.timing, null);
  assert.equal(result.chapters[1]?.timing?.startTicks, huge);
  assert.equal(result.chapters[2]?.timing, null);
  assert.equal(result.issues.filter((issue) => issue.code === "MalformedChapterTiming").length, 2);
});

test("chapter adjacency uses exact tick arithmetic even where seconds lose precision", async () => {
  const result = await decode({ streams: [audio], chapters: [
    { start: "9007199254740990", end: "9007199254740992", time_base: "1/1000000000000000" },
    { start: "9007199254740993", end: "9007199254740994", time_base: "1/1000000000000000" },
  ] });
  assert.equal(result.chapters[0]?.timing?.endSeconds, result.chapters[1]?.timing?.startSeconds);
  assert.ok(result.issues.some((issue) => issue.code === "ChapterGap"));
});

test("malformed and conflicting optional metadata produces diagnostic issues", async () => {
  const result = await decode({ streams: [{ ...audio, sample_rate: "Infinity", channels: "one" }], chapters: [
    { start: 0, end: 20000, time_base: "1/1000" },
    { start: 19000, end: 70000, time_base: "1/1000" },
  ], format: { tags: { CUESHEET: cue } } });
  const codes = new Set(result.issues.map((issue) => issue.code));
  for (const code of ["InvalidNumericMetadata", "InvalidChannelCount", "ChapterOverlap", "ChapterBeyondDuration", "ChapterCueTimingMismatch"]) assert.ok(codes.has(code), code);
  const mismatch = await decode({ streams: [audio], chapters: [{ start: 0, end: 1, time_base: "1/1" }], format: { tags: { CUESHEET: cue } } });
  assert.ok(mismatch.issues.some((issue) => issue.code === "ChapterCueCountMismatch"));
  assert.deepEqual(mismatch.chapterCueComparison.entries, []);
  const duplicate = await decode({ streams: [audio], format: { tags: { CUESHEET: cue, cuesheet: cue } } });
  assert.equal(duplicate.cueSheets.length, 2);
  assert.ok(duplicate.issues.some((issue) => issue.code === "ConflictingCueTags"));
  const malformed = await decode({ streams: [audio], format: { tags: { CUESHEET: {} } } });
  assert.ok(malformed.issues.some((issue) => issue.code === "MalformedCueTag"));
});
