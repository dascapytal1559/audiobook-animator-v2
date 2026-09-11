import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { SourceMediaInspection } from "../intake/source-media/index.js";

test("inspect CLI emits only machine JSON and keeps failed invocations on stderr", async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "animator-inspect-cli-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configDirectory = join(directory, "configuration");
  await mkdir(configDirectory);
  const source = Buffer.from("source content for the inspection CLI integration");
  await writeFile(join(directory, "source audio.mp3"), source);
  const probeOutput = {
    streams: [{ index: 0, codec_type: "audio", codec_name: "mp3", sample_rate: "44100", channels: 1, duration: "2" }],
    format: { duration: "2", size: String(source.length), tags: {} },
    chapters: [],
  };
  await writeFile(join(configDirectory, "probe tool"),
    `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify(probeOutput))});\n`,
    { mode: 0o755 },
  );
  const checkedInConfig = JSON.parse(await readFile(new URL("../../config/source-media.json", import.meta.url), "utf8")) as Record<string, unknown>;
  await writeFile(join(configDirectory, "source.json"), JSON.stringify({ ...checkedInConfig, ffprobePath: "./probe tool" }));
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, "inspect", ...args], {
    cwd: directory,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  const success = run("--source", "source audio.mp3", "--config", "configuration/source.json");
  assert.equal(success.error, undefined);
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stderr, "");
  const inspection = JSON.parse(success.stdout) as SourceMediaInspection;
  assert.equal(inspection.source.absolutePath, join(directory, "source audio.mp3"));
  assert.equal(inspection.source.sha256, createHash("sha256").update(source).digest("hex"));
  assert.equal(inspection.probe.executable, join(configDirectory, "probe tool"));
  assert.equal(inspection.chapterCueComparison.basis, "ordinal-diagnostic-only");

  await writeFile(join(configDirectory, "invalid.json"), JSON.stringify({ ...checkedInConfig, probeTimeoutMs: 0, unexpectedOption: true }));
  const invalidInvocations = [
    { args: ["--source", "source audio.mp3"], message: /config/ },
    { args: ["--config", "configuration/source.json"], message: /source/ },
    { args: ["--source", "source audio.mp3", "--config", "configuration/invalid.json"], message: /Invalid source inspection config/ },
    { args: ["--source", "missing.mp3", "--config", "configuration/source.json"], message: /SourceNotFound/ },
  ];
  for (const invocation of invalidInvocations) {
    const failure = run(...invocation.args);
    assert.equal(failure.error, undefined);
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, "");
    assert.match(failure.stderr, invocation.message);
  }
});
