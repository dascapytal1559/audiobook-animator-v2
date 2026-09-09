import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import { NodeServices } from "@effect/platform-node";
import { Effect, Option } from "effect";
import { computePeaks, EditorServerError, PeakAccumulator, type PeaksIdentity, readPeaksCache, writePeaksCache } from "./index.js";
const provide = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>) => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
const s16le = (samples: ReadonlyArray<number>) => { const b = Buffer.alloc(samples.length * 2); samples.forEach((s, i) => b.writeInt16LE(s, i * 2)); return b; };
const reference = (samples: ReadonlyArray<number>, per: number) => {
  const min: number[] = [], max: number[] = [];
  for (let i = 0; i < samples.length; i += per) { const bucket = samples.slice(i, i + per); min.push(Math.min(...bucket)); max.push(Math.max(...bucket)); }
  return { min, max };
};
async function temp(t: TestContext) { const dir = await mkdtemp(join(tmpdir(), "peaks-")); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
const ffmpegAvailable = () => promisify(execFile)("ffmpeg", ["-version"]).then(() => true, () => false);

test("bucket reduction matches a reference over odd chunk boundaries, keeps the partial last bucket, and covers int16 extremes", () => {
  const samples = Array.from({ length: 37 }, (_, i) => (i % 2 === 0 ? 1 : -1) * ((i * 977) % 32768));
  samples[3] = -32768; samples[20] = 32767; samples[36] = 0;
  const bytes = s16le(samples);
  const accumulator = new PeakAccumulator(16);
  for (const [start, end] of [[0, 1], [1, 7], [7, 30], [30, 30], [30, bytes.length]] as const) accumulator.push(bytes.subarray(start, end));
  const result = accumulator.finish();
  assert.equal(result.sampleCount, 37);
  assert.deepEqual({ min: result.min, max: result.max }, reference(samples, 16));
  assert.equal(result.min.length, 3, "16 + 16 + 5 samples");
  assert.equal(result.min[0], -32768);
  assert.equal(result.max[1], 32767);
  const exact = new PeakAccumulator(4); exact.push(s16le([1, 2, 3, 4, 5, 6, 7, 8]));
  assert.deepEqual(exact.finish(), { min: [1, 5], max: [4, 8], sampleCount: 8 });
  const empty = new PeakAccumulator(4);
  assert.deepEqual(empty.finish(), { min: [], max: [], sampleCount: 0 });
  const dangling = new PeakAccumulator(4); dangling.push(Buffer.from([0, 0, 1]));
  assert.throws(() => dangling.finish(), /halfway through a sample/);
  assert.throws(() => new PeakAccumulator(0), RangeError);
});

test("the cache is used only when every pin matches; a differing audio hash or bucket count means recompute", async t => {
  const dir = await temp(t);
  const path = join(dir, "peaks.json");
  const identity: PeaksIdentity = { audioSha256: "a".repeat(64), sampleRateHz: 10, sampleCount: 37, samplesPerBucket: 16 };
  const peaks = { schemaVersion: 1 as const, ...identity, min: [-3, -2, -1], max: [3, 2, 1] };
  assert.ok(Option.isNone(await provide(readPeaksCache(path, 65_536, identity))), "missing file");
  await provide(writePeaksCache(path, peaks));
  assert.deepEqual(await readdir(dir), ["peaks.json"], "no temp file is left behind");
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), peaks);
  assert.deepEqual(Option.getOrNull(await provide(readPeaksCache(path, 65_536, identity))), peaks);
  assert.ok(Option.isNone(await provide(readPeaksCache(path, 65_536, { ...identity, audioSha256: "b".repeat(64) }))), "audio hash pin");
  assert.ok(Option.isNone(await provide(readPeaksCache(path, 65_536, { ...identity, samplesPerBucket: 8 }))), "bucket size pin");
  assert.ok(Option.isNone(await provide(readPeaksCache(path, 65_536, { ...identity, sampleCount: 38 }))), "sample count pin");
  assert.ok(Option.isNone(await provide(readPeaksCache(path, 16, identity))), "over the byte limit");
  await writeFile(path, JSON.stringify({ ...peaks, min: [-3, -2] }));
  assert.ok(Option.isNone(await provide(readPeaksCache(path, 65_536, identity))), "bucket count mismatch");
  await writeFile(path, "{not json");
  assert.ok(Option.isNone(await provide(readPeaksCache(path, 65_536, identity))), "garbage");
  await writeFile(path, JSON.stringify({ ...peaks, min: [-3, -2, 40000] }));
  assert.ok(Option.isNone(await provide(readPeaksCache(path, 65_536, identity))), "out of int16 range");
});

test("computePeaks decodes a real FLAC through ffmpeg and refuses a sample count that differs from the verified clip", async t => {
  if (!(await ffmpegAvailable())) return t.skip("ffmpeg is not installed; the decode integration test is skipped, the unit tests above still ran");
  const dir = await temp(t);
  const audioPath = join(dir, "tone.flac");
  await promisify(execFile)("ffmpeg", ["-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-ar", "8000", "-ac", "1", audioPath]);
  const identity: PeaksIdentity = { audioSha256: "c".repeat(64), sampleRateHz: 8000, sampleCount: 8000, samplesPerBucket: 1000 };
  const peaks = await provide(computePeaks({ ffmpegPath: "ffmpeg", audioPath, identity }));
  assert.equal(peaks.min.length, 8);
  assert.equal(peaks.max.length, 8);
  assert.ok(peaks.max.every(v => v > 1000) && peaks.min.every(v => v < -1000), "a full-scale sine swings both ways in every bucket");
  assert.deepEqual([peaks.audioSha256, peaks.sampleCount, peaks.samplesPerBucket], [identity.audioSha256, 8000, 1000]);
  const wrongCount = await provide(computePeaks({ ffmpegPath: "ffmpeg", audioPath, identity: { ...identity, sampleCount: 8001 } }).pipe(Effect.flip));
  assert.ok(wrongCount instanceof EditorServerError && wrongCount.code === "PeaksFailed" && /decoded 8000 samples but the verified clip has 8001/.test(wrongCount.message));
  await writeFile(audioPath, "not audio");
  const garbage = await provide(computePeaks({ ffmpegPath: "ffmpeg", audioPath, identity }).pipe(Effect.flip));
  assert.ok(garbage instanceof EditorServerError && garbage.code === "PeaksFailed" && /exited with code/.test(garbage.message), garbage.message);
  const missing = await provide(computePeaks({ ffmpegPath: join(dir, "no-such-ffmpeg"), audioPath, identity }).pipe(Effect.flip));
  assert.ok(missing instanceof EditorServerError && missing.code === "PeaksFailed", missing.message);
});
