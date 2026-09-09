import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { extractStoryAudio, type StoryAudioRequest } from "./index.js";

const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const hasCode = (code: string) => (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error && error.code === code;
const run = (request: StoryAudioRequest) => Effect.runPromise(extractStoryAudio(request).pipe(Effect.provide(NodeServices.layer)));
const posixOnly = { skip: process.platform === "win32" ? "FFmpeg wrapper fixtures use POSIX shebangs." : false };

function ffmpeg(args: ReadonlyArray<string>): Buffer {
  const result = spawnSync("ffmpeg", args, { maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}

async function fixture(t: TestContext, extractionHook = "") {
  const directory = await mkdtemp(join(tmpdir(), "animator-story-audio-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, "source $(touch must-not-exist); 'quoted'.wav");
  const rawPath = join(directory, "source.s24le");
  const pcm = Buffer.alloc(3200 * 2 * 3);
  for (let sample = 0; sample < 3200; sample++) {
    // Distinct signed values in each channel expose offset, channel mixing and sample-count errors.
    pcm.writeIntLE(((sample * 7919) % 0x1000000) - 0x800000, sample * 6, 3);
    pcm.writeIntLE(0x7fffff - ((sample * 3571) % 0x1000000), sample * 6 + 3, 3);
  }
  await writeFile(rawPath, pcm);
  ffmpeg(["-v", "error", "-n", "-f", "s24le", "-ar", "8000", "-ac", "2", "-i", rawPath, "-c:a", "pcm_s24le", sourcePath]);
  const bytes = await readFile(sourcePath);
  const logPath = join(directory, "extractions.log");
  const pidPath = join(directory, "child.pid");
  const ffmpegPath = join(directory, "ffmpeg-wrapper");
  await writeFile(ffmpegPath, `#!/usr/bin/env node\nconst fs = require("node:fs"); const cp = require("node:child_process"); const args = process.argv.slice(2);\nif (args.includes("-af")) { fs.appendFileSync(${JSON.stringify(logPath)}, "extract\\n"); fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); ${extractionHook} }\nconst child = cp.spawnSync("ffmpeg", args, { stdio: "inherit" }); process.exitCode = child.status ?? 1;\n`);
  await chmod(ffmpegPath, 0o700);
  const request: StoryAudioRequest = {
    sourcePath, expectedSource: { sha256: hash(bytes), byteLength: bytes.length }, audioStreamIndex: 0,
    interval: { clock: "ffmpeg-decoded-audio-samples", startSample: 23, endSample: 2187 },
    artifactDirectory: join(directory, "cut"), ffmpegPath,
    inspection: { ffprobePath: "ffprobe", probeTimeoutMs: 5_000, maxProbeOutputBytes: 1024 * 1024, maxProbeErrorBytes: 8192, hashChunkBytes: 1024, cueChapterToleranceSeconds: 0.02 },
    extractionTimeoutMs: 5_000, verificationTimeoutMs: 5_000,
    maxProcessOutputBytes: 16 * 1024, maxProcessErrorBytes: 16 * 1024,
    maxOutputBytes: 1024 * 1024, maxManifestBytes: 64 * 1024,
  };
  return { directory, request, sourcePath, sourceBytes: bytes, pcm, logPath, pidPath, ffmpegPath };
}

test("extraction selects exact decoded samples and preserves stereo FLAC24 at the source rate", posixOnly, async (t) => {
  const f = await fixture(t);
  const result = await run(f.request);
  assert.equal(result.reused, false);
  assert.equal(result.manifest.output.sampleCount, 2187 - 23);
  assert.equal(result.manifest.output.sampleRateHz, 8000);
  assert.equal(result.manifest.output.channels, 2);
  assert.equal(result.manifest.output.bitsPerSample, 24);
  const actual = ffmpeg(["-v", "error", "-i", result.audioPath, "-c:a", "pcm_s24le", "-f", "s24le", "pipe:1"]);
  const expected = f.pcm.subarray(23 * 6, 2187 * 6);
  assert.deepEqual(actual, expected);
  assert.equal(result.manifest.output.decodedPcmSha256, hash(expected));
  assert.equal(result.manifest.output.sha256, hash(await readFile(result.audioPath)));
  assert.deepEqual(await readFile(f.sourcePath), f.sourceBytes);
  assert.ok(!result.manifest.extraction.arguments.includes("-ss"));
  assert.ok(result.manifest.extraction.arguments.includes("atrim=start_sample=23:end_sample=2187,asetpts=PTS-STARTPTS"));
  assert.deepEqual((await readdir(f.request.artifactDirectory)).sort(), ["audio.flac", "manifest.json"]);
});

test("verified reruns decode and check the cache without another extraction; changed intervals are rejected", posixOnly, async (t) => {
  const f = await fixture(t);
  const first = await run(f.request);
  const saved = await readFile(first.manifestPath);
  const second = await run(f.request);
  assert.equal(second.reused, true);
  assert.deepEqual(second.manifest, first.manifest);
  assert.deepEqual(await readFile(first.manifestPath), saved);
  await assert.rejects(run({ ...f.request, interval: { ...f.request.interval, endSample: 2188 } }), hasCode("ArtifactMismatch"));
  assert.equal(await readFile(f.logPath, "utf8"), "extract\n");
});

test("a moved identical source reuses verified audio and historical manifests without another extraction", posixOnly, async (t) => {
  const f = await fixture(t);
  const first = await run(f.request);
  const manifestBytes = await readFile(first.manifestPath);
  const audioBytes = await readFile(first.audioPath);
  const movedPath = join(f.directory, "moved source.wav");
  await copyFile(f.sourcePath, movedPath);
  await rm(f.sourcePath);
  const movedRequest = { ...f.request, sourcePath: movedPath };
  const second = await run(movedRequest);
  assert.equal(second.reused, true);
  assert.deepEqual(second.manifest, first.manifest);
  assert.equal(second.manifest.identity.request.sourcePath, f.sourcePath);
  await assert.rejects(run({ ...movedRequest, maxOutputBytes: f.request.maxOutputBytes - 1 }), hasCode("ArtifactMismatch"));
  const changed = Buffer.from(f.sourceBytes);
  changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
  await writeFile(movedPath, changed);
  await assert.rejects(run(movedRequest), hasCode("SourceMismatch"));
  await assert.rejects(run({ ...movedRequest, expectedSource: { ...f.request.expectedSource, sha256: hash(changed) } }), hasCode("ArtifactMismatch"));
  assert.deepEqual(await readFile(first.manifestPath), manifestBytes);
  assert.deepEqual(await readFile(first.audioPath), audioBytes);
  assert.equal(await readFile(f.logPath, "utf8"), "extract\n");
});

test("relocation reuse still verifies the historical identity checksum independently of the manifest checksum", posixOnly, async (t) => {
  const f = await fixture(t);
  const first = await run(f.request);
  const { manifestSha256: _manifestSha256, ...record } = first.manifest;
  const changed = { ...record, identity: { ...record.identity, request: { ...record.identity.request, sourcePath: join(f.directory, "rewritten historical location.wav") } } };
  const encode = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const changedBytes = encode({ ...changed, manifestSha256: hash(encode(changed)) });
  await writeFile(first.manifestPath, changedBytes);
  await assert.rejects(run(f.request), hasCode("ArtifactMismatch"));
  assert.deepEqual(await readFile(first.manifestPath), changedBytes);
  assert.equal(await readFile(f.logPath, "utf8"), "extract\n");
});

test("MP3 intervals use samples from the decoded gapless stream, rather than container start timestamps", posixOnly, async (t) => {
  const f = await fixture(t);
  const mp3Path = join(f.directory, "encoded.mp3");
  ffmpeg(["-v", "error", "-n", "-i", f.sourcePath, "-c:a", "libmp3lame", "-b:a", "64k", mp3Path]);
  const bytes = await readFile(mp3Path);
  const decoded = ffmpeg(["-v", "error", "-i", mp3Path, "-c:a", "pcm_s24le", "-f", "s24le", "pipe:1"]);
  assert.equal(decoded.byteLength, f.pcm.byteLength);
  const result = await run({ ...f.request, sourcePath: mp3Path, expectedSource: { sha256: hash(bytes), byteLength: bytes.length } });
  const actual = ffmpeg(["-v", "error", "-i", result.audioPath, "-c:a", "pcm_s24le", "-f", "s24le", "pipe:1"]);
  assert.deepEqual(actual, decoded.subarray(23 * 6, 2187 * 6));
  assert.deepEqual(await readFile(mp3Path), bytes);
});

test("an MP3 trim with a seven-sample first frame encodes without changing or padding the interval", posixOnly, async (t) => {
  const f = await fixture(t);
  const sourcePath = join(f.directory, "short-first-frame.mp3");
  ffmpeg(["-v", "error", "-n", "-i", f.sourcePath, "-c:a", "libmp3lame", "-b:a", "64k", sourcePath]);
  const bytes = await readFile(sourcePath);
  const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_frames", "-show_entries", "frame=nb_samples", "-of", "json", sourcePath], { maxBuffer: 1024 * 1024 });
  assert.equal(probe.status, 0, probe.stderr.toString());
  const frames = JSON.parse(probe.stdout.toString()) as { frames: Array<{ nb_samples: number }> };
  const firstFrameSamples = frames.frames[0]!.nb_samples;
  assert.ok(firstFrameSamples > 7 && firstFrameSamples < 2187);
  const startSample = firstFrameSamples - 7;
  const decodedSource = ffmpeg(["-v", "error", "-i", sourcePath, "-c:a", "pcm_s24le", "-f", "s24le", "pipe:1"]);
  const result = await run({ ...f.request, sourcePath, expectedSource: { sha256: hash(bytes), byteLength: bytes.length }, interval: { ...f.request.interval, startSample } });
  const decodedCut = ffmpeg(["-v", "error", "-i", result.audioPath, "-c:a", "pcm_s24le", "-f", "s24le", "pipe:1"]);
  assert.deepEqual(decodedCut, decodedSource.subarray(startSample * 6, 2187 * 6));
  assert.equal(result.manifest.output.sampleCount, 2187 - startSample);
  const frameSizeFlag = result.manifest.extraction.arguments.indexOf("-frame_size");
  assert.equal(result.manifest.extraction.arguments[frameSizeFlag + 1], "4608");
});

test("sub-block intervals retain exactly one, seven, or fifteen samples without padding", posixOnly, async (t) => {
  const f = await fixture(t);
  for (const sampleCount of [1, 7, 15]) {
    const startSample = 100;
    const endSample = startSample + sampleCount;
    const result = await run({ ...f.request, artifactDirectory: join(f.directory, `tiny-${sampleCount}`), interval: { ...f.request.interval, startSample, endSample } });
    const actual = ffmpeg(["-v", "error", "-i", result.audioPath, "-c:a", "pcm_s24le", "-f", "s24le", "pipe:1"]);
    assert.deepEqual(actual, f.pcm.subarray(startSample * 6, endSample * 6));
    assert.equal(result.manifest.output.sampleCount, sampleCount);
  }
});

test("a modified manifest is rejected even if its audio still matches", posixOnly, async (t) => {
  const f = await fixture(t);
  const result = await run(f.request);
  const changed = { ...result.manifest, precision: "accidentally replaced provenance" };
  await writeFile(result.manifestPath, JSON.stringify(changed));
  await assert.rejects(run(f.request), hasCode("ArtifactMismatch"));
  assert.deepEqual(JSON.parse(await readFile(result.manifestPath, "utf8")), changed);
  assert.equal(await readFile(f.logPath, "utf8"), "extract\n");
});

test("a valid FLAC with replaced samples cannot be reused as the saved result", posixOnly, async (t) => {
  const f = await fixture(t);
  const first = await run(f.request);
  ffmpeg(["-v", "error", "-y", "-i", f.sourcePath, "-af", "atrim=start_sample=24:end_sample=2188,asetpts=PTS-STARTPTS", "-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24", first.audioPath]);
  const replacement = await readFile(first.audioPath);
  await assert.rejects(run(f.request), hasCode("ArtifactMismatch"));
  assert.deepEqual(await readFile(first.audioPath), replacement);
  assert.equal(await readFile(f.logPath, "utf8"), "extract\n");
});

test("unsafe bounds and mismatched source identity fail before extraction", posixOnly, async (t) => {
  const f = await fixture(t);
  for (const interval of [
    { ...f.request.interval, startSample: 1.5 }, { ...f.request.interval, startSample: -1 },
    { ...f.request.interval, startSample: 2187 }, { ...f.request.interval, endSample: Number.MAX_SAFE_INTEGER + 1 },
  ]) await assert.rejects(run({ ...f.request, interval }), hasCode("InvalidRequest"));
  await assert.rejects(run({ ...f.request, expectedSource: { ...f.request.expectedSource, sha256: "0".repeat(64) } }), hasCode("SourceMismatch"));
  await assert.rejects(run({ ...f.request, expectedSource: { ...f.request.expectedSource, byteLength: f.sourceBytes.length + 1 } }), hasCode("SourceMismatch"));
  await assert.rejects(run({ ...f.request, audioStreamIndex: 99 }), hasCode("AudioStreamNotFound"));
  assert.ok(!(await readdir(f.directory)).includes("cut"));
  assert.ok(!(await readdir(f.directory)).includes("extractions.log"));
});

test("an interval extending past decoded EOF cannot publish a partial successful cut", posixOnly, async (t) => {
  const f = await fixture(t);
  await assert.rejects(run({ ...f.request, interval: { ...f.request.interval, startSample: 3000, endSample: 3500 } }), hasCode("InvalidOutput"));
  assert.ok(!(await readdir(f.directory)).includes("cut"));
  assert.deepEqual(await readFile(f.sourcePath), f.sourceBytes);
});

test("failed and timed-out extraction cleans staging files and reaps its child", posixOnly, async (t) => {
  const failed = await fixture(t, 'fs.writeFileSync(args.at(-1), "partial output"); process.exit(7);');
  await assert.rejects(run(failed.request), hasCode("ProcessFailed"));
  assert.ok(!(await readdir(failed.directory)).includes("cut"));
  const timed = await fixture(t, 'setInterval(() => {}, 1000); return;');
  await assert.rejects(run({ ...timed.request, extractionTimeoutMs: 150 }), hasCode("ProcessTimedOut"));
  assert.ok(!(await readdir(timed.directory)).includes("cut"));
  const pid = Number(await readFile(timed.pidPath, "utf8"));
  assert.throws(() => process.kill(pid, 0), hasCode("ESRCH"));
});

test("source changes during extraction prevent publishing a completed result", posixOnly, async (t) => {
  const f = await fixture(t, 'const source = args[args.indexOf("-i") + 1]; const child = cp.spawnSync("ffmpeg", args, { stdio: "inherit" }); fs.appendFileSync(source, "changed"); process.exit(child.status ?? 1);');
  await assert.rejects(run(f.request), hasCode("SourceChanged"));
  assert.ok(!(await readdir(f.directory)).includes("cut"));
});

test("output size limits and orphan artifacts never become successful results", posixOnly, async (t) => {
  const f = await fixture(t);
  await assert.rejects(run({ ...f.request, maxOutputBytes: 10 }), hasCode("InvalidOutput"));
  assert.ok(!(await readdir(f.directory)).includes("cut"));
  await mkdir(f.request.artifactDirectory);
  const partial = join(f.request.artifactDirectory, "audio.flac");
  await writeFile(partial, "unverified existing audio");
  await assert.rejects(run(f.request), hasCode("ArtifactIoFailed"));
  assert.deepEqual(await readdir(f.request.artifactDirectory), ["audio.flac"]);
  assert.equal(await readFile(partial, "utf8"), "unverified existing audio");
  assert.equal(await readFile(f.logPath, "utf8"), "extract\n");
});
