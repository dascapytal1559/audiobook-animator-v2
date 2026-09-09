import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { Effect, Layer, Stream } from "effect";
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http";
import { fixture, type FixtureWord } from "../story-planning/context.fixture.js";
import { loadEditorLibrary, makeEditorRoutes } from "./index.js";
const encode = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
/** A 1x1 transparent PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const VALID_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

/** The synthetic verified story (10 Hz, 100 samples, 12-byte "audio"), the only story under the fixture root, behind an ephemeral loopback server with a fetch client pointed at it. */
async function serve(t: TestContext, options: { readonly staticDirectory?: string; readonly words?: ReadonlyArray<FixtureWord> } = {}) {
  const story = await fixture(t, options.words ? { words: options.words } : {});
  const planningDirectory = story.dir;
  await mkdir(join(planningDirectory, "shots"), { recursive: true });
  await mkdir(join(planningDirectory, "cache"), { recursive: true });
  await writeFile(join(story.root, "visual-timeline.json"), encode({ schemaVersion: 1, storyPlanningConfigPath: "config.json", limits: { maxRecordBytes: 65536, maxDecisionsBytes: 65536, maxRecords: 100, maxImageBytes: 1024 } }));
  const configPath = join(story.root, "editor-server.json");
  // At 10 Hz a 100 ms frame is one sample; the lead is 2 samples.
  await writeFile(configPath, encode({ schemaVersion: 1, storiesDirectory: ".", visualTimelineConfigPath: "visual-timeline.json", ffmpegPath: "ffmpeg", peaks: { samplesPerBucket: 16, maxCacheBytes: 65536 },
    speech: { frameMs: 100, thresholdDbfs: -50, minSilenceMs: 200, minSpeechMs: 100 }, alignment: { leadMs: 200, boundaryPauseMs: 300 },
    watch: { debounceMs: 50 }, limits: { maxUploadBytes: 8192, requestTimeoutMs: 5000 }, chunking: { pauseBreakMs: 600, minSentenceBreakMs: 0 } }));
  const library = await Effect.runPromise(loadEditorLibrary({ configPath }).pipe(Effect.provide(NodeServices.layer)));
  const { ctx } = await Effect.runPromise(library.open("pilot").pipe(Effect.provide(NodeServices.layer)));
  const layer = HttpRouter.serve(makeEditorRoutes(library, { producer: { name: "editor", version: "test" }, ...(options.staticDirectory !== undefined ? { staticDirectory: options.staticDirectory } : {}) }), { disableLogger: true, disableListenLog: true })
    .pipe(Layer.provideMerge(NodeHttpServer.layerTest), Layer.provideMerge(NodeServices.layer));
  const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof layer>>) => Effect.runPromise(effect.pipe(Effect.provide(layer)));
  const clip = ctx.clip;
  const speechFile = (regions: ReadonlyArray<{ startSample: number; endSample: number }>, extra: Record<string, unknown> = {}) =>
    writeFile(join(planningDirectory, "cache", "speech.json"), JSON.stringify({ schemaVersion: 1, kind: "speech-regions", audioSha256: clip.audioSha256, sampleRateHz: 10, sampleCount: 100, frameSamples: 1, thresholdDbfs: -50, minSilenceMs: 200, minSpeechMs: 100, regions, ...extra }));
  return { story, library, ctx, clip, planningDirectory, run, speechFile };
}
/** Three more words on the 10 Hz clip: 30..35, 35..40, then 60..70 after a 2-second pause. */
const MORE_WORDS: ReadonlyArray<FixtureWord> = [{ value: "second", startSeconds: 3, endSeconds: 3.5, punctuation: " " }, { value: "third", startSeconds: 3.5, endSeconds: 4, punctuation: " " }, { value: "fourth", startSeconds: 6, endSeconds: 7, punctuation: "." }];
const putJson = (path: string, body: unknown) => HttpClient.execute(HttpClientRequest.put(path).pipe(HttpClientRequest.bodyJsonUnsafe(body)));
const postJson = (path: string, body: unknown) => HttpClient.execute(HttpClientRequest.post(path).pipe(HttpClientRequest.bodyJsonUnsafe(body)));
const readJson = (path: string) => Effect.promise(async () => JSON.parse(await readFile(path, "utf8")) as Record<string, any>);
const get = (url: string, headers: Record<string, string> = {}) => HttpClient.get(url, { headers });
const bodyText = (r: { text: Effect.Effect<string, unknown> }) => r.text.pipe(Effect.orDie);
const bodyJson = (r: { json: Effect.Effect<unknown, unknown> }) => r.json.pipe(Effect.orDie, Effect.map(v => v as Record<string, any>));
const bodyBytes = (r: { arrayBuffer: Effect.Effect<ArrayBuffer, unknown> }) => r.arrayBuffer.pipe(Effect.orDie, Effect.map(b => Buffer.from(b)));
function shotForm(fields: Record<string, string>, image?: { name: string; bytes: Buffer }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (image) form.append("image", new Blob([new Uint8Array(image.bytes)], { type: "application/octet-stream" }), image.name);
  return HttpClientRequest.post("/api/stories/pilot/shots").pipe(HttpClientRequest.bodyFormData(form));
}

test("/api/story carries the verified clip, titles, the book-clock start, words converted to clip samples with their original layer, chunks, and an empty timing summary", async t => {
  const s = await serve(t);
  const { status, body } = await s.run(Effect.gen(function* () { const r = yield* get("/api/stories/pilot/story"); return { status: r.status, body: yield* bodyJson(r) }; }));
  assert.equal(status, 200);
  assert.deepEqual(body, { clip: s.clip, story: { title: "Pilot", bookTitle: "Book" }, sourceStartSample: 100,
    words: [{ id: "m2:e0", value: "Uncorrected", startSample: 13, endSample: 23, original: { startSample: 13, endSample: 23 } }],
    chunks: [{ id: "c0", startSample: 13, endSample: 23, text: "Uncorrected.", wordIds: ["m2:e0"], breakReason: "end" }],
    chunking: { minSentenceBreakMs: 0, pauseBreakMs: 600, mergedSentenceBreaks: [] }, timing: { inversions: 0, autoRuns: [], manualCount: 0, autoCount: 0 } });
  assert.deepEqual([s.clip.bookId, s.clip.storyId, s.clip.sampleRateHz, s.clip.sampleCount], ["book", "pilot", 10, 100]);
});

test("/api/stories lists every story directory with its manifest summary and the configured default; unknown or missing story ids are 404 before any file is read", async t => {
  const s = await serve(t);
  await s.run(Effect.gen(function* () {
    const listing = yield* get("/api/stories");
    assert.equal(listing.status, 200);
    assert.deepEqual(yield* bodyJson(listing), { defaultStoryId: "pilot", stories: [{ id: "pilot", title: "Pilot", bookId: "book", bookTitle: "Book", wordCount: 1, sampleRateHz: 10, sampleCount: 100, durationSeconds: 10, durationDisplay: "00:00:10.000" }] });
    for (const path of ["/api/stories/other/story", "/api/stories/../story", "/api/stories//story", "/api/stories/pilot", "/api/stories/pilot/"]) {
      const response = yield* get(path);
      assert.equal(response.status, 404, path);
      assert.equal((yield* bodyJson(response))["code"], "NotFound", path);
    }
  }));
  assert.deepEqual(s.library.stories.map(story => story.id), ["pilot"]);
  assert.equal(s.library.defaultStoryId, "pilot");
});

test("/api/speech serves a cache pinned to the clip and its parameters; a stale or missing speech cache beside a valid peaks cache forces one decode, which fails loudly on the fixture's fake audio", async t => {
  const s = await serve(t);
  await s.speechFile([{ startSample: 10, endSample: 30 }, { startSample: 40, endSample: 100 }]);
  await s.run(Effect.gen(function* () {
    const hit = yield* get("/api/stories/pilot/speech");
    assert.equal(hit.status, 200);
    const body = yield* bodyJson(hit);
    assert.deepEqual([body["kind"], body["frameSamples"], body["thresholdDbfs"], body["minSilenceMs"], body["minSpeechMs"], body["regions"]], ["speech-regions", 1, -50, 200, 100, [{ startSample: 10, endSample: 30 }, { startSample: 40, endSample: 100 }]]);
  }));
  const stale = await serve(t);
  const peaks = { schemaVersion: 1, audioSha256: stale.clip.audioSha256, sampleRateHz: 10, sampleCount: 100, samplesPerBucket: 16, min: [-7, -6, -5, -4, -3, -2, -1], max: [7, 6, 5, 4, 3, 2, 1] };
  await writeFile(join(stale.planningDirectory, "cache", "peaks.json"), JSON.stringify(peaks));
  await stale.speechFile([{ startSample: 10, endSample: 30 }], { thresholdDbfs: -40 });
  await stale.run(Effect.gen(function* () {
    assert.deepEqual(yield* bodyJson(yield* get("/api/stories/pilot/peaks")), peaks, "the valid peaks cache is served without decoding");
    const miss = yield* get("/api/stories/pilot/speech");
    assert.equal(miss.status, 500);
    assert.equal((yield* bodyJson(miss))["code"], "PeaksFailed");
    assert.equal((yield* readJson(join(stale.planningDirectory, "cache", "speech.json")))["thresholdDbfs"], -40, "a failed decode leaves the old file untouched");
  }));
});

test("PUT /api/word-timing replaces the manual overlay, the story serves effective times with both layers and recomputed chunks, and bad bodies never touch the file", async t => {
  const s = await serve(t, { words: MORE_WORDS });
  const manualPath = join(s.planningDirectory, "word-timing.json");
  await s.run(Effect.gen(function* () {
    const before = yield* bodyJson(yield* get("/api/stories/pilot/story"));
    assert.deepEqual((before["chunks"] as Array<Record<string, unknown>>).map(c => [c["text"], c["breakReason"], c["startSample"], c["endSample"]]), [["Uncorrected.", "sentence", 13, 23], ["second third", "pause", 30, 40], ["fourth.", "end", 60, 70]]);
    const updated = yield* putJson("/api/stories/pilot/word-timing", { words: { "m2:e2": { startSample: 42, endSample: 45 }, "m2:e6": { startSample: 90, endSample: 100 } } });
    assert.equal(updated.status, 200);
    const story = yield* bodyJson(updated);
    assert.deepEqual(story["words"], [
      { id: "m2:e0", value: "Uncorrected", startSample: 13, endSample: 23, original: { startSample: 13, endSample: 23 } },
      { id: "m2:e2", value: "second", startSample: 42, endSample: 45, original: { startSample: 30, endSample: 35 }, manual: { startSample: 42, endSample: 45 } },
      { id: "m2:e4", value: "third", startSample: 35, endSample: 40, original: { startSample: 35, endSample: 40 } },
      { id: "m2:e6", value: "fourth", startSample: 90, endSample: 100, original: { startSample: 60, endSample: 70 }, manual: { startSample: 90, endSample: 100 } }]);
    assert.deepEqual(story["timing"], { inversions: 1, autoRuns: [], manualCount: 2, autoCount: 0 }, "second now starts after third: one inversion, reported not rejected");
    assert.deepEqual((story["chunks"] as Array<Record<string, unknown>>).map(c => [c["text"], c["breakReason"], c["startSample"], c["endSample"]]), [["Uncorrected.", "sentence", 13, 23], ["second third", "pause", 42, 40], ["fourth.", "end", 90, 100]], "chunks follow effective times");
    const onDisk = yield* readJson(manualPath);
    assert.deepEqual([onDisk["kind"], onDisk["clip"], onDisk["words"]], ["word-timing-manual", s.clip, { "m2:e2": { startSample: 42, endSample: 45 }, "m2:e6": { startSample: 90, endSample: 100 } }]);
    assert.ok(!Number.isNaN(Date.parse(onDisk["updatedAt"] as string)));
    assert.deepEqual(yield* bodyJson(yield* get("/api/stories/pilot/story")), story, "GET after PUT returns the same payload");
    for (const [body, status, pattern] of [
      [{ words: { "m9:e9": { startSample: 0, endSample: 1 } } }, 400, /not in the transcript: m9:e9/],
      [{ words: { "m2:e0": { startSample: 5, endSample: 5 } } }, 400, /startSample < endSample/],
      [{ words: { "m2:e0": { startSample: 0, endSample: 101 } } }, 400, /<= 100/],
      [{ words: { "m2:e0": { startSample: 1.5, endSample: 3 } } }, 400, /schema/],
      [{ words: { "m2:e0": { startSample: 1, endSample: 3, extra: true } } }, 400, /schema/],
      [{ nope: {} }, 400, /words/],
      [[1], 400, /object/],
    ] as const) {
      const response = yield* putJson("/api/stories/pilot/word-timing", body);
      const error = yield* bodyJson(response);
      assert.equal(response.status, status, JSON.stringify(error));
      assert.match(String(error["message"]), pattern);
    }
    const oversized = yield* HttpClient.execute(HttpClientRequest.put("/api/stories/pilot/word-timing").pipe(HttpClientRequest.bodyText(`{"words":{},"pad":"${"x".repeat(70_000)}"}`, "application/json")));
    assert.equal(oversized.status, 413);
    assert.deepEqual(yield* readJson(manualPath), onDisk, "rejected writes never touch the file");
    const cleared = yield* putJson("/api/stories/pilot/word-timing", { words: {} });
    assert.equal(cleared.status, 200);
    assert.deepEqual((yield* bodyJson(cleared))["timing"], { inversions: 0, autoRuns: [], manualCount: 0, autoCount: 0 });
  }));
});

test("POST /api/word-timing/align refuses the whole clip without wholeClip, writes the auto overlay for its range only, and the story layers manual over auto", async t => {
  const s = await serve(t, { words: MORE_WORDS });
  await s.speechFile([{ startSample: 15, endSample: 26 }, { startSample: 33, endSample: 43 }, { startSample: 62, endSample: 72 }]);
  const autoPath = join(s.planningDirectory, "word-timing.auto.json");
  await s.run(Effect.gen(function* () {
    const whole = yield* postJson("/api/stories/pilot/word-timing/align", { startSample: 0, endSample: 100 });
    assert.equal(whole.status, 400);
    assert.match(String((yield* bodyJson(whole))["message"]), /wholeClip/);
    for (const body of [{ startSample: 10, endSample: 10 }, { startSample: -1, endSample: 10 }, { startSample: 0, endSample: 101 }, { startSample: "0", endSample: 10 }, { startSample: 0, endSample: 10, wholeClip: "yes" }]) {
      assert.equal((yield* postJson("/api/stories/pilot/word-timing/align", body)).status, 400, JSON.stringify(body));
    }
    assert.ok(!(yield* Effect.promise(() => readFile(autoPath).then(() => true, () => false))), "refusals write nothing");
    const first = yield* postJson("/api/stories/pilot/word-timing/align", { startSample: 0, endSample: 50 });
    assert.equal(first.status, 200);
    const { report, story } = yield* bodyJson(first) as Effect.Effect<{ report: Record<string, any>; story: Record<string, any> }>;
    assert.deepEqual([report["wordCount"], report["regionCount"], report["leadMs"], report["range"]], [3, 2, 200, { startSample: 0, endSample: 50 }]);
    assert.deepEqual(report["before"]["onsetErrorMs"], { median: -250, p10: -290, p90: -210 }, "Uncorrected starts 200 ms before onset 15; second starts 300 ms before onset 33");
    assert.deepEqual(report["after"]["onsetErrorMs"], { median: 0, p10: 0, p90: 0 });
    assert.deepEqual([report["before"]["insideSpeechFraction"], report["after"]["insideSpeechFraction"]], [0.3333, 1], "only `third` already sits inside a region");
    // Uncorrected 13..23 shifts to 15..25 and fills 15..26; second/third shift to 32..42 and stretch onto 33..43; fourth starts outside the range.
    assert.deepEqual((story["words"] as Array<Record<string, unknown>>).map(w => [w["id"], w["startSample"], w["endSample"], w["auto"] ?? null]), [
      ["m2:e0", 15, 26, { startSample: 15, endSample: 26 }], ["m2:e2", 33, 38, { startSample: 33, endSample: 38 }], ["m2:e4", 38, 43, { startSample: 38, endSample: 43 }], ["m2:e6", 60, 70, null]]);
    assert.equal((story["timing"] as Record<string, any>)["autoCount"], 3);
    assert.deepEqual(((story["timing"] as Record<string, any>)["autoRuns"] as Array<Record<string, unknown>>).map(r => [r["startSample"], r["endSample"], r["report"]]), [[0, 50, report]]);
    const onDisk = yield* readJson(autoPath);
    assert.deepEqual([onDisk["kind"], onDisk["clip"], onDisk["producer"], onDisk["parameters"]], ["word-timing-auto", s.clip, { name: "editor", version: "test" }, { leadMs: 200, thresholdDbfs: -50, minSilenceMs: 200, minSpeechMs: 100 }]);
    assert.deepEqual(Object.keys(onDisk["words"] as object), ["m2:e0", "m2:e2", "m2:e4"]);
    const second = yield* postJson("/api/stories/pilot/word-timing/align", { startSample: 50, endSample: 100 });
    assert.equal(second.status, 200);
    const after = yield* readJson(autoPath);
    assert.deepEqual(after["words"], { ...onDisk["words"], "m2:e6": { startSample: 62, endSample: 72 } }, "a second range adds its entries and keeps the first range's");
    assert.equal((after["runs"] as unknown[]).length, 2);
    // Re-running the first range replaces its entries (same result here) and appends a run; the manual overlay is never touched and still wins.
    yield* putJson("/api/stories/pilot/word-timing", { words: { "m2:e2": { startSample: 34, endSample: 36 } } });
    const again = yield* postJson("/api/stories/pilot/word-timing/align", { startSample: 0, endSample: 50 });
    const story3 = (yield* bodyJson(again))["story"] as Record<string, any>;
    assert.deepEqual((story3["words"] as Array<Record<string, unknown>>)[1], { id: "m2:e2", value: "second", startSample: 34, endSample: 36, original: { startSample: 30, endSample: 35 }, auto: { startSample: 33, endSample: 38 }, manual: { startSample: 34, endSample: 36 } });
    assert.equal(((yield* readJson(autoPath))["runs"] as unknown[]).length, 3);
    assert.deepEqual((yield* readJson(join(s.planningDirectory, "word-timing.json")))["words"], { "m2:e2": { startSample: 34, endSample: 36 } });
    const all = yield* postJson("/api/stories/pilot/word-timing/align", { startSample: 0, endSample: 100, wholeClip: true });
    assert.equal(all.status, 200);
    assert.equal(((yield* bodyJson(all))["report"] as Record<string, unknown>)["wordCount"], 4);
  }));
});

test("an anchored shot follows its word through PUT /api/word-timing, and a decision anchored to an unknown word is a 400", async t => {
  const s = await serve(t, { words: MORE_WORDS });
  await s.run(Effect.gen(function* () {
    const created = yield* bodyJson(yield* HttpClient.execute(shotForm({ startSample: "5", mode: "graphic-illustration" })));
    const id = created["id"] as string;
    const stale = yield* putJson("/api/stories/pilot/decisions", { settings: { frameAspect: { width: 16, height: 9 } }, shots: { [id]: { anchorWordId: "m9:e9" } } });
    assert.equal(stale.status, 400);
    assert.match(String((yield* bodyJson(stale))["message"]), /m9:e9/);
    const anchored = yield* putJson("/api/stories/pilot/decisions", { settings: { frameAspect: { width: 16, height: 9 } }, shots: { [id]: { anchorWordId: "m2:e4", startSample: 50 } } });
    assert.equal(anchored.status, 200);
    const stitched = (t: Record<string, any>) => (t["stitched"] as Array<Record<string, unknown>>).map(e => [e["kind"], e["startSample"], e["endSample"]]);
    assert.deepEqual(stitched(yield* bodyJson(anchored)), [["gap", 0, 35], ["shot", 35, 100]], "the anchor to `third` (35) beats the startSample override");
    assert.deepEqual((yield* bodyJson(anchored))["unresolvedAnchors"], []);
    assert.equal((yield* putJson("/api/stories/pilot/word-timing", { words: { "m2:e4": { startSample: 80, endSample: 85 } } })).status, 200);
    const moved = yield* bodyJson(yield* get("/api/stories/pilot/timeline"));
    assert.deepEqual(stitched(moved), [["gap", 0, 80], ["shot", 80, 100]], "the shot follows the word's effective start");
    assert.equal(((moved["candidates"] as Array<Record<string, any>>)[0]!["shots"][0] as Record<string, unknown>)["anchorWordId"], "m2:e4");
  }));
});

test("a multipart shot is created with its image, the timeline round-trips through PUT /api/decisions, and bad inputs get honest statuses", async t => {
  const s = await serve(t);
  await s.run(Effect.gen(function* () {
    const empty = yield* bodyJson(yield* get("/api/stories/pilot/timeline"));
    assert.deepEqual([empty["records"], empty["stitched"]], [[], [{ kind: "gap", startSample: 0, endSample: 100 }]]);
    const created = yield* HttpClient.execute(shotForm({ startSeconds: "2.36", mode: "graphic-illustration", label: "Opening", prompt: "A parrot" }, { name: "tiny.PNG", bytes: PNG }));
    assert.equal(created.status, 201);
    const record = yield* bodyJson(created);
    assert.equal(record["startSample"], 24);
    assert.equal(record["imagePath"], "image.png");
    assert.equal(record["imageUrl"], `/api/stories/pilot/shots/${record["id"]}/image`);
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
    assert.equal((yield* get(`/api/stories/pilot/shots/${second["id"]}/image`)).status, 404, "a record without an image is 404");
    const timeline = yield* bodyJson(yield* get("/api/stories/pilot/timeline"));
    assert.deepEqual((timeline["records"] as Array<Record<string, unknown>>).map(r => [r["id"], r["imageUrl"] ?? null]), [[record["id"], record["imageUrl"]], [second["id"], null]]);
    assert.deepEqual((timeline["stitched"] as Array<Record<string, unknown>>).map(e => [e["kind"], e["startSample"], e["endSample"]]), [["gap", 0, 24], ["shot", 24, 40], ["shot", 40, 100]]);
    const put = (body: unknown, headers: Record<string, string> = {}) => HttpClient.execute(HttpClientRequest.put("/api/stories/pilot/decisions", { headers }).pipe(HttpClientRequest.bodyJsonUnsafe(body)));
    const updated = yield* put({ settings: { frameAspect: { width: 4, height: 3 } }, shots: { [record["id"] as string]: { startSample: 0, selected: true }, [second["id"] as string]: { hidden: true } } });
    assert.equal(updated.status, 200);
    const after = yield* bodyJson(updated);
    assert.deepEqual((after["decisions"] as Record<string, any>)["settings"], { frameAspect: { width: 4, height: 3 } });
    assert.deepEqual((after["stitched"] as Array<Record<string, unknown>>).map(e => [e["kind"], e["startSample"], e["endSample"]]), [["shot", 0, 100]]);
    const onDisk = JSON.parse(yield* Effect.promise(() => readFile(join(s.planningDirectory, "decisions.json"), "utf8"))) as Record<string, unknown>;
    assert.deepEqual(onDisk["shots"], { [record["id"] as string]: { startSample: 0, selected: true }, [second["id"] as string]: { hidden: true } });
    assert.deepEqual(yield* bodyJson(yield* get("/api/stories/pilot/timeline")), after, "GET after PUT returns the same payload");
    const unknownShot = yield* put({ settings: { frameAspect: { width: 16, height: 9 } }, shots: { [VALID_ULID]: {} } });
    assert.equal(unknownShot.status, 400);
    assert.equal((yield* bodyJson(unknownShot))["code"], "InvalidDecisions");
    assert.equal((yield* put([1, 2])).status, 400);
    const notJson = yield* HttpClient.execute(HttpClientRequest.put("/api/stories/pilot/decisions").pipe(HttpClientRequest.bodyText("{nope", "application/json")));
    assert.equal(notJson.status, 400);
    const oversized = yield* HttpClient.execute(HttpClientRequest.put("/api/stories/pilot/decisions").pipe(HttpClientRequest.bodyText(`{"settings":{},"shots":{},"pad":"${"x".repeat(70_000)}"}`, "application/json")));
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
    assert.equal((yield* bodyJson(yield* get("/api/stories/pilot/timeline")))["records"].length, 2, "rejected uploads leave no record behind");
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
    for (const path of ["/api/stories/pilot/shots/not-a-ulid/image", "/api/stories/pilot/shots/%2E%2E/image", "/api/stories/pilot/shots/01ARZ3NDEKTSV4RRFFQ69G5FAA/image", `/api/stories/pilot/shots/${VALID_ULID}/image`, "/api/stories/pilot/shots//image", "/api/nope"]) {
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
    const head = yield* HttpClient.head("/api/stories/pilot/audio");
    assert.equal(head.status, 200);
    assert.equal(head.headers["accept-ranges"], "bytes");
    assert.equal(head.headers["content-length"], "12");
    assert.equal(head.headers["content-type"], "audio/flac");
    assert.equal(yield* bodyText(head), "");
    const headRange = yield* HttpClient.head("/api/stories/pilot/audio", { headers: { range: "bytes=0-4" } });
    assert.equal(headRange.status, 200, "Range applies only to GET");
    assert.equal(headRange.headers["content-range"], undefined);
    const partial = yield* get("/api/stories/pilot/audio", { range: "bytes=0-4" });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers["content-range"], "bytes 0-4/12");
    assert.equal(partial.headers["content-length"], "5");
    assert.deepEqual(yield* bodyBytes(partial), bytes.subarray(0, 5));
    for (const range of ["bytes=-3", "bytes=9-", "bytes=9-99"]) {
      const suffix = yield* get("/api/stories/pilot/audio", { range });
      assert.equal(suffix.status, 206, range);
      assert.equal(suffix.headers["content-range"], "bytes 9-11/12");
      assert.deepEqual(yield* bodyBytes(suffix), bytes.subarray(9));
    }
    for (const range of ["bytes=12-", "bytes=-0", "bytes=99-100"]) {
      const invalid = yield* get("/api/stories/pilot/audio", { range });
      assert.equal(invalid.status, 416, range);
      assert.equal(invalid.headers["content-range"], "bytes */12");
      assert.equal(yield* bodyText(invalid), "");
    }
    for (const range of ["bytes=0-1,4-5", "bytes=10-9", "items=0-1"]) {
      const ignored = yield* get("/api/stories/pilot/audio", { range });
      assert.equal(ignored.status, 200, range);
      assert.deepEqual(yield* bodyBytes(ignored), bytes);
    }
    const full = yield* get("/api/stories/pilot/audio");
    assert.equal(full.status, 200);
    assert.equal(full.headers["content-length"], "12");
    assert.deepEqual(yield* bodyBytes(full), bytes);
    const ifRange = yield* get("/api/stories/pilot/audio", { range: "bytes=0-4", "if-range": '"stale"' });
    assert.equal(ifRange.status, 200, "an If-Range condition this server cannot evaluate yields the whole file");
    assert.equal((yield* HttpClient.execute(HttpClientRequest.post("/api/stories/pilot/audio"))).status, 405);
  }));
});

test("/api/events sends ready on connect and pushes timeline-changed after a file lands in the planning directory", async t => {
  const s = await serve(t);
  const seen = await s.run(get("/api/stories/pilot/events").pipe(Effect.flatMap(response => {
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
  await writeFile(join(s.planningDirectory, "cache", "peaks.json"), JSON.stringify(peaks));
  await s.run(Effect.gen(function* () {
    const hit = yield* get("/api/stories/pilot/peaks");
    assert.equal(hit.status, 200);
    assert.deepEqual(yield* bodyJson(hit), peaks);
  }));
  const stale = await serve(t);
  await writeFile(join(stale.planningDirectory, "cache", "peaks.json"), JSON.stringify({ ...peaks, audioSha256: "b".repeat(64) }));
  await stale.run(Effect.gen(function* () {
    // The fixture's "audio" is 12 opaque bytes, so a recompute (with or without ffmpeg installed) must fail loudly rather than serve the stale cache.
    const miss = yield* get("/api/stories/pilot/peaks");
    assert.equal(miss.status, 500);
    const body = yield* bodyJson(miss);
    assert.equal(body["code"], "PeaksFailed");
    assert.deepEqual(JSON.parse(yield* Effect.promise(() => readFile(join(stale.planningDirectory, "cache", "peaks.json"), "utf8"))), { ...peaks, audioSha256: "b".repeat(64) }, "a failed recompute leaves the old file untouched");
  }));
});

test("static mode serves the client with index.html fallback while unknown API paths stay JSON 404; without it the root is a text pointer", async t => {
  const plain = await serve(t);
  await plain.run(Effect.gen(function* () {
    const root = yield* get("/");
    assert.equal(root.status, 200);
    assert.match(yield* bodyText(root), /editor server: 1 stories under .*, default pilot\./);
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
    assert.equal((yield* get("/api/stories/pilot/story")).status, 200);
  }));
});
