import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startDemoServer, stopDemoServer } from "./demo-serve.js";

test("loopback server returns exact partial bytes, HEAD metadata, and honest range errors", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "animator-demo-serve-"));
  const bytes = Buffer.from(Array.from({ length: 300 }, (_, index) => index % 256));
  await writeFile(join(directory, "demo.html"), "<!doctype html><title>Synthetic server test</title>");
  await writeFile(join(directory, "input.flac"), bytes);
  const { server, url } = await startDemoServer({ directory, port: 0 });
  t.after(async () => { await stopDemoServer(server); await rm(directory, { recursive: true, force: true }); });
  const audioUrl = new URL("input.flac", url);

  const head = await fetch(audioUrl, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("accept-ranges"), "bytes");
  assert.equal(head.headers.get("content-length"), "300");
  assert.equal(head.headers.get("content-type"), "audio/flac");
  assert.equal(await head.text(), "");

  const partial = await fetch(audioUrl, { headers: { Range: "bytes=0-99" } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), "bytes 0-99/300");
  assert.equal(partial.headers.get("content-length"), "100");
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(0, 100));

  for (const range of ["bytes=-5", "bytes=295-", "bytes=295-999999999999999999999999999"]) {
    const suffix = await fetch(audioUrl, { headers: { Range: range } });
    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers.get("content-range"), "bytes 295-299/300");
    assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(295));
  }
  for (const range of ["bytes=300-", "bytes=10-9", "bytes=-0", "bytes=", "bytes=0-1,4-5", "bytes=999999999999999999999999999-"]) {
    const invalid = await fetch(audioUrl, { headers: { Range: range } });
    assert.equal(invalid.status, 416, range);
    assert.equal(invalid.headers.get("content-range"), "bytes */300");
    assert.equal(await invalid.text(), "");
  }
  const full = await fetch(audioUrl);
  assert.equal(full.status, 200);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
  const headRange = await fetch(audioUrl, { method: "HEAD", headers: { Range: "bytes=0-99" } });
  assert.equal(headRange.status, 200, "Range applies only to GET under RFC 9110");
  assert.equal(headRange.headers.get("content-range"), null);
  assert.equal(await headRange.text(), "");
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Synthetic server test/);
  assert.equal((await fetch(new URL("input-provenance.json", url))).status, 404);
  assert.equal((await fetch(new URL("../../package.json", url))).status, 404);
  assert.equal((await fetch(audioUrl, { method: "POST" })).status, 405);
});
