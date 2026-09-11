import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { extractStoryAudio, StoryAudioError } from "../story-audio/index.js";
import { sha256 } from "../transcription/content-hash.js";
import { type StorySplitConfig, type StorySplitPlan } from "./contracts.js";
import { splitStories, StorySplitError, validateStorySplit } from "./index.js";

const sampleRate = 8000;
const sampleCount = sampleRate * 6;
const encode = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const hasCode = (code: string) => (error: unknown): boolean => error instanceof StorySplitError && error.code === code;
const run = (options: { planPath: string; configPath: string; artifactDirectory: string; sourcePath?: string }, extract: typeof extractStoryAudio = extractStoryAudio) =>
  Effect.runPromise(splitStories(options, extract).pipe(Effect.provide(NodeServices.layer)));
const validate = (options: { planPath: string; configPath: string; sourcePath?: string }) => Effect.runPromise(validateStorySplit(options).pipe(Effect.provide(NodeServices.layer)));

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "animator-story-split-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Six seconds of deterministic non-silent PCM16; no copyrighted media is used.
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) pcm.writeInt16LE(((i % 97) - 48) * 400, i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  const sourceBytes = Buffer.concat([header, pcm]);
  const sourcePath = join(directory, "source.wav");
  await writeFile(sourcePath, sourceBytes);
  const word = (id: string, value: string, start: number, end: number) => ({ kind: "word", id, speaker: 0, value, confidence: 0.95, providerStartSeconds: start, providerEndSeconds: end });
  const punct = (id: string, value: string) => ({ kind: "punctuation", id, speaker: 0, value });
  const elements = [
    word("m0:e0", "Opening", 0.15, 0.6), punct("m0:e1", ". "),
    word("m1:e0", "First", 1.1, 1.3), punct("m1:e1", " "), word("m1:e2", "story", 1.4, 1.6), punct("m1:e3", ". "),
    word("m1:e4", "Hello", 1.9, 2.3), punct("m1:e5", " "), word("m1:e6", "world", 2.5, 2.9), punct("m1:e7", ". "),
    word("m2:e0", "Authors", 3.1, 3.4), punct("m2:e1", " "), word("m2:e2", "note", 3.5, 3.8), punct("m2:e3", ". "),
    word("m3:e0", "Second", 4.1, 4.5), punct("m3:e1", " "), word("m3:e2", "story", 4.6, 4.9), punct("m3:e3", ". "),
    word("m4:e0", "The end", 5.1, 5.8), punct("m4:e1", "."),
  ];
  const sourceSha256 = sha256(sourceBytes);
  const transcript = {
    schemaVersion: 1, kind: "whole-book-timed-transcript", provider: { name: "rev-ai", jobId: "synthetic-book-job", rawSha256: "b".repeat(64) },
    source: { path: sourcePath, realPath: sourcePath, sha256: sourceSha256, byteLength: sourceBytes.length, durationSeconds: 6, durationEvidence: "audio-stream",
      audio: { streamIndex: 0, codec: "pcm_s16le", sampleRateHz: sampleRate, channels: 1, startTimeSeconds: null } },
    timing: { clock: "submitted-media-provider", mappingToExtractionClock: "unverified" }, wordCount: 10, elements,
  };
  const transcriptPath = join(directory, "book-transcript.json");
  const transcriptBytes = encode(transcript);
  await writeFile(transcriptPath, transcriptBytes);
  const evidencePath = join(directory, "boundary-evidence.json");
  const evidenceBytes = encode({ kind: "synthetic-boundary-evidence", description: "Deliberate synthetic intervals; not autonomous discovery." });
  await writeFile(evidencePath, evidenceBytes);
  const plan: StorySplitPlan = {
    schemaVersion: 1, kind: "story-split-plan", bookTitle: "Synthetic collection",
    source: { path: "source.wav", sha256: sourceSha256, byteLength: sourceBytes.length, audioStreamIndex: 0, sampleRateHz: sampleRate },
    transcript: { path: "book-transcript.json", sha256: sha256(transcriptBytes), providerJobId: "synthetic-book-job", providerRawSha256: "b".repeat(64) },
    timing: { clock: "ffmpeg-decoded-audio-samples", providerToDecodedOffsetSeconds: 0.025, basis: "Explicit synthetic timing offset." },
    evidence: [{ path: "boundary-evidence.json", sha256: sha256(evidenceBytes), description: "Synthetic complete assignment." }],
    segments: [
      { id: "opening-credits", title: "Opening credits", kind: "opening-credits", elementStartIndex: 0, elementEndIndexExclusive: 2, startSample: 0, endSample: 8000 },
      { id: "first-story", title: "First story", kind: "story", elementStartIndex: 2, elementEndIndexExclusive: 10, startSample: 8000, endSample: 24000 },
      { id: "first-note", title: "First author note", kind: "author-note", elementStartIndex: 10, elementEndIndexExclusive: 14, startSample: 24000, endSample: 32000 },
      { id: "second-story", title: "Second story", kind: "story", elementStartIndex: 14, elementEndIndexExclusive: 18, startSample: 32000, endSample: 40000 },
      { id: "closing-credits", title: "Closing credits", kind: "closing-credits", elementStartIndex: 18, elementEndIndexExclusive: 20, startSample: 40000, endSample: 48000 },
    ],
  };
  const config: StorySplitConfig = {
    schemaVersion: 1, concurrency: 2, maxSegments: 16, maxPlanBytes: 65536, maxTranscriptBytes: 1048576,
    maxEvidenceBytes: 65536, maxSegmentTranscriptBytes: 1048576, maxInventoryBytes: 1048576, maxRunManifestBytes: 1048576, wordTimingToleranceSeconds: 0.1,
    audio: { ffmpegPath: "ffmpeg", inspection: { ffprobePath: "ffprobe", probeTimeoutMs: 5000, maxProbeOutputBytes: 1048576, maxProbeErrorBytes: 65536, hashChunkBytes: 65536, cueChapterToleranceSeconds: 0.02 },
      extractionTimeoutMs: 10000, verificationTimeoutMs: 10000, maxProcessOutputBytes: 1048576, maxProcessErrorBytes: 65536, maxOutputBytes: 1048576, maxManifestBytes: 1048576 },
  };
  const planPath = join(directory, "plan.json");
  const configPath = join(directory, "config.json");
  await writeFile(planPath, encode(plan));
  await writeFile(configPath, encode(config));
  const artifactDirectory = join(directory, "split");
  return { directory, pcm, sourcePath, sourceBytes, transcript, transcriptPath, evidencePath, plan, config, planPath, configPath, artifactDirectory, options: { planPath, configPath, artifactDirectory } };
}

test("every selected element is paired with exact audio and sample-based durations while provider times remain unchanged", async (t) => {
  const f = await fixture(t);
  const result = await run(f.options);
  assert.equal(result.storyCount, 2);
  assert.equal(result.extraCount, 3);
  const inventory = JSON.parse(await readFile(result.inventoryPath, "utf8"));
  assert.equal(inventory.status, "complete");
  assert.equal(inventory.checks.assignedElementCount, 20);
  assert.equal(inventory.checks.assignedWordCount, 10);
  const first = result.stories[0]!;
  assert.equal(first.durationSeconds, 2, "duration must come from 16000 verified samples / 8000 Hz, not the 1.8-second word span");
  assert.equal(first.durationDisplay, "00:00:02.000");
  const pair = JSON.parse(await readFile(join(f.artifactDirectory, first.transcriptPath), "utf8"));
  assert.equal(pair.elements[0].id, "m1:e0");
  assert.equal(pair.elements[0].providerStartSeconds, 1.1);
  assert.ok(Math.abs(pair.elements[0].approximateSegmentStartSeconds - 0.125) < 1e-12);
  assert.equal(pair.timing.wordTiming, "approximate-provider-times-mapped-to-segment");
  assert.deepEqual(pair.elements.map((element: { bookElementIndex: number }) => element.bookElementIndex), [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(!("approximateSegmentStartSeconds" in pair.elements[1]), "punctuation must remain untimed");
  assert.equal(await readFile(join(f.artifactDirectory, first.textPath), "utf8"), `${pair.text}\n`);
  assert.equal(pair.text, "First story. Hello world. ");
  const manifestBytes = await readFile(join(f.artifactDirectory, first.audioManifestPath));
  assert.equal(first.audioManifestSha256, sha256(manifestBytes));
  assert.equal(pair.audio.manifestSha256, sha256(manifestBytes));
  assert.equal(first.audioSha256, sha256(await readFile(join(f.artifactDirectory, first.audioPath))));
  const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", join(f.artifactDirectory, first.audioPath), "-map", "0:0", "-f", "s16le", "-c:a", "pcm_s16le", "pipe:1"], { maxBuffer: 1048576 });
  assert.equal(decoded.status, 0, decoded.stderr.toString());
  assert.deepEqual(decoded.stdout, f.pcm.subarray(8000 * 2, 24000 * 2));
  const restored: unknown[] = [];
  for (const segment of f.plan.segments) {
    const saved = JSON.parse(await readFile(join(f.artifactDirectory, "segments", segment.id, "transcript.json"), "utf8"));
    restored.push(...saved.elements.map(({ bookElementIndex: _index, approximateSegmentStartSeconds: _start, approximateSegmentEndSeconds: _end, ...element }: Record<string, unknown>) => element));
  }
  assert.deepEqual(restored, f.transcript.elements, "pairing must preserve every normalized element once");
  assert.deepEqual(await readFile(f.sourcePath), f.sourceBytes);
});

test("plan gaps, overlaps, duplicate IDs, invalid sample bounds, and mismatched identities stop before extraction", async (t) => {
  const f = await fixture(t);
  const mutations: Array<{ change: (plan: StorySplitPlan) => void; code: string }> = [
    { change: (p) => { (p.segments[1] as { elementStartIndex: number }).elementStartIndex = 1; }, code: "InvalidAssignment" },
    { change: (p) => { (p.segments[1] as { elementStartIndex: number }).elementStartIndex = 3; }, code: "InvalidAssignment" },
    { change: (p) => { (p.segments[4] as { elementEndIndexExclusive: number }).elementEndIndexExclusive = 19; }, code: "InvalidAssignment" },
    { change: (p) => { (p.segments[2] as { startSample: number }).startSample = 23000; }, code: "InvalidAssignment" },
    { change: (p) => { (p.segments[1] as { id: string }).id = "opening-credits"; }, code: "InvalidAssignment" },
    { change: (p) => { (p.segments[1] as { startSample: number }).startSample = 8000.5; }, code: "InvalidPlan" },
    { change: (p) => { (p.source as { sha256: string }).sha256 = "a".repeat(64); }, code: "SourceMismatch" },
    { change: (p) => { (p.transcript as { sha256: string }).sha256 = "a".repeat(64); }, code: "TranscriptMismatch" },
    { change: (p) => { (p.transcript as { providerJobId: string }).providerJobId = "wrong-job"; }, code: "TranscriptMismatch" },
    { change: (p) => { (p.transcript as { providerRawSha256: string }).providerRawSha256 = "a".repeat(64); }, code: "TranscriptMismatch" },
    { change: (p) => { (p.timing as { providerToDecodedOffsetSeconds: number }).providerToDecodedOffsetSeconds = 2; }, code: "WordOutsideAudio" },
  ];
  for (const { change, code } of mutations) {
    const plan = structuredClone(f.plan);
    change(plan);
    await writeFile(f.planPath, encode(plan));
    await assert.rejects(run(f.options, () => { assert.fail("invalid input must not reach extraction"); }), hasCode(code));
  }
  assert.ok(!(await readdir(f.directory)).includes("split"));
});

test("changed input evidence and source bytes cannot be accepted under their previous identities", async (t) => {
  const f = await fixture(t);
  await writeFile(f.evidencePath, "changed evidence");
  await assert.rejects(validate(f.options), hasCode("EvidenceMismatch"));
  await writeFile(f.evidencePath, encode({ kind: "synthetic-boundary-evidence", description: "Deliberate synthetic intervals; not autonomous discovery." }));
  const changed = Buffer.from(f.sourceBytes);
  changed[100] = (changed[100]! + 1) % 256;
  await writeFile(f.sourcePath, changed);
  await assert.rejects(validate(f.options), hasCode("SourceMismatch"));
});

test("compatible reruns reuse all audio and preserve inventory bytes; changed plans or corrupt pairs do not overwrite", async (t) => {
  const f = await fixture(t);
  const first = await run(f.options);
  const originalInventory = await readFile(first.inventoryPath);
  let reused = 0;
  await run(f.options, (request) => extractStoryAudio(request).pipe(Effect.tap((result) => Effect.sync(() => { if (result.reused) reused++; }))));
  assert.equal(reused, 5);
  assert.deepEqual(await readFile(first.inventoryPath), originalInventory);
  await writeFile(f.planPath, encode({ ...f.plan, bookTitle: "Different identity" }));
  await assert.rejects(run(f.options), hasCode("ArtifactMismatch"));
  await writeFile(f.planPath, encode(f.plan));
  const pairPath = join(f.artifactDirectory, first.stories[0]!.transcriptPath);
  await writeFile(pairPath, "corrupted existing pair");
  await assert.rejects(run(f.options), hasCode("ArtifactMismatch"));
  assert.equal(await readFile(pairPath, "utf8"), "corrupted existing pair");
  assert.deepEqual(await readFile(first.inventoryPath), originalInventory);
});

test("an explicit source override reuses every paired output without changing plans or historical artifact bytes", async (t) => {
  const f = await fixture(t);
  const first = await run(f.options);
  const paths = ["run-manifest.json", "plan.raw.json", "inventory.json", "inventory.md",
    ...[...first.stories, ...first.extras].flatMap((entry) => [entry.audioPath, entry.audioManifestPath, entry.transcriptPath, entry.textPath])];
  const snapshots = await Promise.all(paths.map(async (path) => ({ path, bytes: await readFile(join(f.artifactDirectory, path)) })));
  const planBytes = await readFile(f.planPath);
  const transcriptBytes = await readFile(f.transcriptPath);
  const movedPath = join(f.directory, "moved source.wav");
  await copyFile(f.sourcePath, movedPath);
  await rm(f.sourcePath);
  await assert.rejects(validate(f.options), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "SourceNotFound");
  await assert.rejects(validate({ ...f.options, sourcePath: "" }), hasCode("InvalidConfig"));
  const options = { ...f.options, sourcePath: movedPath };
  assert.equal((await validate(options)).planSha256, sha256(planBytes));
  let reused = 0;
  const result = await run(options, (request) => extractStoryAudio(request).pipe(Effect.tap((output) => Effect.sync(() => { if (output.reused) reused++; }))));
  assert.equal(reused, 5);
  assert.deepEqual(result, first);
  const checked = spawnSync(process.execPath, [resolve("dist/cli.js"), "intake", "split", "--plan", f.planPath, "--run", f.configPath, "--source", "moved source.wav", "--validate-only"], { encoding: "utf8", cwd: f.directory });
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).planSha256, sha256(planBytes));
  await writeFile(f.configPath, encode({ ...f.config, concurrency: 1 }));
  await assert.rejects(run(options), hasCode("ArtifactMismatch"));
  await writeFile(f.configPath, encode(f.config));
  const changed = Buffer.from(f.sourceBytes);
  changed[100] = changed[100]! ^ 1;
  await writeFile(movedPath, changed);
  await assert.rejects(run(options, () => { assert.fail("changed source bytes must not reach extraction or cache reuse"); }), hasCode("SourceMismatch"));
  assert.deepEqual(await readFile(f.planPath), planBytes);
  assert.deepEqual(await readFile(f.transcriptPath), transcriptBytes);
  for (const { path, bytes } of snapshots) assert.deepEqual(await readFile(join(f.artifactDirectory, path)), bytes, path);
});

test("a partial extraction failure publishes no complete inventory and resumes verified pairs on retry", async (t) => {
  const f = await fixture(t);
  await writeFile(f.configPath, encode({ ...f.config, concurrency: 1 }));
  let count = 0;
  await assert.rejects(run(f.options, (request) => {
    count++;
    return count === 3 ? Effect.fail(new StoryAudioError({ code: "ProcessFailed", message: "Synthetic third-segment failure." })) : extractStoryAudio(request);
  }), (error: unknown) => error instanceof StoryAudioError && error.code === "ProcessFailed");
  const entries = await readdir(f.artifactDirectory);
  assert.ok(!entries.includes("inventory.json"));
  assert.ok(!entries.includes("inventory.md"));
  assert.ok((await readdir(join(f.artifactDirectory, "segments", "first-story"))).includes("transcript.json"));
  let reused = 0;
  const result = await run(f.options, (request) => extractStoryAudio(request).pipe(Effect.tap((output) => Effect.sync(() => { if (output.reused) reused++; }))));
  assert.equal(reused, 2);
  assert.equal(result.storyCount, 2);
});

test("input changes during extraction prevent a complete inventory even when individual audio pairs succeeded", async (t) => {
  const f = await fixture(t);
  let changed = false;
  await assert.rejects(run(f.options, (request) => extractStoryAudio(request).pipe(Effect.tap(() => Effect.promise(async () => {
    if (!changed) { changed = true; await writeFile(f.evidencePath, "changed during run"); }
  })))), hasCode("ArtifactMismatch"));
  assert.ok(!(await readdir(f.artifactDirectory)).includes("inventory.json"));
});

test("validation-only CLI emits JSON without creating output; errors and help stay on stderr", async (t) => {
  const f = await fixture(t);
  const cli = resolve("dist/cli.js");
  const checked = spawnSync(process.execPath, [cli, "intake", "split", "--plan", f.planPath, "--run", f.configPath, "--validate-only"], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(checked.stderr, "");
  assert.equal(JSON.parse(checked.stdout).assignedElementCount, 20);
  assert.ok(!(await readdir(f.directory)).includes("split"));
  const bad = spawnSync(process.execPath, [cli, "intake", "split", "--plan", f.planPath, "--run", f.configPath], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, "");
  assert.match(bad.stderr, /either --output or --validate-only/);
  const help = spawnSync(process.execPath, [cli, "intake", "split", "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.equal(help.stdout, "");
  assert.match(help.stderr, /does not discover or choose cuts/);
});

test("CLI failures retain actionable child stderr while bounding large diagnostics", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  const fakeFfmpeg = join(f.directory, "failing-ffmpeg");
  const childStderr = `${"Earlier process output.\n".repeat(1000)}Failed to inject frame into filter network: Invalid argument\nDiagnostic end marker.\n`;
  await writeFile(fakeFfmpeg, `#!/usr/bin/env node\nif (process.argv.includes('-version')) { process.stdout.write('ffmpeg synthetic diagnostic fixture\\n'); } else { process.stderr.write(${JSON.stringify(childStderr)}); process.exitCode = 234; }\n`);
  await chmod(fakeFfmpeg, 0o700);
  await writeFile(f.configPath, encode({ ...f.config, audio: { ...f.config.audio, ffmpegPath: fakeFfmpeg } }));
  const failed = spawnSync(process.execPath, [resolve("dist/cli.js"), "intake", "split", "--plan", f.planPath, "--run", f.configPath, "--output", f.artifactDirectory], { encoding: "utf8", maxBuffer: 65536 });
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, "");
  assert.match(failed.stderr, /ProcessFailed: FFmpeg exited with status 234/);
  assert.match(failed.stderr, /Process stderr \(last 8192 bytes; earlier output omitted\)/);
  assert.match(failed.stderr, /Failed to inject frame into filter network: Invalid argument/);
  assert.match(failed.stderr, /Diagnostic end marker/);
  assert.ok(Buffer.byteLength(failed.stderr) < 8500, "the CLI must not dump all child output or an unbounded error object");
  assert.ok(!(await readdir(f.artifactDirectory)).includes("inventory.json"));
});
