import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { Effect, Layer, Stream } from "effect";
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http";
import { fixture } from "../story-planning/context.fixture.js";
import { loadEditorContext, makeEditorRoutes } from "./index.js";
const encode = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
/** A 1x1 transparent PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const VALID_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

/** The synthetic verified story (10 Hz, 100 samples, 12-byte "audio") behind an ephemeral loopback server with a fetch client pointed at it. */
async function serve(t: TestContext, options: { readonly staticDirectory?: string } = {}) {
  const story = await fixture(t);
  const planningDirectory = join(story.dir, "planning");
  await mkdir(join(planningDirectory, "shots"), { recursive: true });
  await writeFile(join(story.dir, "visual-timeline.json"), encode({ schemaVersion: 1, storyPlanningConfigPath: "config.json", planningDirectory: "planning", limits: { maxRecordBytes: 65536, maxDecisionsBytes: 65536, maxRecords: 100, maxImageBytes: 1024 } }));
  const configPath = join(story.dir, "editor-server.json");
  await writeFile(configPath, encode({ schemaVersion: 1, visualTimelineConfigPath: "visual-timeline.json", ffmpegPath: "ffmpeg", peaks: { samplesPerBucket: 16, maxCacheBytes: 65536 }, watch: { debounceMs: 50 }, limits: { maxUploadBytes: 8192, requestTimeoutMs: 5000 } }));
  const ctx = await Effect.runPromise(loadEditorContext({ configPath }).pipe(Effect.provide(NodeServices.layer)));
  const layer = HttpRouter.serve(makeEditorRoutes(ctx, { producer: { name: "editor", version: "test" }, ...options }), { disableLogger: true, disableListenLog: true })
    .pipe(Layer.provideMerge(NodeHttpServer.layerTest), Layer.provideMerge(NodeServices.layer));
  const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof layer>>) => Effect.runPromise(effect.pipe(Effect.provide(layer)));
  const clip = ctx.clip;
  return { story, ctx, clip, planningDirectory, run };
}
const get = (url: string, headers: Record<string, string> = {}) => HttpClient.get(url, { headers });
const bodyText = (r: { text: Effect.Effect<string, unknown> }) => r.text.pipe(Effect.orDie);
const bodyJson = (r: { json: Effect.Effect<unknown, unknown> }) => r.json.pipe(Effect.orDie, Effect.map(v => v as Record<string, any>));
const bodyBytes = (r: { arrayBuffer: Effect.Effect<ArrayBuffer, unknown> }) => r.arrayBuffer.pipe(Effect.orDie, Effect.map(b => Buffer.from(b)));
function shotForm(fields: Record<string, string>, image?: { name: string; bytes: Buffer }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (image) form.append("image", new Blob([new Uint8Array(image.bytes)], { type: "application/octet-stream" }), image.name);
  return HttpClientRequest.post("/api/shots").pipe(HttpClientRequest.bodyFormData(form));
}

test("/api/story carries the verified clip, titles, the book-clock start, and words converted to clip samples", async t => {
  const s = await serve(t);
  const { status, body } = await s.run(Effect.gen(function* () { const r = yield* get("/api/story"); return { status: r.status, body: yield* bodyJson(r) }; }));
  assert.equal(status, 200);
  assert.deepEqual(body, { clip: s.clip, story: { title: "Pilot", bookTitle: "Book" }, sourceStartSample: 100, words: [{ id: "m2:e0", value: "Uncorrected", startSample: 13, endSample: 23 }] });
  assert.deepEqual([s.clip.bookId, s.clip.storyId, s.clip.sampleRateHz, s.clip.sampleCount], ["book", "pilot", 10, 100]);
});

test("a multipart shot is created with its image, the timeline round-trips through PUT /api/decisions, and bad inputs get honest statuses", async t => {
  const s = await serve(t);
  await s.run(Effect.gen(function* () {
    const empty = yield* bodyJson(yield* get("/api/timeline"));
    assert.deepEqual([empty["records"], empty["stitched"]], [[], [{ kind: "gap", startSample: 0, endSample: 100 }]]);
    const created = yield* HttpClient.execute(shotForm({ startSeconds: "2.36", mode: "graphic-illustration", label: "Opening", prompt: "A parrot" }, { name: "tiny.PNG", bytes: PNG }));
    assert.equal(created.status, 201);
    const record = yield* bodyJson(created);
    assert.equal(record["startSample"], 24);
    assert.equal(record["imagePath"], "image.png");
    assert.equal(record["imageUrl"], `/api/shots/${record["id"]}/image`);
    assert.deepEqual(record["producer"], { name: "editor", version: "test" });
    assert.deepEqual(record["clip"], s.clip);
    const image = yield* get(record["imageUrl"] as string);
    assert.equal(image.status, 200);
    assert.equal(image.headers["content-type"], "image/png");
    assert.deepEqual(yield* bodyBytes(image), PNG);
    const imageless = yield* HttpClient.execute(shotForm({ startSample: "40", mode: "poetic-abstraction" }));
    assert.equal(imageless.status, 201);
    const second = yield* bodyJson(imageless);
    assert.equal(second["imageUrl"], undefined);
    assert.equal((yield* get(`/api/shots/${second["id"]}/image`)).status, 404, "a record without an image is 404");
    const timeline = yield* bodyJson(yield* get("/api/timeline"));
    assert.deepEqual((timeline["records"] as Array<Record<string, unknown>>).map(r => [r["id"], r["imageUrl"] ?? null]), [[record["id"], record["imageUrl"]], [second["id"], null]]);
    assert.deepEqual((timeline["stitched"] as Array<Record<string, unknown>>).map(e => [e["kind"], e["startSample"], e["endSample"]]), [["gap", 0, 24], ["shot", 24, 40], ["shot", 40, 100]]);
    const put = (body: unknown, headers: Record<string, string> = {}) => HttpClient.execute(HttpClientRequest.put("/api/decisions", { headers }).pipe(HttpClientRequest.bodyJsonUnsafe(body)));
    const updated = yield* put({ settings: { frameAspect: { width: 4, height: 3 } }, shots: { [record["id"] as string]: { startSample: 0, selected: true }, [second["id"] as string]: { hidden: true } } });
    assert.equal(updated.status, 200);
    const after = yield* bodyJson(updated);
    assert.deepEqual((after["decisions"] as Record<string, any>)["settings"], { frameAspect: { width: 4, height: 3 } });
    assert.deepEqual((after["stitched"] as Array<Record<string, unknown>>).map(e => [e["kind"], e["startSample"], e["endSample"]]), [["shot", 0, 100]]);
    const onDisk = JSON.parse(yield* Effect.promise(() => readFile(join(s.planningDirectory, "decisions.json"), "utf8"))) as Record<string, unknown>;
    assert.deepEqual(onDisk["shots"], { [record["id"] as string]: { startSample: 0, selected: true }, [second["id"] as string]: { hidden: true } });
    assert.deepEqual(yield* bodyJson(yield* get("/api/timeline")), after, "GET after PUT returns the same payload");
    const unknownShot = yield* put({ settings: { frameAspect: { width: 16, height: 9 } }, shots: { [VALID_ULID]: {} } });
    assert.equal(unknownShot.status, 400);
    assert.equal((yield* bodyJson(unknownShot))["code"], "InvalidDecisions");
    assert.equal((yield* put([1, 2])).status, 400);
    const notJson = yield* HttpClient.execute(HttpClientRequest.put("/api/decisions").pipe(HttpClientRequest.bodyText("{nope", "application/json")));
    assert.equal(notJson.status, 400);
    const oversized = yield* HttpClient.execute(HttpClientRequest.put("/api/decisions").pipe(HttpClientRequest.bodyText(`{"settings":{},"shots":{},"pad":"${"x".repeat(70_000)}"}`, "application/json")));
    assert.equal(oversized.status, 413);
    assert.deepEqual(JSON.parse(yield* Effect.promise(() => readFile(join(s.planningDirectory, "decisions.json"), "utf8"))), onDisk, "rejected writes never touch the file");
    for (const [form, status, pattern] of [
      [shotForm({ startSample: "0", mode: "watercolour" }), 400, /mode must be one of/],
      [shotForm({ startSample: "100", mode: "graphic-illustration" }), 400, /outside the clip/],
      [shotForm({ startSample: "x", mode: "graphic-illustration" }), 400, /finite number/],
      [shotForm({ mode: "graphic-illustration" }), 400, /exactly one of/],
      [shotForm({ startSample: "0", mode: "graphic-illustration" }, { name: "anim.gif", bytes: PNG }), 400, /\.png, \.jpg, \.jpeg, or \.webp/],
      [shotForm({ startSample: "0", mode: "graphic-illustration" }, { name: "big.png", bytes: Buffer.alloc(2048) }), 413, /PayloadTooLarge|Upload/],
    ] as const) {
      const response = yield* HttpClient.execute(form);
      const body = yield* bodyJson(response);
      assert.equal(response.status, status, JSON.stringify(body));
      assert.match(String(body["message"]) + String(body["code"]), pattern);
    }
    assert.equal((yield* bodyJson(yield* get("/api/timeline")))["records"].length, 2, "rejected uploads leave no record behind");
  }));
});

test("image route: a malformed id, an unknown ULID, and a record whose image has an unsupported extension are all 404 without touching other files", async t => {
  const s = await serve(t);
  const directory = join(s.planningDirectory, "shots", VALID_ULID);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "image.gif"), PNG);
  await writeFile(join(directory, "record.json"), encode({ schemaVersion: 1, kind: "visual-shot-generation", id: VALID_ULID, clip: s.clip, startSample: 0, mode: "graphic-illustration", imagePath: "image.gif", createdAt: "2026-09-08T00:00:00.000Z", producer: { name: "test", version: "0" } }));
  await s.run(Effect.gen(function* () {
    // fetch normalizes a literal `..`, so the traversal attempt is percent-encoded to reach the route as a path parameter.
    for (const path of ["/api/shots/not-a-ulid/image", "/api/shots/%2E%2E/image", "/api/shots/01ARZ3NDEKTSV4RRFFQ69G5FAA/image", `/api/shots/${VALID_ULID}/image`, "/api/shots//image", "/api/nope"]) {
      const response = yield* get(path);
      assert.equal(response.status, 404, path);
      assert.equal((yield* bodyJson(response))["code"], "NotFound", path);
    }
  }));
});

test("audio: single byte ranges, suffix ranges, 416 with the size, HEAD metadata, ignored multi-range, and 405 for other methods", async t => {
  const s = await serve(t);
  const bytes = Buffer.from("opaque audio");
  await s.run(Effect.gen(function* () {
    const head = yield* HttpClient.head("/api/audio");
    assert.equal(head.status, 200);
    assert.equal(head.headers["accept-ranges"], "bytes");
    assert.equal(head.headers["content-length"], "12");
    assert.equal(head.headers["content-type"], "audio/flac");
    assert.equal(yield* bodyText(head), "");
    const headRange = yield* HttpClient.head("/api/audio", { headers: { range: "bytes=0-4" } });
    assert.equal(headRange.status, 200, "Range applies only to GET");
    assert.equal(headRange.headers["content-range"], undefined);
    const partial = yield* get("/api/audio", { range: "bytes=0-4" });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers["content-range"], "bytes 0-4/12");
    assert.equal(partial.headers["content-length"], "5");
    assert.deepEqual(yield* bodyBytes(partial), bytes.subarray(0, 5));
    for (const range of ["bytes=-3", "bytes=9-", "bytes=9-99"]) {
      const suffix = yield* get("/api/audio", { range });
      assert.equal(suffix.status, 206, range);
      assert.equal(suffix.headers["content-range"], "bytes 9-11/12");
      assert.deepEqual(yield* bodyBytes(suffix), bytes.subarray(9));
    }
    for (const range of ["bytes=12-", "bytes=-0", "bytes=99-100"]) {
      const invalid = yield* get("/api/audio", { range });
      assert.equal(invalid.status, 416, range);
      assert.equal(invalid.headers["content-range"], "bytes */12");
      assert.equal(yield* bodyText(invalid), "");
    }
    for (const range of ["bytes=0-1,4-5", "bytes=10-9", "items=0-1"]) {
      const ignored = yield* get("/api/audio", { range });
      assert.equal(ignored.status, 200, range);
      assert.deepEqual(yield* bodyBytes(ignored), bytes);
    }
    const full = yield* get("/api/audio");
    assert.equal(full.status, 200);
    assert.equal(full.headers["content-length"], "12");
    assert.deepEqual(yield* bodyBytes(full), bytes);
    const ifRange = yield* get("/api/audio", { range: "bytes=0-4", "if-range": '"stale"' });
    assert.equal(ifRange.status, 200, "an If-Range condition this server cannot evaluate yields the whole file");
    assert.equal((yield* HttpClient.execute(HttpClientRequest.post("/api/audio"))).status, 405);
  }));
});

test("/api/events sends ready on connect and pushes timeline-changed after a file lands in the planning directory", async t => {
  const s = await serve(t);
  const seen = await s.run(get("/api/events").pipe(Effect.flatMap(response => {
    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"] ?? "", /^text\/event-stream/);
    let written = false;
    return response.stream.pipe(Stream.decodeText(), Stream.scan("", (acc, chunk) => acc + chunk),
      Stream.tap(acc => acc.includes("event: ready") && !written ? Effect.promise(async () => { written = true; await mkdir(join(s.planningDirectory, "shots", VALID_ULID), { recursive: true }); await writeFile(join(s.planningDirectory, "shots", VALID_ULID, "record.json"), "{}"); }) : Effect.void),
      Stream.takeUntil(acc => acc.includes("event: timeline-changed")), Stream.runLast, Effect.map(o => o._tag === "Some" ? o.value : ""));
  }), Effect.timeout("10 seconds")));
  const ready = /event: ready\ndata: (\{"at":"[^"]+"\})\n\n/.exec(seen);
  assert.ok(ready, seen);
  assert.ok(!Number.isNaN(Date.parse((JSON.parse(ready[1]!) as { at: string }).at)));
  assert.ok(seen.indexOf("event: ready") < seen.indexOf("event: timeline-changed"), seen);
  assert.match(seen, /event: timeline-changed\ndata: \{"at":"[^"]+"\}\n\n/);
});

test("/api/peaks serves a cache pinned to the clip and recomputes when the pin differs, surfacing a decode failure as 500 PeaksFailed", async t => {
  const s = await serve(t);
  const peaks = { schemaVersion: 1, audioSha256: s.clip.audioSha256, sampleRateHz: 10, sampleCount: 100, samplesPerBucket: 16, min: [-7, -6, -5, -4, -3, -2, -1], max: [7, 6, 5, 4, 3, 2, 1] };
  await writeFile(join(s.planningDirectory, "peaks.json"), JSON.stringify(peaks));
  await s.run(Effect.gen(function* () {
    const hit = yield* get("/api/peaks");
    assert.equal(hit.status, 200);
    assert.deepEqual(yield* bodyJson(hit), peaks);
  }));
  const stale = await serve(t);
  await writeFile(join(stale.planningDirectory, "peaks.json"), JSON.stringify({ ...peaks, audioSha256: "b".repeat(64) }));
  await stale.run(Effect.gen(function* () {
    // The fixture's "audio" is 12 opaque bytes, so a recompute (with or without ffmpeg installed) must fail loudly rather than serve the stale cache.
    const miss = yield* get("/api/peaks");
    assert.equal(miss.status, 500);
    const body = yield* bodyJson(miss);
    assert.equal(body["code"], "PeaksFailed");
    assert.deepEqual(JSON.parse(yield* Effect.promise(() => readFile(join(stale.planningDirectory, "peaks.json"), "utf8"))), { ...peaks, audioSha256: "b".repeat(64) }, "a failed recompute leaves the old file untouched");
  }));
});

test("static mode serves the client with index.html fallback while unknown API paths stay JSON 404; without it the root is a text pointer", async t => {
  const plain = await serve(t);
  await plain.run(Effect.gen(function* () {
    const root = yield* get("/");
    assert.equal(root.status, 200);
    assert.match(yield* bodyText(root), /editor server for book\/pilot/);
  }));
  const client = await mkdtemp(join(tmpdir(), "editor-client-"));
  t.after(() => rm(client, { recursive: true, force: true }));
  await mkdir(join(client, "assets"), { recursive: true });
  await writeFile(join(client, "index.html"), "<!doctype html><title>Editor client</title>");
  await writeFile(join(client, "assets", "app.js"), "console.log('app')");
  const t2 = await serve(t, { staticDirectory: client });
  await t2.run(Effect.gen(function* () {
    // The SPA fallback answers only navigations: requests that accept HTML and name a path without an extension.
    for (const path of ["/", "/index.html", "/shots/01ARZ3NDEKTSV4RRFFQ69G5FAV", "/deep/route"]) {
      const response = yield* get(path, { accept: "text/html,*/*;q=0.8" });
      assert.equal(response.status, 200, path);
      assert.match(yield* bodyText(response), /Editor client/, path);
    }
    const asset = yield* get("/assets/app.js");
    assert.equal(asset.status, 200);
    assert.match(asset.headers["content-type"] ?? "", /javascript/);
    assert.equal((yield* get("/deep/route")).status, 404, "a non-HTML request for an unknown path is not an SPA navigation");
    assert.equal((yield* get("/missing.js", { accept: "text/html" })).status, 404, "a missing asset with an extension is not an SPA navigation");
    const api = yield* get("/api/missing", { accept: "text/html" });
    assert.equal(api.status, 404);
    assert.equal((yield* bodyJson(api))["code"], "NotFound");
    assert.equal((yield* get("/api/story")).status, 200);
  }));
});
