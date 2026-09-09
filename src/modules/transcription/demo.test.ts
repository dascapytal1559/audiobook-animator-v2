import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Effect, Redacted } from "effect";
import { sha256 } from "./artifacts.js";
import {
  importRevDemoTranscript, normalizeRevTranscript, runRevDemo, TranscriptionError,
  type RevDemoConfig, type RevFetch, type TranscriptionInput,
} from "./index.js";

const input: TranscriptionInput = {
  path: "input.flac", sha256: "a".repeat(64), byteLength: 20, durationSeconds: 120,
  sourceSha256: "b".repeat(64), sourceStartSeconds: 6450, sourceClock: "decoded-audio",
  timingCaveat: "Synthetic fixture; source times use the decoded-audio clock.",
};
const transcript = { monologues: [{ speaker: 0, elements: [
  { type: "text", value: "Hello", ts: 0.75, end_ts: 1.1, confidence: 0.98 },
  { type: "punct", value: " " },
  { type: "text", value: "world", ts: 1.2, end_ts: 1.7 },
  { type: "punct", value: "." },
] }] };
const hasCode = (code: string) => (error: unknown): boolean => error instanceof TranscriptionError && error.code === code;
const token = Redacted.make("offline-test-token-never-log");
const json = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });

async function fixture(t: TestContext): Promise<{ directory: string; configPath: string; config: RevDemoConfig; artifactDirectory: string; exportPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), "animator-rev-demo-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from("Synthetic audio bytes; the HTTP client is always fake.");
  await writeFile(join(directory, "input.flac"), bytes);
  await writeFile(join(directory, "provenance.json"), JSON.stringify({ transcriptionInput: { ...input, sha256: sha256(bytes), byteLength: bytes.length } }));
  const config: RevDemoConfig = {
    schemaVersion: 1, apiBaseUrl: "https://api.rev.ai/speechtotext/v1", transcriber: "machine", language: "en",
    inputPath: "input.flac", provenancePath: "provenance.json", artifactDirectory: "artifacts",
    maxInputBytes: 1024, maxClipDurationSeconds: 120, requestTimeoutMs: 1000,
    pollTimeoutMs: 50, pollIntervalMs: 5, maxResponseBytes: 65536, timestampToleranceSeconds: 0.1,
  };
  const configPath = join(directory, "config.json");
  await writeFile(configPath, JSON.stringify(config));
  const exportPath = join(directory, "export.json");
  await writeFile(exportPath, JSON.stringify(transcript));
  return { directory, configPath, config, artifactDirectory: join(directory, "artifacts"), exportPath };
}

test("Rev words preserve confidence, untimed punctuation, and both clocks", async () => {
  const result = await Effect.runPromise(normalizeRevTranscript(transcript, input, 0.1));
  assert.equal(result.text, "Hello world.");
  assert.equal(result.wordCount, 2);
  assert.deepEqual(result.elements[0], {
    kind: "word", id: "m0:e0", speaker: 0, value: "Hello", confidence: 0.98,
    clipStartSeconds: 0.75, clipEndSeconds: 1.1, sourceStartSeconds: 6450.75, sourceEndSeconds: 6451.1,
  });
  assert.deepEqual(result.elements[1], { kind: "punctuation", id: "m0:e1", speaker: 0, value: " " });
  assert.equal(result.elements[2]?.kind === "word" ? result.elements[2].confidence : undefined, null);
});

test("missing, negative, reversed, nonfinite, out-of-range, and unordered word times fail", async () => {
  for (const times of [ {}, { ts: -1, end_ts: 0 }, { ts: 2, end_ts: 1 }, { ts: NaN, end_ts: 1 }, { ts: 119, end_ts: 121 } ]) {
    const malformed = { monologues: [{ speaker: 0, elements: [{ type: "text", value: "bad", ...times }] }] };
    await assert.rejects(Effect.runPromise(normalizeRevTranscript(malformed, input, 0.1)), hasCode("InvalidTimestamps"));
  }
  const unordered = { monologues: [{ speaker: 0, elements: [
    { type: "text", value: "first", ts: 2, end_ts: 3 },
    { type: "text", value: "second", ts: 1, end_ts: 1.5 },
  ] }] };
  await assert.rejects(Effect.runPromise(normalizeRevTranscript(unordered, input, 0.1)), hasCode("InvalidTimestamps"));
});

test("dashboard import requires no credential, keeps original JSON, and guards existing evidence", async (t) => {
  const f = await fixture(t);
  const options = { configPath: f.configPath, transcriptPath: f.exportPath, jobId: "demo-job" };
  const result = await Effect.runPromise(importRevDemoTranscript(options));
  assert.equal(result.wordCount, 2);
  assert.equal(await readFile(result.rawTranscriptPath, "utf8"), await readFile(f.exportPath, "utf8"));
  const saved = JSON.parse(await readFile(result.transcriptPath, "utf8")) as { provider: { requestedSettings: unknown; association: string }; input: TranscriptionInput };
  assert.equal(saved.provider.requestedSettings, null);
  assert.equal(saved.provider.association, "operator-supplied-export-and-job-id");
  assert.equal(saved.input.sourceStartSeconds, 6450);
  assert.equal((await Effect.runPromise(importRevDemoTranscript(options))).wordCount, 2);
  await assert.rejects(Effect.runPromise(importRevDemoTranscript({ ...options, jobId: "different-job" })), hasCode("ArtifactMismatch"));
});

test("malformed imported word times retain raw evidence without a trusted normalized result", async (t) => {
  const f = await fixture(t);
  const raw = JSON.stringify({ monologues: [{ speaker: 0, elements: [{ type: "text", value: "missing times" }] }] });
  await writeFile(f.exportPath, raw);
  await assert.rejects(Effect.runPromise(importRevDemoTranscript({ configPath: f.configPath, transcriptPath: f.exportPath, jobId: "bad-times" })), hasCode("InvalidTimestamps"));
  assert.equal(await readFile(join(f.artifactDirectory, "transcript.raw.json"), "utf8"), raw);
  assert.ok(!(await readdir(f.artifactDirectory)).includes("transcript.json"));
});

test("API uploads multipart with explicit machine/en and resumes a saved job without a second POST", async (t) => {
  const f = await fixture(t);
  await writeFile(f.configPath, JSON.stringify({ ...f.config, pollTimeoutMs: 1 }));
  let posts = 0;
  let metadata = "";
  let complete = false;
  const fetch: RevFetch = async (url, init) => {
    assert.equal((init.headers as Record<string, string>)["Authorization"], "Bearer offline-test-token-never-log");
    assert.equal(init.redirect, "error");
    if (init.method === "POST") {
      posts++;
      assert.ok(init.body instanceof FormData);
      const options = JSON.parse(String(init.body.get("options"))) as Record<string, unknown>;
      assert.equal(options["transcriber"], "machine");
      assert.equal(options["language"], "en");
      assert.ok(init.body.get("media") instanceof Blob);
      metadata = String(options["metadata"]);
      return json({ id: "saved-job", status: "in_progress", metadata });
    }
    if (url.endsWith("/transcript")) {
      assert.equal((init.headers as Record<string, string>)["Accept"], "application/vnd.rev.transcript.v1.0+json");
      return json(transcript);
    }
    assert.equal(JSON.parse(await readFile(join(f.artifactDirectory, "job.json"), "utf8"))["id"], "saved-job", "job ID must be on disk before first poll");
    return json({ id: "saved-job", status: complete ? "transcribed" : "in_progress", metadata, duration_seconds: 120 });
  };
  await assert.rejects(Effect.runPromise(runRevDemo({ configPath: f.configPath, token }, fetch)), hasCode("PollTimedOut"));
  complete = true;
  await writeFile(f.configPath, JSON.stringify(f.config));
  const result = await Effect.runPromise(runRevDemo({ configPath: f.configPath, token }, fetch));
  assert.equal(result.jobId, "saved-job");
  assert.equal(result.durationDifferenceSeconds, 0);
  assert.equal(posts, 1);
  const cached = await Effect.runPromise(runRevDemo({ configPath: f.configPath, token }, async () => { throw new Error("cached result must not call HTTP"); }));
  assert.equal(cached.wordCount, 2);
  const artifacts = await Promise.all((await readdir(f.artifactDirectory)).map((file) => readFile(join(f.artifactDirectory, file), "utf8")));
  assert.ok(artifacts.every((text) => !text.includes("offline-test-token-never-log")));
});

test("failed Rev jobs remain failed without another paid submission", async (t) => {
  const f = await fixture(t);
  let posts = 0;
  let metadata = "";
  const fetch: RevFetch = async (_url, init) => {
    if (init.method === "POST") {
      posts++;
      metadata = (JSON.parse(String((init.body as FormData).get("options"))) as { metadata: string }).metadata;
      return json({ id: "failed-job", status: "in_progress", metadata });
    }
    return json({ id: "failed-job", status: "failed", metadata, failure: "internal_error", failure_detail: "Synthetic failure" });
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(Effect.runPromise(runRevDemo({ configPath: f.configPath, token }, fetch)), hasCode("JobFailed"));
  }
  assert.equal(posts, 1);
  assert.match(await readFile(join(f.artifactDirectory, "job-status.raw.json"), "utf8"), /internal_error/);
});

test("API evidence survives missing submission state without causing another paid job", async (t) => {
  const f = await fixture(t);
  let metadata = "";
  let posts = 0;
  const fetch: RevFetch = async (url, init) => {
    if (init.method === "POST") {
      posts++;
      metadata = (JSON.parse(String((init.body as FormData).get("options"))) as { metadata: string }).metadata;
    }
    return url.endsWith("/transcript") ? json(transcript) : json({ id: "completed-job", status: "transcribed", metadata, duration_seconds: 120 });
  };
  await Effect.runPromise(runRevDemo({ configPath: f.configPath, token }, fetch));
  assert.equal(posts, 1);
  await rm(join(f.artifactDirectory, "submission.json"));
  await rm(join(f.artifactDirectory, "job.json"));
  const before = await readdir(f.artifactDirectory);
  assert.ok(before.includes("evidence.json") && before.includes("transcript.raw.json"));
  const rawBefore = await readFile(join(f.artifactDirectory, "transcript.raw.json"), "utf8");
  let retryCalls = 0;
  await assert.rejects(Effect.runPromise(runRevDemo({ configPath: f.configPath, token }, async (url, init) => {
    retryCalls++;
    return fetch(url, init);
  })), hasCode("SubmissionUncertain"));
  assert.equal(retryCalls, 0, "orphaned evidence must not cause any provider request");
  assert.equal(posts, 1, "the original paid job must be the only POST");
  assert.deepEqual(await readdir(f.artifactDirectory), before, "no replacement submission state is created");
  assert.equal(await readFile(join(f.artifactDirectory, "transcript.raw.json"), "utf8"), rawBefore);
});

test("partial or malformed artifacts block a fresh API submission before parsing remnants", async (t) => {
  for (const name of [
    "evidence.json", "transcript.raw.json", "transcript.json", "transcript.txt",
    "job-status.raw.json", "submission-uncertain.json", "job.json.interrupted.tmp",
  ]) {
    await t.test(name, async (t) => {
      const f = await fixture(t);
      await mkdir(f.artifactDirectory);
      await writeFile(join(f.artifactDirectory, name), "{partial");
      let calls = 0;
      await assert.rejects(Effect.runPromise(runRevDemo({ configPath: f.configPath, token }, async () => {
        calls++;
        throw new Error("orphaned artifacts must not reach Rev");
      })), (error: unknown) => {
        assert.ok(error instanceof TranscriptionError);
        assert.equal(error.code, "SubmissionUncertain");
        assert.match(error.message, /Reconcile/);
        return true;
      });
      assert.equal(calls, 0);
      assert.deepEqual(await readdir(f.artifactDirectory), [name]);
      assert.equal(await readFile(join(f.artifactDirectory, name), "utf8"), "{partial");
    });
  }
});

test("ambiguous submission never auto-retries and can recover an ID after verifying metadata", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const broken: RevFetch = async () => { calls++; throw new Error("transport failure contains offline-test-token-never-log"); };
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(Effect.runPromise(runRevDemo({ configPath: f.configPath, token }, broken)), (error: unknown) => {
      assert.ok(error instanceof TranscriptionError);
      assert.equal(error.code, "SubmissionUncertain");
      assert.ok(!error.message.includes("offline-test-token-never-log"));
      return true;
    });
  }
  assert.equal(calls, 1);
  const reservation = JSON.parse(await readFile(join(f.artifactDirectory, "submission.json"), "utf8")) as { metadata: string };
  const recovered: RevFetch = async (url, init) => {
    assert.equal(init.method, "GET");
    return url.endsWith("/transcript") ? json(transcript) : json({ id: "recovered-job", status: "transcribed", metadata: reservation.metadata, duration_seconds: 120 });
  };
  const result = await Effect.runPromise(runRevDemo({ configPath: f.configPath, token, resumeJobId: "recovered-job" }, recovered));
  assert.equal(result.jobId, "recovered-job");
});

test("input hash mismatch and a whole-book duration fail before any HTTP call", async (t) => {
  const f = await fixture(t);
  const never: RevFetch = async () => { assert.fail("invalid input must not reach the provider"); };
  await writeFile(join(f.directory, "input.flac"), "changed");
  await assert.rejects(Effect.runPromise(runRevDemo({ configPath: f.configPath, token }, never)), hasCode("InputMismatch"));
  await writeFile(join(f.directory, "provenance.json"), JSON.stringify({ transcriptionInput: { ...input, durationSeconds: 40_928.885 } }));
  await assert.rejects(Effect.runPromise(runRevDemo({ configPath: f.configPath, token }, never)), hasCode("DemoLimitExceeded"));
});
