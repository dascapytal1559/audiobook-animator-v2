import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
const encode = (v: unknown) => Buffer.from(JSON.stringify(v, null, 2) + "\n");
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const h = "a".repeat(64);
/** A complete synthetic verified story (10 Hz, 100 samples) that passes loadStoryContext. Test-only; not matched by the test glob. */
export async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "planning-input-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
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
  const transcript = { schemaVersion: 1, kind: "paired-story-segment-transcript",
    segment: { id: "pilot", title: "Pilot", kind: "story", elementStartIndex: 2, elementEndIndexExclusive: 4, startSample: 100, endSample: 200 },
    provenance: { planSha256: h, transcriptSha256: h, sourceSha256: h, providerJobId: "job", providerRawSha256: h, evidence: [] },
    timing: { clock: "ffmpeg-decoded-audio-samples", providerToDecodedOffsetSeconds: 0.25, basis: "fixture", wordTiming: "approximate-provider-times-mapped-to-segment", caveat: "approximate", wordTimingToleranceSeconds: 0.1 },
    audio: { path: "audio.flac", manifestPath: "manifest.json", manifestSha256: hash(encode(manifest)), sha256: hash(audioBytes), sampleCount: 100, sampleRateHz: 10, channels: 1, durationSeconds: 10 },
    elements: [{ kind: "word", id: "m2:e0", speaker: 0, value: "Uncorrected", confidence: null, providerStartSeconds: 11, providerEndSeconds: 12, bookElementIndex: 2, approximateSegmentStartSeconds: 1.25, approximateSegmentEndSeconds: 2.25 },
      { kind: "punctuation", id: "m2:e1", speaker: 0, value: ". ", bookElementIndex: 3 }], text: "Uncorrected. ", wordCount: 1 };
  const story = { id: "pilot", title: "Pilot", kind: "story", wordCount: 1, sampleCount: 100, sampleRateHz: 10, durationSeconds: 10, durationDisplay: "00:00:10.000",
    audioPath: "audio.flac", audioSha256: hash(audioBytes), audioManifestPath: "manifest.json", audioManifestSha256: hash(encode(manifest)),
    transcriptPath: "transcript.json", transcriptSha256: hash(encode(transcript)), textPath: "transcript.txt", textSha256: hash(Buffer.from(transcript.text + "\n")) };
  const inventory = { schemaVersion: 1, kind: "verified-story-inventory", status: "complete", bookTitle: "Book", planSha256: h, transcriptSha256: h, sourceSha256: h, providerJobId: "job",
    checks: { everyElementAssignedExactlyOnce: true, everySegmentAudioVerified: true, durationBasis: "verified-sample-count-divided-by-sample-rate", wordTiming: "approximate" }, storyCount: 1, extraCount: 0, stories: [story], extras: [] };
  const config = { schemaVersion: 1, bookId: "book", bookTitle: "Book", storyId: "pilot", inventoryPath: "inventory.json", inventorySha256: hash(encode(inventory)),
    limits: { maxInventoryBytes: 65536, maxTranscriptBytes: 65536, maxAudioManifestBytes: 65536, maxElements: 10 } };
  const configPath = join(dir, "config.json");
  async function save() {
    story.transcriptSha256 = hash(encode(transcript)); config.inventorySha256 = hash(encode(inventory));
    for (const [name, value] of [["config.json", config], ["inventory.json", inventory], ["transcript.json", transcript], ["manifest.json", manifest]] as const) await writeFile(join(dir, name), encode(value));
  }
  await save(); await writeFile(join(dir, "audio.flac"), audioBytes); await writeFile(join(dir, "transcript.txt"), transcript.text + "\n");
  return { dir, config, configPath, inventory, transcript, save };
}
