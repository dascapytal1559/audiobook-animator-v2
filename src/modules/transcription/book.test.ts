import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { sha256 } from "./content-hash.js";
import { BookTranscriptionError, importRevBookTranscript, prepareRevBook, type RevBookConfig } from "./book.js";
import { TranscriptionError } from "./contracts.js";

const duration = 40_928.885261;
const sourceBytes = Buffer.from("Synthetic complete-source bytes; not copyrighted audio.");
const transcript = { monologues: [
  { speaker: 0, elements: [
    { type: "text", value: "Beginning", ts: 0.025, end_ts: 0.5, confidence: 0.98 },
    { type: "punct", value: "." },
  ] },
  { speaker: 1, elements: [
    { type: "text", value: "Full", ts: 40_927.5, end_ts: 40_928 },
    { type: "punct", value: " " },
    { type: "text", value: "book", ts: 40_928.1, end_ts: 40_928.8, confidence: 0.9 },
    { type: "punct", value: "." },
  ] },
] };
const hasCode = (code: string) => (error: unknown): boolean =>
  (error instanceof BookTranscriptionError || error instanceof TranscriptionError) && error.code === code;
const runPrepare = (configPath: string) => Effect.runPromise(prepareRevBook({ configPath }).pipe(Effect.provide(NodeServices.layer)));
const runImport = (options: { configPath: string; transcriptPath: string; jobId: string }) =>
  Effect.runPromise(importRevBookTranscript(options).pipe(Effect.provide(NodeServices.layer)));
const posixOnly = { skip: process.platform === "win32" ? "Executable ffprobe fixture uses a POSIX shebang." : false };

async function writeProbe(path: string, document: unknown) {
  await writeFile(path, `#!/usr/bin/env node\nconst document = ${JSON.stringify(document)}; document.format.filename = process.argv.at(-1); process.stdout.write(JSON.stringify(document));\n`);
  await chmod(path, 0o700);
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "animator-rev-book-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, "book original.mp3");
  const ffprobePath = join(directory, "ffprobe");
  const document = {
    streams: [{ index: 0, codec_type: "audio", codec_name: "mp3", sample_fmt: "fltp", sample_rate: "44100", channels: 1, duration: String(duration), start_time: "0.025057" }, { index: 1, codec_type: "video", codec_name: "mjpeg", disposition: { attached_pic: 1 } }],
    format: { duration: String(duration), size: String(sourceBytes.length), start_time: "0.025056" },
  };
  await writeFile(sourcePath, sourceBytes);
  await writeProbe(ffprobePath, document);
  const config: RevBookConfig = {
    schemaVersion: 1, sourcePath: "book original.mp3", artifactDirectory: "artifacts",
    expectedSource: { sha256: sha256(sourceBytes), byteLength: sourceBytes.length },
    maxInputBytes: 2_000_000_000, maxDurationSeconds: 61_200,
    maxTranscriptBytes: 64 * 1024 * 1024, maxNormalizedTranscriptBytes: 512 * 1024 * 1024,
    timestampToleranceSeconds: 0.1,
    inspection: { ffprobePath: "./ffprobe", probeTimeoutMs: 5_000, maxProbeOutputBytes: 1024 * 1024, maxProbeErrorBytes: 1024, hashChunkBytes: 16, cueChapterToleranceSeconds: 0.02, audioStreamIndex: 0 },
  };
  const configPath = join(directory, "config.json");
  await writeFile(configPath, JSON.stringify(config));
  const transcriptPath = join(directory, "dashboard.json");
  const raw = Buffer.from(`\ufeff${JSON.stringify(transcript, null, 2).replaceAll("\n", "\r\n")}\r\n`);
  await writeFile(transcriptPath, raw);
  return { directory, config, configPath, sourcePath, ffprobePath, document, transcriptPath, raw, artifactDirectory: join(directory, "artifacts"), options: { configPath, transcriptPath, jobId: "whole-book-job" } };
}

test("prepare preserves complete source inspection and pins an eleven-hour original without decoding or copying it", posixOnly, async (t) => {
  const f = await fixture(t);
  const result = await runPrepare(f.configPath);
  assert.equal(result.currentSourcePath, f.sourcePath);
  assert.equal(result.source.sha256, sha256(sourceBytes));
  assert.equal(result.source.byteLength, sourceBytes.length);
  assert.equal(result.source.durationSeconds, duration);
  assert.equal(result.source.audio.streamIndex, 0);
  assert.equal(result.source.audio.startTimeSeconds, 0.025057);
  assert.equal(result.timing.clock, "submitted-media-provider");
  assert.equal(result.timing.mappingToExtractionClock, "unverified");
  assert.deepEqual((await readdir(f.artifactDirectory)).sort(), ["preparation.json", "source-inspection.json"]);
  const inspection = JSON.parse(await readFile(result.inspectionPath, "utf8"));
  assert.equal(inspection.audio.raw.start_time, "0.025057");
  assert.equal(inspection.format.start_time, "0.025056");
  assert.equal(inspection.audioStreamIndices.length, 1);
  assert.deepEqual(await runPrepare(f.configPath), result);
  assert.deepEqual(await readFile(f.sourcePath), sourceBytes);
});

test("full-book import preserves exact exported bytes and provider times without inventing an extraction clock or coverage score", posixOnly, async (t) => {
  const f = await fixture(t);
  const result = await runImport(f.options);
  assert.equal(result.wordCount, 3);
  assert.equal(result.firstWordStartSeconds, 0.025);
  assert.equal(result.lastWordEndSeconds, 40_928.8);
  assert.equal(result.recognitionAndCoverage, "not-verified");
  assert.deepEqual(await readFile(result.rawTranscriptPath), f.raw);
  const saved = JSON.parse(await readFile(result.transcriptPath, "utf8"));
  assert.equal(saved.provider.rawSha256, sha256(f.raw));
  assert.equal(saved.provider.association, "operator-supplied-source-export-and-job-id");
  assert.equal(saved.provider.requestedSettings, null);
  assert.equal(saved.timing.mappingToExtractionClock, "unverified");
  assert.equal(saved.elements[0].providerStartSeconds, 0.025);
  assert.equal(saved.elements[0].confidence, 0.98);
  assert.equal(saved.elements[2].confidence, null);
  assert.ok(!("sourceStartSeconds" in saved.elements[0]));
  assert.ok(!("clipStartSeconds" in saved.elements[0]));
  assert.equal(await readFile(result.textPath, "utf8"), "Beginning.\nFull book.\n");
  assert.deepEqual(await runImport(f.options), result);
});

test("moving an identical source reuses whole-book preparation and import without rewriting any historical artifacts", posixOnly, async (t) => {
  const f = await fixture(t);
  const prepared = await runPrepare(f.configPath);
  const imported = await runImport(f.options);
  const snapshots = await Promise.all((await readdir(f.artifactDirectory)).map(async (name) => ({ name, bytes: await readFile(join(f.artifactDirectory, name)) })));
  const movedPath = join(f.directory, "moved book.mp3");
  // Copy then remove also changes the inode and modification time, unlike a same-volume rename.
  await copyFile(f.sourcePath, movedPath);
  await rm(f.sourcePath);
  await writeFile(f.configPath, JSON.stringify({ ...f.config, sourcePath: "moved book.mp3" }));
  assert.deepEqual(await runPrepare(f.configPath), { ...prepared, currentSourcePath: movedPath });
  assert.deepEqual(await runImport(f.options), { ...imported, currentSourcePath: movedPath });
  assert.equal(imported.source.path, f.sourcePath, "the result identifies historical submitted media; it must not rewrite its provenance");
  for (const { name, bytes } of snapshots) assert.deepEqual(await readFile(join(f.artifactDirectory, name)), bytes, name);
  assert.deepEqual(await readFile(movedPath), sourceBytes);

  const changed = Buffer.from(sourceBytes);
  changed[0] = changed[0]! ^ 1;
  await writeFile(movedPath, changed);
  await assert.rejects(runPrepare(f.configPath), hasCode("InputMismatch"));
  await assert.rejects(runImport(f.options), hasCode("InputMismatch"));
  await writeFile(f.configPath, JSON.stringify({ ...f.config, sourcePath: "moved book.mp3", expectedSource: { ...f.config.expectedSource, sha256: sha256(changed) } }));
  await assert.rejects(runPrepare(f.configPath), hasCode("ArtifactMismatch"));
  for (const { name, bytes } of snapshots) assert.deepEqual(await readFile(join(f.artifactDirectory, name)), bytes, name);
});

test("source relocation cannot hide changed limits, audio format, or corrupted preparation evidence", posixOnly, async (t) => {
  const f = await fixture(t);
  const prepared = await runPrepare(f.configPath);
  const preparationBytes = await readFile(prepared.preparationPath);
  const inspectionBytes = await readFile(prepared.inspectionPath);
  const movedPath = join(f.directory, "moved.mp3");
  await copyFile(f.sourcePath, movedPath);
  await rm(f.sourcePath);
  const relocated = { ...f.config, sourcePath: "moved.mp3" };
  await writeFile(f.configPath, JSON.stringify({ ...relocated, maxNormalizedTranscriptBytes: f.config.maxNormalizedTranscriptBytes - 1 }));
  await assert.rejects(runPrepare(f.configPath), hasCode("ArtifactMismatch"));
  await writeFile(f.configPath, JSON.stringify(relocated));
  await writeProbe(f.ffprobePath, { ...f.document, streams: [{ ...f.document.streams[0], sample_fmt: "s16" }, f.document.streams[1]] });
  await assert.rejects(runPrepare(f.configPath), hasCode("ArtifactMismatch"));
  await writeProbe(f.ffprobePath, f.document);
  await writeFile(prepared.inspectionPath, Buffer.concat([inspectionBytes, Buffer.from(" ")]));
  await assert.rejects(runPrepare(f.configPath), hasCode("ArtifactMismatch"));
  await writeFile(prepared.inspectionPath, inspectionBytes);
  await writeFile(prepared.preparationPath, JSON.stringify({ ...JSON.parse(preparationBytes.toString()), signature: "0".repeat(64) }));
  await assert.rejects(runPrepare(f.configPath), hasCode("ArtifactMismatch"));
  await writeFile(prepared.preparationPath, preparationBytes);
  assert.deepEqual(await runPrepare(f.configPath), { ...prepared, currentSourcePath: movedPath });
});

test("reruns cannot replace artifacts with a different job, export, configuration, or corrupted normalized output", posixOnly, async (t) => {
  const f = await fixture(t);
  const result = await runImport(f.options);
  const original = await readFile(result.transcriptPath);
  await assert.rejects(runImport({ ...f.options, jobId: "other-job" }), hasCode("ArtifactMismatch"));
  await writeFile(f.transcriptPath, JSON.stringify(transcript));
  await assert.rejects(runImport(f.options), hasCode("ArtifactMismatch"));
  await writeFile(f.transcriptPath, f.raw);
  await writeFile(f.configPath, JSON.stringify({ ...f.config, timestampToleranceSeconds: 0.2 }));
  await assert.rejects(runImport(f.options), hasCode("ArtifactMismatch"));
  assert.deepEqual(await readFile(result.transcriptPath), original);
  await writeFile(f.configPath, JSON.stringify(f.config));
  await writeFile(result.transcriptPath, "corrupted cached result");
  await assert.rejects(runImport(f.options), hasCode("ArtifactMismatch"));
  assert.equal(await readFile(result.transcriptPath, "utf8"), "corrupted cached result");
  assert.deepEqual(await readFile(result.rawTranscriptPath), f.raw);
});

test("orphan transcript files cannot acquire evidence for an unrelated job", posixOnly, async (t) => {
  const f = await fixture(t);
  await runPrepare(f.configPath);
  const orphanPath = join(f.artifactDirectory, "transcript.raw.json");
  await writeFile(orphanPath, "export from an unidentified earlier job");
  await assert.rejects(runImport(f.options), hasCode("ArtifactMismatch"));
  assert.ok(!(await readdir(f.artifactDirectory)).includes("evidence.json"));
  assert.equal(await readFile(orphanPath, "utf8"), "export from an unidentified earlier job");
});

test("source replacement, excessive source duration, byte limits, and multiple audio streams prevent preparation", posixOnly, async (t) => {
  const f = await fixture(t);
  await writeFile(f.sourcePath, Buffer.alloc(sourceBytes.length, 120));
  await assert.rejects(runPrepare(f.configPath), hasCode("InputMismatch"));
  await writeFile(f.sourcePath, sourceBytes);
  await writeFile(f.configPath, JSON.stringify({ ...f.config, maxDurationSeconds: 100 }));
  await assert.rejects(runPrepare(f.configPath), hasCode("InputLimitExceeded"));
  await writeFile(f.configPath, JSON.stringify({ ...f.config, maxInputBytes: sourceBytes.length - 1 }));
  await assert.rejects(runPrepare(f.configPath), hasCode("InputLimitExceeded"));
  await writeFile(f.configPath, JSON.stringify(f.config));
  const multi = { ...f.document, streams: [...f.document.streams, { ...f.document.streams[0], index: 2 }] };
  await writeFile(f.ffprobePath, `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(${JSON.stringify(multi)}));\n`);
  await assert.rejects(runPrepare(f.configPath), hasCode("InputMismatch"));
});

test("missing or invalid job identity and source changes fail before a trusted import", posixOnly, async (t) => {
  const f = await fixture(t);
  await assert.rejects(runImport({ ...f.options, jobId: "" }), hasCode("InvalidJobId"));
  await assert.rejects(runImport({ ...f.options, jobId: "a/b" }), hasCode("InvalidJobId"));
  await assert.rejects(runImport({ ...f.options, transcriptPath: "" }), hasCode("InvalidTranscript"));
  const result = await runPrepare(f.configPath);
  const snapshot = await readFile(result.preparationPath);
  await writeFile(f.sourcePath, Buffer.alloc(sourceBytes.length, 120));
  await assert.rejects(runImport(f.options), hasCode("InputMismatch"));
  assert.deepEqual(await readFile(result.preparationPath), snapshot);
});

test("invalid and unordered transcript times retain raw evidence but produce no normalized output", posixOnly, async (t) => {
  const invalid = [
    { monologues: [{ speaker: 0, elements: [{ type: "text", value: "late", ts: duration - 1, end_ts: duration + 1 }] }] },
    { monologues: [{ speaker: 0, elements: [{ type: "text", value: "negative", ts: -1, end_ts: 1 }] }] },
    { monologues: [{ speaker: 0, elements: [{ type: "text", value: "reversed", ts: 2, end_ts: 1 }] }] },
    { monologues: [{ speaker: 0, elements: [{ type: "text", value: "missing" }] }] },
    { monologues: [{ speaker: 0, elements: [{ type: "text", value: "bad confidence", ts: 1, end_ts: 2, confidence: 2 }] }] },
    { monologues: [
      { speaker: 0, elements: [{ type: "text", value: "later", ts: 10, end_ts: 11 }] },
      { speaker: 1, elements: [{ type: "text", value: "earlier", ts: 1, end_ts: 2 }] },
    ] },
  ];
  for (const raw of invalid) {
    const f = await fixture(t);
    const bytes = Buffer.from(JSON.stringify(raw));
    await writeFile(f.transcriptPath, bytes);
    await assert.rejects(runImport(f.options), hasCode("InvalidTimestamps"));
    assert.deepEqual(await readFile(join(f.artifactDirectory, "transcript.raw.json")), bytes);
    assert.ok(!(await readdir(f.artifactDirectory)).includes("transcript.json"));
  }
});

test("raw byte limit, malformed JSON, empty speech, and a contradictory embedded job ID remain explicit failures", posixOnly, async (t) => {
  const capped = await fixture(t);
  await writeFile(capped.configPath, JSON.stringify({ ...capped.config, maxTranscriptBytes: 100 }));
  await assert.rejects(runImport(capped.options), hasCode("ArtifactIoFailed"));
  assert.ok(!(await readdir(capped.artifactDirectory)).includes("transcript.raw.json"));
  for (const [bytes, error] of [
    [Buffer.from([0xff, 0xfe]), "InvalidTranscript"],
    [Buffer.from("{bad json}"), "InvalidTranscript"],
    [Buffer.from(JSON.stringify({ monologues: [] })), "InvalidResponse"],
    [Buffer.from(JSON.stringify({ ...transcript, id: "wrong-job" })), "InvalidJobId"],
  ] as const) {
    const f = await fixture(t);
    await writeFile(f.transcriptPath, bytes);
    await assert.rejects(runImport(f.options), hasCode(error));
    assert.deepEqual(await readFile(join(f.artifactDirectory, "transcript.raw.json")), bytes);
    assert.ok(!(await readdir(f.artifactDirectory)).includes("transcript.json"));
  }
});

test("whole-book CLI prints only JSON on success and sends argument errors and help to stderr", posixOnly, async (t) => {
  const f = await fixture(t);
  const cli = resolve("dist/book-transcription.js");
  const prepared = spawnSync(process.execPath, [cli, "prepare", "--config", f.configPath], { encoding: "utf8" });
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(prepared.stderr, "");
  assert.equal(JSON.parse(prepared.stdout).source.durationSeconds, duration);
  const bad = spawnSync(process.execPath, [cli, "import", "--config", f.configPath], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, "");
  assert.match(bad.stderr, /requires both --transcript and --job-id/);
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.equal(help.stdout, "");
  assert.match(help.stderr, /makes no network request/);
});
