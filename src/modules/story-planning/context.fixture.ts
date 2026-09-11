import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
const encode = (v: unknown) => Buffer.from(JSON.stringify(v, null, 2) + "\n");
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const h = "a".repeat(64);
/** Extra words appended after the fixture's first word, each followed by the given punctuation. Times are story-relative seconds on the 10 Hz clip. */
export type FixtureWord = { readonly value: string; readonly startSeconds: number; readonly endSeconds: number; readonly punctuation: string };
/**
 * A complete synthetic verified story (10 Hz, 100 samples) that passes loadStoryContext. The story directory is `<root>/pilot`, holding
 * `story.json` and its linked files; the planning config lives in `<root>` beside it. Test-only; not matched by the test glob.
 */
export async function fixture(t: TestContext, options: { readonly words?: ReadonlyArray<FixtureWord> } = {}) {
  const root = await mkdtemp(join(tmpdir(), "planning-input-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, "pilot");
  await mkdir(dir);
  const audioBytes = Buffer.from("opaque audio");
  const manifest = { schemaVersion: 1, kind: "verified-story-audio", identity: {
    request: { sourcePath: "source.mp3", expectedSource: { sha256: h, byteLength: 10 }, audioStreamIndex: 0,
      interval: { clock: "ffmpeg-decoded-audio-samples", startSample: 100, endSample: 200 }, artifactDirectory: dir, ffmpegPath: "ffmpeg",
      inspection: { ffprobePath: "ffprobe", probeTimeoutMs: 1000, maxProbeOutputBytes: 1000, maxProbeErrorBytes: 1000, hashChunkBytes: 65536, cueChapterToleranceSeconds: 0.02 },
      extractionTimeoutMs: 1000, verificationTimeoutMs: 1000, maxProcessOutputBytes: 1000, maxProcessErrorBytes: 1000, maxOutputBytes: 1000, maxManifestBytes: 65536 },
    source: { realPath: "source.mp3", sha256: h, byteLength: 10, audioStreamIndex: 0, sampleRateHz: 10, channels: 1 },
    encoding: { codec: "flac", sampleFormat: "s32", bitsPerSample: 24, compressionLevel: 5 }, ffmpegVersion: "fixture" },
    identitySha256: h, precision: "fixture", extraction: { executable: "ffmpeg", arguments: [] }, verification: { executable: "ffmpeg", arguments: [], decodedFormat: "s24le" },
    output: { filename: "audio.flac", sha256: hash(audioBytes), byteLength: audioBytes.length, codec: "flac", bitsPerSample: 24, sampleRateHz: 10, channels: 1, sampleCount: 100, decodedPcmSha256: h }, manifestSha256: h };
  const extra = (options.words ?? []).flatMap((w, i) => [
    { kind: "word", id: `m2:e${2 + 2 * i}`, speaker: 0, value: w.value, confidence: null, providerStartSeconds: w.startSeconds + 9.75, providerEndSeconds: w.endSeconds + 9.75, bookElementIndex: 4 + 2 * i, approximateSegmentStartSeconds: w.startSeconds, approximateSegmentEndSeconds: w.endSeconds },
    { kind: "punctuation", id: `m2:e${3 + 2 * i}`, speaker: 0, value: w.punctuation, bookElementIndex: 5 + 2 * i }]);
  const text = `Uncorrected. ${extra.map(e => e.value).join("")}`;
  const transcript = { schemaVersion: 1, kind: "paired-story-segment-transcript",
    segment: { id: "pilot", title: "Pilot", kind: "story", elementStartIndex: 2, elementEndIndexExclusive: 4 + extra.length, startSample: 100, endSample: 200 },
    provenance: { planSha256: h, transcriptSha256: h, sourceSha256: h, providerJobId: "job", providerRawSha256: h, evidence: [] },
    timing: { clock: "ffmpeg-decoded-audio-samples", providerToDecodedOffsetSeconds: 0.25, basis: "fixture", wordTiming: "approximate-provider-times-mapped-to-segment", caveat: "approximate", wordTimingToleranceSeconds: 0.1 },
    audio: { path: "audio.flac", manifestPath: "manifest.json", manifestSha256: hash(encode(manifest)), sha256: hash(audioBytes), sampleCount: 100, sampleRateHz: 10, channels: 1, durationSeconds: 10 },
    elements: [{ kind: "word", id: "m2:e0", speaker: 0, value: "Uncorrected", confidence: null, providerStartSeconds: 11, providerEndSeconds: 12, bookElementIndex: 2, approximateSegmentStartSeconds: 1.25, approximateSegmentEndSeconds: 2.25 },
      { kind: "punctuation", id: "m2:e1", speaker: 0, value: ". ", bookElementIndex: 3 }, ...extra], text, wordCount: 1 + (options.words?.length ?? 0) };
  const story = { schemaVersion: 1, kind: "story-manifest", id: "pilot", title: "Pilot", book: { id: "book", title: "Book" }, spoilerPolicy: "premise-only", synopsis: "A synthetic pilot story.",
    wordCount: transcript.wordCount, sampleCount: 100, sampleRateHz: 10, durationSeconds: 10, durationDisplay: "00:00:10.000",
    audioPath: "audio.flac", audioSha256: hash(audioBytes), audioManifestPath: "manifest.json", audioManifestSha256: hash(encode(manifest)),
    transcriptProvider: "rev-ai", transcriptPath: "transcript.json", transcriptSha256: hash(encode(transcript)), textPath: "transcript.txt", textSha256: hash(Buffer.from(transcript.text + "\n")),
    origin: { splitInventoryPath: "../inventory.json", splitInventorySha256: h, segmentPath: "../segments/pilot", planSha256: h, transcriptSha256: h, sourceSha256: h, providerJobId: "job" } };
  const config = { schemaVersion: 1, storyDirectory: "pilot",
    limits: { maxManifestBytes: 65536, maxTranscriptBytes: 65536, maxAudioManifestBytes: 65536, maxElements: Math.max(10, transcript.elements.length) } };
  const configPath = join(root, "config.json");
  async function save() {
    story.transcriptSha256 = hash(encode(transcript));
    await writeFile(configPath, encode(config));
    for (const [name, value] of [["story.json", story], ["transcript.json", transcript], ["manifest.json", manifest]] as const) await writeFile(join(dir, name), encode(value));
  }
  await save(); await writeFile(join(dir, "audio.flac"), audioBytes); await writeFile(join(dir, "transcript.txt"), transcript.text + "\n");
  return { root, dir, config, configPath, story, transcript, save };
}
