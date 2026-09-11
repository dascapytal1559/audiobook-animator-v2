import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Exit } from "effect";
import { inspectSourceMedia, SourceMediaError, type SourceMediaRequest } from "./index.js";

const sourceBytes = Buffer.from("Synthetic source bytes, not book content.");
const fakeDocument = { streams: [{ index: 0, codec_type: "audio", codec_name: "pcm_s16le", sample_rate: "8000", channels: 1, duration: "1.000000" }] };
const successScript = `process.stdout.write(JSON.stringify(${JSON.stringify(fakeDocument)}));`;
const hasCode = (code: string) => (error: unknown) => error instanceof SourceMediaError && error.code === code;
const posixOnly = { skip: process.platform === "win32" ? "Executable test fixture uses a POSIX shebang." : false };

async function fixture(t: TestContext, body: string): Promise<{ request: SourceMediaRequest; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "animator-source-media-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, "input $(touch must-not-exist); 'quoted'.mp3");
  const ffprobePath = join(directory, "fake-ffprobe");
  await writeFile(sourcePath, sourceBytes);
  await writeFile(ffprobePath, `#!/usr/bin/env node\n${body}\n`);
  await chmod(ffprobePath, 0o700);
  return { directory, request: {
    sourcePath, ffprobePath, probeTimeoutMs: 5_000,
    maxProbeOutputBytes: 64 * 1024, maxProbeErrorBytes: 8 * 1024,
    hashChunkBytes: 16, cueChapterToleranceSeconds: 0.02,
  } };
}

const run = (request: SourceMediaRequest) => Effect.runPromise(inspectSourceMedia(request).pipe(Effect.provide(NodeServices.layer)));

test("inspection hashes a source, passes its path as one literal argument, and preserves metadata", posixOnly, async (t) => {
  const { request } = await fixture(t, `const doc = ${JSON.stringify(fakeDocument)}; doc.format = { argv: process.argv.slice(2) }; process.stdout.write(JSON.stringify(doc));`);
  const result = await run(request);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.source.requestedPath, request.sourcePath);
  assert.equal(result.source.sha256, createHash("sha256").update(sourceBytes).digest("hex"));
  assert.equal(result.source.stat.byteLength, String(sourceBytes.length));
  assert.equal(result.probe.arguments.at(-1), result.source.realPath);
  assert.deepEqual(result.format["argv"], result.probe.arguments);
  assert.ok(result.probe.arguments.includes("-protocol_whitelist"));
  assert.equal(result.audio.index, 0);
  assert.deepEqual(await readFile(request.sourcePath), sourceBytes);
});

test("missing input, directory input, missing ffprobe, and invalid operational limits are typed failures", posixOnly, async (t) => {
  const { request, directory } = await fixture(t, successScript);
  await assert.rejects(run({ ...request, sourcePath: join(directory, "absent.mp3") }), hasCode("SourceNotFound"));
  await assert.rejects(run({ ...request, sourcePath: directory }), hasCode("NotRegularFile"));
  await assert.rejects(run({ ...request, ffprobePath: join(directory, "absent-ffprobe") }), hasCode("ProbeUnavailable"));
  await assert.rejects(run({ ...request, probeTimeoutMs: 0 }), hasCode("InvalidRequest"));
  await assert.rejects(run({ ...request, sourcePath: "bad\0path" }), hasCode("InvalidRequest"));
});

test("process failure preserves bounded stderr and malformed success output is rejected", posixOnly, async (t) => {
  const first = await fixture(t, 'process.stderr.write("synthetic probe failure"); process.exitCode = 7;');
  await assert.rejects(run(first.request), (error: unknown) => {
    assert.ok(error instanceof SourceMediaError);
    assert.equal(error.code, "ProbeFailed");
    assert.equal(error.details?.["exitCode"], 7);
    assert.equal(error.details?.["stderr"], "synthetic probe failure");
    return true;
  });
  const second = await fixture(t, 'process.stdout.write("not json");');
  await assert.rejects(run(second.request), hasCode("MalformedProbe"));
});

test("stdout and stderr limits fail the process instead of accumulating unbounded output", posixOnly, async (t) => {
  for (const channel of ["stdout", "stderr"] as const) {
    const { request } = await fixture(t, `process.${channel}.write("x".repeat(4096)); setInterval(() => {}, 1000);`);
    await assert.rejects(run({ ...request, maxProbeOutputBytes: 1024, maxProbeErrorBytes: 1024 }), hasCode("ProbeOutputLimit"));
  }
});

test("a probe timeout terminates its scoped child process", posixOnly, async (t) => {
  const { request } = await fixture(t, "setInterval(() => {}, 1000);");
  await assert.rejects(run({ ...request, probeTimeoutMs: 150 }), hasCode("ProbeTimedOut"));
});

test("cancelling inspection reaps a child even when it ignores SIGTERM", posixOnly, async (t) => {
  const { request, directory } = await fixture(t, "");
  const pidFile = join(directory, "child.pid");
  await writeFile(request.ffprobePath, `#!/usr/bin/env node\nconst fs = require("node:fs"); process.on("SIGTERM", () => {}); fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);\n`);
  const controller = new AbortController();
  const running = Effect.runPromiseExit(inspectSourceMedia(request).pipe(Effect.provide(NodeServices.layer)), { signal: controller.signal });
  t.after(() => controller.abort());
  let pid: number | undefined;
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && pid === undefined) {
    try { pid = Number(await readFile(pidFile, "utf8")); } catch { await delay(10); }
  }
  assert.ok(pid !== undefined, "fake ffprobe did not start");
  controller.abort();
  const exit = await running;
  assert.ok(Exit.isFailure(exit));
  assert.throws(() => process.kill(pid, 0), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH");
});

test("a source changed while probing cannot receive a successful content identity", posixOnly, async (t) => {
  const { request } = await fixture(t, `require("node:fs").appendFileSync(process.argv.at(-1), "modified"); ${successScript}`);
  await assert.rejects(run(request), hasCode("SourceChanged"));
});
