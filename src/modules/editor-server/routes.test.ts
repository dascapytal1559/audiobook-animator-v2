import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, type TestContext } from "node:test";
import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { Effect, Layer, Stream } from "effect";
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http";
import { decodeStrict, jobPending, SceneDescriptionsResponse, SceneDescriptionTake, StoryboardDraft, StoryboardDraftsResponse, StoryboardFirstPassPlan, StoryboardFirstPassResult, StoryboardJobsResponse, StoryboardSnapshotResult, StoryMapResponse, TimelineResponse } from "@animator/domain";
import { fixture, type FixtureWord } from "../story/context.fixture.js";
import { storyboardDefaults, type StoryboardSettings } from "../storyboard/index.js";
import { loadEditorLibrary, makeEditorRoutes } from "./index.js";
const encode = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
/** A 1x1 transparent PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const VALID_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

/** The synthetic verified story (10 Hz, 100 samples, 12-byte "audio"), the only story under the fixture root, behind an ephemeral loopback server with a fetch client pointed at it. */
async function serve(t: TestContext, options: { readonly staticDirectory?: string; readonly words?: ReadonlyArray<FixtureWord>; readonly manifestPatch?: Record<string, unknown>; readonly storyboard?: StoryboardSettings } = {}) {
  const story = await fixture(t, options.words ? { words: options.words } : {});
  const planningDirectory = story.dir;
  if (options.manifestPatch) {
    const manifestPath = join(planningDirectory, "story.json");
    await writeFile(manifestPath, encode({ ...(JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>), ...options.manifestPatch }));
  }
  await mkdir(join(planningDirectory, "shots"), { recursive: true });
  await mkdir(join(planningDirectory, "cache"), { recursive: true });
  // At 10 Hz a 100 ms frame is one sample; the lead is 2 samples.
  const settings = { story: story.settings, timeline: { limits: { maxRecordBytes: 65536, maxDecisionsBytes: 65536, maxRecords: 100, maxImageBytes: 1024 } },
    editor: { ffmpegPath: "ffmpeg", peaks: { samplesPerBucket: 16, maxCacheBytes: 65536 }, speech: { frameMs: 100, thresholdDbfs: -50, minSilenceMs: 200, minSpeechMs: 100 }, alignment: { leadMs: 200, boundaryPauseMs: 300 },
      watch: { debounceMs: 50 }, limits: { maxUploadBytes: 8192, requestTimeoutMs: 5000, maxWordTimingBytes: 1048576, maxStoryMapBytes: 65536, maxSceneDescriptionsBytes: 65536 }, chunking: { pauseBreakMs: 600, minSentenceBreakMs: 0 } } };
  const library = await Effect.runPromise(loadEditorLibrary({ storiesDirectory: story.root, settings }).pipe(Effect.provide(NodeServices.layer)));
  const { ctx } = await Effect.runPromise(library.open("pilot").pipe(Effect.provide(NodeServices.layer)));
  const layer = HttpRouter.serve(makeEditorRoutes(library, { producer: { name: "editor", version: "test" }, storyboard: options.storyboard ?? storyboardDefaults, ...(options.staticDirectory !== undefined ? { staticDirectory: options.staticDirectory } : {}) }), { disableLogger: true, disableListenLog: true })
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

test("/api/story carries the verified clip, titles, the book-clock start, the element order, words converted to clip samples with their original layer, chunks, and an empty timing summary", async t => {
  const s = await serve(t);
  const { status, body } = await s.run(Effect.gen(function* () { const r = yield* get("/api/stories/pilot/story"); return { status: r.status, body: yield* bodyJson(r) }; }));
  assert.equal(status, 200);
  assert.deepEqual(body, { clip: s.clip, story: { title: "Pilot", bookTitle: "Book", transcriptProvider: "rev-ai" }, sourceStartSample: 100,
    elements: s.ctx.elements.map(e => e.kind === "word" ? { kind: "word", id: e.id } : { kind: "punctuation", value: e.value }),
    words: [{ id: "m2:e0", value: "Uncorrected", startSample: 13, endSample: 23, original: { startSample: 13, endSample: 23 } }],
    chunks: [{ id: "c0", startSample: 13, endSample: 23, text: "Uncorrected.", wordIds: ["m2:e0"], breakReason: "end" }],
    chunking: { minSentenceBreakMs: 0, pauseBreakMs: 600, mergedSentenceBreaks: [] }, timing: { inversions: 0, autoRuns: [], manualCount: 0, autoCount: 0 } });
  assert.deepEqual([s.clip.bookId, s.clip.storyId, s.clip.sampleRateHz, s.clip.sampleCount], ["book", "pilot", 10, 100]);
});

test("/api/scene-descriptions reads as no takes, then POST appends one take per call for a declared shot and answers 201, with no story map needed; a repeat is 409, an undeclared shot or unshaped body 400", async t => {
  const s = await serve(t, { words: MORE_WORDS });
  const take = { anchorWordId: "m2:e2", model: "anthropic/claude-fable-5.1", text: "Beneath a ceiling of ice.", notes: "seeded by the route test" };
  await s.run(Effect.gen(function* () {
    const empty = yield* get("/api/stories/pilot/scene-descriptions");
    assert.equal(empty.status, 200);
    assert.deepEqual(decodeStrict(SceneDescriptionsResponse, yield* bodyJson(empty)), { takes: [] });
    const undeclared = yield* postJson("/api/stories/pilot/scene-descriptions", take);
    assert.equal(undeclared.status, 400);
    assert.match((yield* bodyJson(undeclared))["message"], /No declared shot starts at m2:e2/);
    const shot = yield* bodyJson(yield* HttpClient.execute(shotForm({ startSample: "5", mode: "graphic-illustration" })));
    assert.equal((yield* putJson("/api/stories/pilot/decisions", { settings: { frameAspect: { width: 16, height: 9 } }, shots: { [shot["id"] as string]: { anchorWordId: "m2:e2" } } })).status, 200);
    const created = yield* postJson("/api/stories/pilot/scene-descriptions", take);
    assert.equal(created.status, 201);
    const recorded = decodeStrict(SceneDescriptionTake, yield* bodyJson(created));
    assert.deepEqual({ ...recorded, id: "x", createdAt: "t" }, { ...take, id: "x", createdAt: "t", producer: { name: "editor", version: "test" } });
    const second = yield* postJson("/api/stories/pilot/scene-descriptions", { anchorWordId: "m2:e2", model: "openai/gpt-6-astra", text: "Under the ice." });
    assert.equal(second.status, 201);
    const repeat = yield* postJson("/api/stories/pilot/scene-descriptions", take);
    assert.equal(repeat.status, 409);
    assert.equal((yield* bodyJson(repeat))["code"], "TakeExists");
    const elsewhere = yield* postJson("/api/stories/pilot/scene-descriptions", { ...take, anchorWordId: "m2:e4" });
    assert.equal(elsewhere.status, 400);
    const unshaped = yield* postJson("/api/stories/pilot/scene-descriptions", { ...take, sectionId: "beat-1" });
    assert.equal(unshaped.status, 400);
    assert.equal((yield* bodyJson(unshaped))["code"], "InvalidRequest");
    const listed = decodeStrict(SceneDescriptionsResponse, yield* bodyJson(yield* get("/api/stories/pilot/scene-descriptions")));
    assert.deepEqual(listed.takes.map(t => [t.anchorWordId, t.model, t.text]), [["m2:e2", "anthropic/claude-fable-5.1", "Beneath a ceiling of ice."], ["m2:e2", "openai/gpt-6-astra", "Under the ice."]]);
    assert.equal(listed.takes[0]!.id, recorded.id);
    const file = yield* readJson(join(s.planningDirectory, "scene-descriptions.json"));
    assert.deepEqual([file["schemaVersion"], file["kind"]], [2, "scene-descriptions"]);
    assert.deepEqual(file["clip"], s.clip);
    assert.deepEqual(file["takes"], listed.takes);
  }));
});

test("/api/map is 404 until story-map.json exists, then serves the map with image URLs the image route answers; a foreign clip is 409 and a map off the transcript is 500 naming the rule", async t => {
  const s = await serve(t, { words: MORE_WORDS });
  const mapPath = join(s.planningDirectory, "story-map.json");
  const base = { schemaVersion: 1, kind: "story-map", clip: s.clip, createdAt: "2026-09-18T00:00:00.000Z", producer: { name: "test", version: "1" } };
  const subjects = [{ id: "hero", kind: "character", name: "Hero", description: "Speaks.", mentions: [{ startWordId: "m2:e2", endWordId: "m2:e4" }], images: [{ path: "refs/hero.png", role: "canonical" }] }, { id: "silence", kind: "motif", name: "Silence", mentions: [] }];
  const sections = [{ id: "act-1", kind: "act", title: "All", startWordId: "m2:e0", endWordId: "m2:e6" }, { id: "beat-1", kind: "beat", title: "Later", summary: "The rest.", startWordId: "m2:e2", endWordId: "m2:e6" }];
  await mkdir(join(s.planningDirectory, "refs"));
  await writeFile(join(s.planningDirectory, "refs", "hero.png"), PNG);
  await s.run(Effect.gen(function* () {
    const absent = yield* get("/api/stories/pilot/map");
    assert.equal(absent.status, 404);
    assert.equal((yield* bodyJson(absent))["code"], "NotFound");
    yield* Effect.promise(() => writeFile(mapPath, encode({ ...base, subjects, sections })));
    const served = yield* get("/api/stories/pilot/map");
    assert.equal(served.status, 200);
    const body = yield* bodyJson(served);
    assert.deepEqual(decodeStrict(StoryMapResponse, body), { ...base, sections, subjects: [{ ...subjects[0], images: [{ path: "refs/hero.png", role: "canonical", url: "/api/stories/pilot/map/subjects/hero/images/0" }] }, subjects[1]] });
    const image = yield* get("/api/stories/pilot/map/subjects/hero/images/0");
    assert.equal(image.status, 200);
    assert.equal(image.headers["content-type"], "image/png");
    assert.deepEqual(yield* bodyBytes(image), PNG);
    for (const path of ["/api/stories/pilot/map/subjects/hero/images/1", "/api/stories/pilot/map/subjects/silence/images/0", "/api/stories/pilot/map/subjects/nobody/images/0"]) {
      assert.equal((yield* get(path)).status, 404, path);
    }
    yield* Effect.promise(() => writeFile(mapPath, encode({ ...base, clip: { ...s.clip, transcriptSha256: "b".repeat(64) }, subjects: [], sections: [] })));
    const foreign = yield* get("/api/stories/pilot/map");
    assert.equal(foreign.status, 409);
    assert.equal((yield* bodyJson(foreign))["code"], "IdentityMismatch");
    yield* Effect.promise(() => writeFile(mapPath, encode({ ...base, subjects: [], sections: [{ id: "a", kind: "act", title: "A", startWordId: "m2:e0", endWordId: "m2:e4" }, { id: "b", kind: "beat", title: "B", startWordId: "m2:e2", endWordId: "m2:e6" }] })));
    const invalid = yield* get("/api/stories/pilot/map");
    assert.equal(invalid.status, 500);
    const error = yield* bodyJson(invalid);
    assert.equal(error["code"], "InvalidMap");
    assert.match(String(error["message"]), /^sections a and b overlap without one containing the other in .*story-map\.json\.$/);
  }));
});

test("/api/stories lists every story directory with its manifest summary and the configured default; unknown or missing story ids are 404 before any file is read", async t => {
  const s = await serve(t);
  await s.run(Effect.gen(function* () {
    const listing = yield* get("/api/stories");
    assert.equal(listing.status, 200);
    assert.deepEqual(yield* bodyJson(listing), { stories: [{ id: "pilot", title: "Pilot", bookId: "book", bookTitle: "Book", wordCount: 1, sampleRateHz: 10, sampleCount: 100, durationSeconds: 10, durationDisplay: "00:00:10.000" }] });
    for (const path of ["/api/stories/other/story", "/api/stories/../story", "/api/stories//story", "/api/stories/pilot", "/api/stories/pilot/"]) {
      const response = yield* get(path);
      assert.equal(response.status, 404, path);
      assert.equal((yield* bodyJson(response))["code"], "NotFound", path);
    }
  }));
  assert.deepEqual(s.library.stories.map(story => story.id), ["pilot"]);
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
    assert.deepEqual([empty["records"], empty["stitched"]], [[], [{ kind: "gap", trackId: "main", startSample: 0, endSample: 100 }]]);
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

test("independent screenshot tracks round-trip shared schemas and decisions without competing at the same anchor", async t => {
  const s = await serve(t);
  await s.run(Effect.gen(function* () {
    const firstResponse = yield* HttpClient.execute(shotForm({ startSample: "0", mode: "source-screenshot", trackId: "claude", label: "Frame 01" }, { name: "tiny.png", bytes: PNG }));
    assert.equal(firstResponse.status, 201);
    const first = yield* bodyJson(firstResponse);
    const secondResponse = yield* HttpClient.execute(shotForm({ startSample: "0", mode: "source-screenshot", trackId: "grok" }, { name: "tiny.png", bytes: PNG }));
    assert.equal(secondResponse.status, 201);
    const second = yield* bodyJson(secondResponse);
    const saved = yield* putJson("/api/stories/pilot/decisions", { settings: { frameAspect: { width: 16, height: 9 } }, shots: {
      [first["id"] as string]: { selected: true, anchorWordId: "m2:e0" }, [second["id"] as string]: { selected: true, anchorWordId: "m2:e0" },
    } });
    assert.equal(saved.status, 200);
    const timeline = decodeStrict(TimelineResponse, yield* bodyJson(saved));
    assert.deepEqual(timeline.records.map(record => [record.trackId, record.mode]), [["claude", "source-screenshot"], ["grok", "source-screenshot"]]);
    assert.deepEqual(timeline.candidates.map(group => [group.trackId, group.startSample, group.selectedId]), [["claude", 13, first["id"]], ["grok", 13, second["id"]]]);
    assert.deepEqual(timeline.stitched.map(entry => [entry.trackId, entry.startSample, entry.endSample]), [["claude", 0, 13], ["claude", 13, 100], ["grok", 0, 13], ["grok", 13, 100]]);
    assert.equal((yield* HttpClient.execute(shotForm({ startSample: "0", mode: "source-screenshot", trackId: "../bad" }))).status, 400);
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

test("/api/events sends ready on connect and pushes timeline-changed after a file lands in the story directory", async t => {
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
    assert.match(yield* bodyText(root), /editor server: 1 stories under .*\./);
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

test("a story manifest's chunking.minSentenceBreakMs overrides the config default in the story payload", async t => {
  const s = await serve(t, { manifestPatch: { chunking: { minSentenceBreakMs: 150 } } });
  const body = await s.run(Effect.gen(function* () { return yield* bodyJson(yield* get("/api/stories/pilot/story")); }));
  assert.equal(body["chunking"].minSentenceBreakMs, 150);
});

/**
 * The fake renderers: one executable Node script made once for this file, since macOS scans every new executable on its first run (about a
 * second each, one at a time), which would slow every other test file's subprocesses. It plays codex when its first argument is `exec`, and
 * the fallback otherwise. Each call appends its argv, stdin, and working directory to `<role>.calls.jsonl`, then runs the body the current
 * test wrote to `<role>.js`, which sees `argv`, `stdin`, `home` ($CODEX_HOME), `fs`, `path`, and `PNG` (base64). Tests in one file run one
 * at a time, so each test owns the fakes while it runs.
 */
let fakes: Promise<string> | undefined;
after(async () => { if (fakes !== undefined) await rm(await fakes, { recursive: true, force: true }); });
const fakeDirectory = () => fakes ??= (async () => {
  const directory = await mkdtemp(join(tmpdir(), "storyboard-fake-"));
  await writeFile(join(directory, "fake"), `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const argv = process.argv.slice(2); const home = process.env.CODEX_HOME; const PNG = ${JSON.stringify(PNG.toString("base64"))};
const role = argv[0] === "exec" ? "codex" : "qwen";
let stdin = ""; process.stdin.on("data", d => { stdin += d; }); process.stdin.on("end", async () => {
  fs.appendFileSync(path.join(__dirname, role + ".calls.jsonl"), JSON.stringify({ argv, stdin, cwd: process.cwd() }) + "\\n");
  eval(fs.readFileSync(path.join(__dirname, role + ".js"), "utf8"));
});
`, { mode: 0o755 });
  return directory;
})();
async function fakeCommand(role: "codex" | "qwen", body: string) {
  const directory = await fakeDirectory();
  await writeFile(join(directory, `${role}.js`), body);
  await writeFile(join(directory, `${role}.calls.jsonl`), "");
  const calls = async () => (await readFile(join(directory, `${role}.calls.jsonl`), "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line) as { argv: string[]; stdin: string; cwd: string });
  return { path: join(directory, "fake"), calls };
}
/** codex exec that opens a thread, saves a PNG where Codex keeps generated images, and says done. */
const CODEX_DRAWS = `console.log(JSON.stringify({ type: "thread.started", thread_id: "thread-1" }));
  fs.mkdirSync(path.join(home, "generated_images", "thread-1"), { recursive: true });
  fs.writeFileSync(path.join(home, "generated_images", "thread-1", "exec-1.png"), Buffer.from(PNG, "base64"));
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } }));`;
const CODEX_FAILS = `process.stderr.write("Error: not logged in. Run codex login.\\n"); process.exit(1);`;
/** The fallback: writes the PNG named after --output. */
const QWEN_DRAWS = `fs.writeFileSync(argv[argv.indexOf("--output") + 1], Buffer.from(PNG, "base64"));`;
const storyboardSettings = (codex: string, fallback: string, home: string): StoryboardSettings => ({ ...storyboardDefaults,
  codex: { ...storyboardDefaults.codex, executable: codex, home, drawTimeoutMs: 20_000, draftTimeoutMs: 20_000 },
  fallback: { argv: [fallback, "--prompt-file", "{promptFile}", "--output", "{output}"], timeoutMs: 20_000 } });
const DRAW_WORDS: ReadonlyArray<FixtureWord> = [{ value: "I", startSeconds: 3, endSeconds: 3.5, punctuation: " " }, { value: "wake", startSeconds: 3.5, endSeconds: 4, punctuation: " " }, { value: "up", startSeconds: 6, endSeconds: 7, punctuation: "." }];

/** Declare a storyboard frame at a word the way the Storyboard section does: an image-less storyboard shot placed at the word, then the user's description. */
const declareFrame = (anchorWordId: string, text: string) => Effect.gen(function* () {
  const form = new FormData();
  for (const [k, v] of Object.entries({ anchorWordId, trackId: "storyboard", mode: "graphic-illustration", label: "Storyboard frame" })) form.append(k, v);
  const created = yield* HttpClient.execute(HttpClientRequest.post("/api/stories/pilot/shots").pipe(HttpClientRequest.bodyFormData(form)));
  assert.equal(created.status, 201);
  const take = yield* postJson("/api/stories/pilot/scene-descriptions", { anchorWordId, model: "user", text });
  assert.equal(take.status, 201);
  return yield* bodyJson(created);
});
const waitForJob = (id: string) => Effect.gen(function* () {
  for (let i = 0; i < 200; i++) {
    const { jobs } = decodeStrict(StoryboardJobsResponse, yield* bodyJson(yield* get("/api/stories/pilot/storyboard/jobs")));
    const job = jobs.find(j => j.id === id);
    if (job !== undefined && !jobPending(job)) return job;
    yield* Effect.sleep("50 millis");
  }
  throw new Error(`job ${id} never finished`);
});

test("a shot placed at a word records the anchor and starts at the word's effective start; an unknown word is a 400", async t => {
  const s = await serve(t, { words: DRAW_WORDS });
  await s.run(Effect.gen(function* () {
    const record = yield* declareFrame("m2:e4", "A man wakes.");
    assert.deepEqual([record["anchorWordId"], record["trackId"], record["startSample"]], ["m2:e4", "storyboard", 35]);
    const form = new FormData();
    for (const [k, v] of Object.entries({ anchorWordId: "nope", mode: "graphic-illustration" })) form.append(k, v);
    const bad = yield* HttpClient.execute(HttpClientRequest.post("/api/stories/pilot/shots").pipe(HttpClientRequest.bodyFormData(form)));
    assert.equal(bad.status, 400);
    const timeline = decodeStrict(TimelineResponse, yield* bodyJson(yield* get("/api/stories/pilot/timeline")));
    assert.deepEqual(timeline.stitched.filter(e => e.kind === "shot").map(e => [e.trackId, e.startSample, e.kind === "shot" ? e.anchorWordId : null]), [["storyboard", 35, "m2:e4"]]);
  }));
});

test("POST /storyboard/draft asks codex for a description of the shot at a word, in an empty read-only turn without the user's config, and answers with the text, model, and prompt; a failure is 502 naming why", async t => {
  const home = await mkdtemp(join(tmpdir(), "codex-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const codex = await fakeCommand("codex", `console.log(JSON.stringify({ type: "thread.started", thread_id: "t" })); console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "“A man jolts awake in a dark room.”" } }));`);
  const s = await serve(t, { words: DRAW_WORDS, storyboard: storyboardSettings(codex.path, "/nonexistent/qwen", home) });
  await s.run(Effect.gen(function* () {
    const answered = yield* postJson("/api/stories/pilot/storyboard/draft", { anchorWordId: "m2:e4" });
    assert.equal(answered.status, 200);
    const draft = decodeStrict(StoryboardDraft, yield* bodyJson(answered));
    assert.deepEqual([draft.anchorWordId, draft.text, draft.model], ["m2:e4", "A man jolts awake in a dark room.", "openai/gpt-6-astra"]);
    assert.match(draft.prompt, /Story: Pilot\nPassage:\nUncorrected\. I \[\[wake\]\] up\.$/);
    const [call] = yield* Effect.promise(codex.calls);
    assert.equal(call?.stdin, draft.prompt);
    for (const flag of ["exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "read-only", "--disable", "image_generation", "shell_tool", "browser_use", "computer_use", 'web_search="disabled"', "--json", "gpt-6-astra", "-"]) assert.ok(call?.argv.includes(flag), flag);
    const workDirectory = call!.argv[call!.argv.indexOf("--cd") + 1]!;
    assert.match(workDirectory, /animator-storyboard-text-/);
    assert.ok(call!.cwd.endsWith(workDirectory.replace(/^\/private/, "")), "codex runs in its own empty working directory");
    const revised = decodeStrict(StoryboardDraft, yield* bodyJson(yield* postJson("/api/stories/pilot/storyboard/draft", { anchorWordId: "m2:e2", endWordId: "m2:e4", current: "A man in bed.", request: "close on his hands" })));
    assert.match(revised.prompt, /The shot is described now as: "A man in bed\."\nThe director asks for this: "close on his hands"\./);
    assert.match(revised.prompt, /Passage:\nUncorrected\. \[\[I wake\]\] up\.$/, "the excerpt marks the whole span the shot covers");
    assert.equal((yield* postJson("/api/stories/pilot/storyboard/draft", { anchorWordId: "m2:e4", endWordId: "m2:e2" })).status, 400, "an end before the start is refused");
    assert.equal((yield* postJson("/api/stories/pilot/storyboard/draft", { anchorWordId: "gone" })).status, 400);
    assert.equal((yield* postJson("/api/stories/pilot/storyboard/draft", { anchorWordId: "m2:e4", extra: 1 })).status, 400);
  }));
  const failing = await fakeCommand("codex", CODEX_FAILS);
  const f = await serve(t, { words: DRAW_WORDS, storyboard: storyboardSettings(failing.path, "/nonexistent/qwen", home) });
  await f.run(Effect.gen(function* () {
    const failed = yield* postJson("/api/stories/pilot/storyboard/draft", { anchorWordId: "m2:e4" });
    assert.equal(failed.status, 502);
    const body = yield* bodyJson(failed);
    assert.equal(body["code"], "DraftFailed");
    assert.match(body["message"], /exited with code 1\)\. The Codex CLI is not logged in to ChatGPT; run `codex login`\. Error: not logged in/);
  }));
});

const drafts = () => Effect.map(Effect.flatMap(get("/api/stories/pilot/storyboard/drafts"), bodyJson), body => decodeStrict(StoryboardDraftsResponse, body).drafts);
const drawDraft = (anchorWordId: string, text: string, startWordId = anchorWordId) => Effect.gen(function* () {
  const started = yield* postJson("/api/stories/pilot/storyboard/draw", { anchorWordId, startWordId, text });
  assert.equal(started.status, 202);
  return decodeStrict(StoryboardJobsResponse, yield* bodyJson(started)).jobs[0]!;
});

test("POST /storyboard/draw draws a draft drawing of the drafted description in the background through codex, keeps it off the timeline as the shot's draft drawing, replaces it with a newer one, and drops it on discard", async t => {
  const home = await mkdtemp(join(tmpdir(), "codex-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const codex = await fakeCommand("codex", CODEX_DRAWS);
  const qwen = await fakeCommand("qwen", QWEN_DRAWS);
  const s = await serve(t, { words: DRAW_WORDS, storyboard: storyboardSettings(codex.path, qwen.path, home) });
  await s.run(Effect.gen(function* () {
    assert.equal((yield* postJson("/api/stories/pilot/storyboard/draw", { anchorWordId: "gone", startWordId: "m2:e4", text: "x" })).status, 400);
    assert.equal((yield* postJson("/api/stories/pilot/storyboard/draw", { anchorWordId: "m2:e4" })).status, 400);
    const job = yield* drawDraft("m2:e4", "A man sits up in bed, gasping.");
    assert.deepEqual([job.kind, job.anchorWordId], ["draft", "m2:e4"]);
    const done = yield* waitForJob(job.id);
    assert.equal(done.status, "done", done.error);
    assert.deepEqual([done.recordId, done.attempts.map(a => [a.renderer, a.error ?? null])], [undefined, [["codex-chatgpt", null]]]);
    const [draft] = yield* drafts();
    assert.deepEqual([draft?.id, draft?.anchorWordId, draft?.startWordId, draft?.description, draft?.renderer], [done.draftId, "m2:e4", "m2:e4", "A man sits up in bed, gasping.", "codex-chatgpt"]);
    assert.match(draft!.prompt, /^Use your image generation tool[\s\S]*The frame shows: A man sits up in bed, gasping\.[\s\S]*from "Pilot" \(context only; do not write it in the picture\): wake up\.$/);
    assert.match(draft!.notes, /through the Codex CLI under the ChatGPT login \(model gpt-6-astra, thread thread-1\)\. \d+\.\d s, 1x1\.$/);
    const image = yield* get(draft!.imageUrl);
    assert.deepEqual([image.status, image.headers["content-type"]], [200, "image/png"]);
    assert.equal(decodeStrict(TimelineResponse, yield* bodyJson(yield* get("/api/stories/pilot/timeline"))).records.length, 0, "a draft drawing is not on the timeline");
    const [call] = yield* Effect.promise(codex.calls);
    assert.equal(call?.stdin, draft!.prompt);
    assert.ok(call?.argv.includes("--enable") && call.argv.includes("image_generation"));
    const newer = yield* waitForJob((yield* drawDraft("m2:e4", "Closer on his hands.")).id);
    assert.deepEqual((yield* drafts()).map(d => [d.id, d.description]), [[newer.draftId, "Closer on his hands."]], "a newer draft drawing replaces the shot's earlier one");
    assert.equal((yield* get(draft!.imageUrl)).status, 404);
    const discarded = yield* postJson("/api/stories/pilot/storyboard/drafts/discard", { anchorWordId: "m2:e4" });
    assert.deepEqual(decodeStrict(StoryboardDraftsResponse, yield* bodyJson(discarded)).drafts, []);
    assert.deepEqual(yield* Effect.promise(qwen.calls), [], "the fallback is not tried when the primary draws");
  }));
});

test("a draft drawing falls back to local Qwen when codex fails, says which renderer drew it and why, and fails naming both when both fail; a shot being drawn refuses a second draft drawing", async t => {
  const home = await mkdtemp(join(tmpdir(), "codex-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const codex = await fakeCommand("codex", CODEX_FAILS);
  const qwen = await fakeCommand("qwen", `setTimeout(() => { ${QWEN_DRAWS} }, 300);`);
  const s = await serve(t, { words: DRAW_WORDS, storyboard: storyboardSettings(codex.path, qwen.path, home) });
  await s.run(Effect.gen(function* () {
    const started = yield* drawDraft("m2:e2", "A man lies still.");
    const again = yield* postJson("/api/stories/pilot/storyboard/draw", { anchorWordId: "m2:e2", startWordId: "m2:e2", text: "x" });
    assert.equal(again.status, 409);
    assert.equal((yield* bodyJson(again))["code"], "JobRunning");
    const done = yield* waitForJob(started.id);
    assert.equal(done.status, "done", done.error);
    assert.deepEqual(done.attempts.map(a => [a.renderer, /not logged in/.test(a.error ?? "")]), [["codex-chatgpt", true], ["qwen-image-2.1", false]]);
    const [draft] = yield* drafts();
    assert.equal(draft?.renderer, "qwen-image-2.1");
    assert.match(draft?.prompt ?? "", /^A single storyboard frame for an animated film, drawn by hand/);
    assert.match(draft?.notes ?? "", /Drawn by local Qwen Image 2\.1: .*\. \d+\.\d s, 1x1\. Drawn after the primary renderer failed: .*not logged in/);
    const [call] = yield* Effect.promise(qwen.calls);
    assert.match(call!.argv[call!.argv.indexOf("--prompt-file") + 1]!, /prompt\.txt$/);
  }));
  const broken = await serve(t, { words: DRAW_WORDS, storyboard: storyboardSettings(codex.path, "/nonexistent/mflux-generate-qwen-2.1", home) });
  await broken.run(Effect.gen(function* () {
    const failed = yield* waitForJob((yield* drawDraft("m2:e2", "A man lies still.")).id);
    assert.equal(failed.status, "failed");
    assert.match(failed.error ?? "", /Local Qwen Image 2\.1 could not start \/nonexistent\/mflux-generate-qwen-2\.1; is it installed\?/);
    assert.deepEqual([failed.draftId, yield* drafts()], [undefined, []]);
  }));
});

test("a codex turn that outlives its timeout is stopped and the drawing falls back", async t => {
  const home = await mkdtemp(join(tmpdir(), "codex-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const codex = await fakeCommand("codex", `setTimeout(() => {}, 60_000);`);
  const qwen = await fakeCommand("qwen", QWEN_DRAWS);
  const settings = storyboardSettings(codex.path, qwen.path, home);
  const s = await serve(t, { words: DRAW_WORDS, storyboard: { ...settings, codex: { ...settings.codex, drawTimeoutMs: 500 } } });
  await s.run(Effect.gen(function* () {
    const done = yield* waitForJob((yield* drawDraft("m2:e2", "A man lies still.")).id);
    assert.equal(done.status, "done", done.error);
    assert.deepEqual(done.attempts.map(a => [a.renderer, a.error ?? null]), [["codex-chatgpt", "ChatGPT through the Codex CLI timed out after 1 s."], ["qwen-image-2.1", null]]);
  }));
});

const snapshot = (body: Record<string, unknown>) => postJson("/api/stories/pilot/storyboard/snapshot", { frameWordId: null, description: null, draftId: null, ...body });
const saved = (response: { status: number; json: Effect.Effect<unknown, unknown> }) => Effect.gen(function* () {
  const body = yield* bodyJson(response);
  assert.equal(response.status, 201, body["message"]);
  return decodeStrict(StoryboardSnapshotResult, body);
});
const storyboardShots = () => Effect.map(Effect.flatMap(get("/api/stories/pilot/timeline"), bodyJson), body =>
  decodeStrict(TimelineResponse, body).stitched.flatMap(e => (e.kind === "shot" && e.trackId === "storyboard" ? [[e.anchorWordId ?? null, e.startSample, e.imagePath ?? null] as const] : [])));

test("a snapshot saves the drafting space as one new record and take at the shot's start word: a new shot with its draft drawing, a description alone, a moved start carrying drawing and description, and a drawn-in end declaring the shot after", async t => {
  const home = await mkdtemp(join(tmpdir(), "codex-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const codex = await fakeCommand("codex", CODEX_DRAWS);
  const s = await serve(t, { words: DRAW_WORDS, storyboard: storyboardSettings(codex.path, "/nonexistent/qwen", home) });
  await s.run(Effect.gen(function* () {
    // A new shot at "wake": its draft drawing and its description, through the last word.
    const drawn = yield* waitForJob((yield* drawDraft("m2:e4", "A man wakes.")).id);
    const created = yield* saved(yield* snapshot({ startWordId: "m2:e4", endWordId: "m2:e6", description: { model: "user", text: "A man wakes." }, draftId: drawn.draftId }));
    assert.deepEqual([created.record?.anchorWordId, created.record?.startSample, created.record?.renderer, created.record?.imagePath, created.take?.anchorWordId, created.take?.text, created.split, created.retire],
      ["m2:e4", 35, "codex-chatgpt", "image.png", "m2:e4", "A man wakes.", null, []]);
    assert.match(created.record?.notes ?? "", /^Saved from the drafting space \(A68\)\. Drawn by ChatGPT's image tool/);
    assert.ok(created.record?.imageUrl);
    assert.deepEqual(yield* drafts(), [], "the saved draft drawing is consumed");
    // The same shot again, the description alone: a take, no record.
    const described = yield* saved(yield* snapshot({ frameWordId: "m2:e4", startWordId: "m2:e4", endWordId: "m2:e6", description: { model: "openai/gpt-6-astra", text: "He sits up.", prompt: "p" } }));
    assert.deepEqual([described.record, described.take?.text, described.take?.model], [null, "He sits up.", "openai/gpt-6-astra"]);
    const nothing = yield* snapshot({ frameWordId: "m2:e4", startWordId: "m2:e4", endWordId: "m2:e6" });
    assert.equal(nothing.status, 400);
    assert.match((yield* bodyJson(nothing))["message"], /Nothing to save/);
    // Its start moved to "I": the drawing is copied and the description carried to the new word; the old frame is named to retire.
    const moved = yield* saved(yield* snapshot({ frameWordId: "m2:e4", startWordId: "m2:e2", endWordId: "m2:e6" }));
    assert.deepEqual([moved.record?.anchorWordId, moved.record?.startSample, moved.record?.imagePath, moved.record?.renderer, moved.take?.text, moved.take?.model, moved.take?.prompt],
      ["m2:e2", 30, "image.png", "codex-chatgpt", "He sits up.", "openai/gpt-6-astra", "p"]);
    assert.match(moved.record?.notes ?? "", /Moved from m2:e4 to m2:e2\. The drawing is a copy of record /);
    assert.match(moved.take?.notes ?? "", /Carried from m2:e4 when the shot's start moved to m2:e2 \(A68\)/);
    assert.deepEqual(moved.retire, [created.record!.id], "the old frame's shots are for the editor to hide");
    const put = yield* HttpClient.execute(HttpClientRequest.put("/api/stories/pilot/decisions").pipe(HttpClientRequest.bodyJsonUnsafe({ settings: { frameAspect: { width: 16, height: 9 } }, shots: Object.fromEntries(moved.retire.map(id => [id, { hidden: true }])) })));
    assert.equal(put.status, 200);
    assert.deepEqual(yield* storyboardShots(), [["m2:e2", 30, "image.png"]], "with the old frame hidden, the shot starts at its new word");
    // Its end drawn in to "wake": an empty frame begins at "up".
    const split = yield* saved(yield* snapshot({ frameWordId: "m2:e2", startWordId: "m2:e2", endWordId: "m2:e4" }));
    assert.deepEqual([split.record, split.take, split.split?.anchorWordId, split.split?.imagePath, split.retire], [null, null, "m2:e6", undefined, []]);
    assert.match(split.split?.notes ?? "", /Declared by a drafting-space snapshot \(A68\) of the shot at m2:e2, whose end was drawn in to m2:e4\./);
    assert.deepEqual(yield* storyboardShots(), [["m2:e2", 30, "image.png"], ["m2:e6", 60, null]]);
  }));
});

test("a snapshot is refused when its span would swallow a neighbouring shot, when a new shot starts where a frame does, or when the frame it names is gone; a start moved back onto the old frame's word keeps that frame", async t => {
  const s = await serve(t, { words: DRAW_WORDS });
  await s.run(Effect.gen(function* () {
    yield* declareFrame("m2:e2", "A man lies still.");
    yield* declareFrame("m2:e6", "He gets up.");
    for (const [body, message] of [
      [{ frameWordId: "m2:e2", startWordId: "m2:e2", endWordId: "m2:e6", description: { model: "user", text: "x" } }, /run into the shot after it and swallow it/],
      [{ frameWordId: "m2:e6", startWordId: "m2:e2", endWordId: "m2:e6", description: { model: "user", text: "x" } }, /start at or before the shot before it and swallow it/],
      [{ startWordId: "m2:e6", endWordId: "m2:e6", description: { model: "user", text: "x" } }, /A storyboard frame already starts at m2:e6/],
      [{ frameWordId: "m2:e4", startWordId: "m2:e4", endWordId: "m2:e4" }, /No storyboard frame starts at m2:e4/],
      [{ frameWordId: "m2:e2", startWordId: "m2:e4", endWordId: "m2:e2" }, /end before it starts/],
      [{ frameWordId: "m2:e2", startWordId: "gone", endWordId: "m2:e2" }, /gone is not a word of the transcript/],
    ] as const) {
      const response = yield* snapshot(body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.match((yield* bodyJson(response))["message"], message);
    }
    // The frame at "up" starts one word earlier and ends there, so the empty frame would land on its own old word: that frame is kept.
    const kept = yield* saved(yield* snapshot({ frameWordId: "m2:e6", startWordId: "m2:e4", endWordId: "m2:e4" }));
    assert.deepEqual([kept.record?.anchorWordId, kept.take?.text, kept.split, kept.retire], ["m2:e4", "He gets up.", null, []]);
    assert.deepEqual((yield* storyboardShots()).map(([word]) => word), ["m2:e2", "m2:e4", "m2:e6"]);
  }));
});

/** Words for a first pass: a beat of two sentences after the fixture's "Uncorrected." */
const PASS_WORDS: ReadonlyArray<FixtureWord> = [{ value: "I", startSeconds: 3, endSeconds: 3.5, punctuation: " " }, { value: "wake", startSeconds: 3.5, endSeconds: 4, punctuation: " " }, { value: "up", startSeconds: 4, endSeconds: 4.5, punctuation: ". " },
  { value: "Ice", startSeconds: 6, endSeconds: 6.5, punctuation: " " }, { value: "again", startSeconds: 6.5, endSeconds: 7, punctuation: "." }];
/** codex exec that answers a plan as a text turn and draws as an image turn. */
const codexPlansAndDraws = (plan: unknown) => `if (argv.includes("--enable")) { ${CODEX_DRAWS} } else {
  console.log(JSON.stringify({ type: "thread.started", thread_id: "plan" }));
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: ${JSON.stringify("```json\n" + JSON.stringify(plan) + "\n```")} } })); }`;
const writeMap = (s: Awaited<ReturnType<typeof serve>>) => writeFile(join(s.planningDirectory, "story-map.json"), encode({ schemaVersion: 1, kind: "story-map", clip: s.clip, createdAt: "2026-10-07T00:00:00.000Z", producer: { name: "test", version: "1" }, subjects: [],
  sections: [{ id: "act-1", kind: "act", title: "All", startWordId: "m2:e0", endWordId: "m2:e10" }, { id: "beat-1", kind: "beat", title: "Waking", summary: "He wakes.", startWordId: "m2:e2", endWordId: "m2:e10" }] }));

test("a first pass plans a beat's shots through codex, keeps the shots already declared there, then declares frames, records the model's descriptions, and queues drawings without overwriting anything", async t => {
  const home = await mkdtemp(join(tmpdir(), "codex-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const codex = await fakeCommand("codex", codexPlansAndDraws({ shots: [{ opens: "I wake up", description: "A man jolts upright in bed in a dark room, seen from the doorway." }, { opens: "Nowhere to be found", description: "Lost." }] }));
  const qwen = await fakeCommand("qwen", QWEN_DRAWS);
  const s = await serve(t, { words: PASS_WORDS, storyboard: storyboardSettings(codex.path, qwen.path, home) });
  await s.run(Effect.gen(function* () {
    const absent = yield* postJson("/api/stories/pilot/storyboard/first-pass/plan", { sectionId: "beat-1" });
    assert.equal(absent.status, 404, "no story map, no sections to plan");
    yield* Effect.promise(() => writeMap(s));
    // A shot already declared at "Ice" by another track's image, with a description.
    const ice = yield* bodyJson(yield* HttpClient.execute(shotForm({ anchorWordId: "m2:e8", trackId: "gpt", mode: "graphic-illustration" }, { name: "ice.png", bytes: PNG })));
    assert.equal(ice["startSample"], 60);
    assert.equal((yield* postJson("/api/stories/pilot/scene-descriptions", { anchorWordId: "m2:e8", model: "anthropic/claude-fable-5.1", text: "Ice everywhere." })).status, 201);
    for (const [sectionId, message] of [["act-1", /is an act; a first pass plans one beat or scene/], ["nope", /no section nope/]] as const) {
      const refused = yield* postJson("/api/stories/pilot/storyboard/first-pass/plan", { sectionId });
      assert.equal(refused.status, 400);
      assert.match((yield* bodyJson(refused))["message"], message);
    }

    const planned = yield* postJson("/api/stories/pilot/storyboard/first-pass/plan", { sectionId: "beat-1" });
    assert.equal(planned.status, 200);
    const plan = decodeStrict(StoryboardFirstPassPlan, yield* bodyJson(planned));
    assert.equal(plan.model, "openai/gpt-6-astra");
    assert.match(plan.prompt, /keep each as a shot that starts exactly there: "Ice again\."\./);
    assert.match(plan.prompt, /Story: Pilot\nBeat: Waking \(He wakes\.\)\nNarration just before it \(context only; no shots here\): Uncorrected\.\nThe beat:\n1\. I wake up\.\n2\. Ice again\.$/);
    assert.deepEqual(plan.shots, [
      { anchorWordId: "m2:e2", startSample: 30, text: "A man jolts upright in bed in a dark room, seen from the doorway.", frame: "new", description: "new", drawing: "new" },
      { anchorWordId: "m2:e8", startSample: 60, text: null, frame: "new", description: "kept", drawing: "new" },
    ]);
    assert.deepEqual(plan.unmatched.map(u => u.opens), ["Nowhere to be found"]);
    const [planCall] = yield* Effect.promise(codex.calls);
    assert.equal(planCall?.stdin, plan.prompt);
    assert.ok(planCall?.argv.includes("--disable") && planCall.argv.includes("image_generation") && !planCall.argv.includes("--enable"), "the plan is a text turn");
    assert.equal(decodeStrict(TimelineResponse, yield* bodyJson(yield* get("/api/stories/pilot/timeline"))).records.length, 1, "planning writes nothing");

    const outside = yield* postJson("/api/stories/pilot/storyboard/first-pass", { sectionId: "beat-1", model: plan.model, prompt: plan.prompt, shots: [{ anchorWordId: "m2:e0", text: "x" }] });
    assert.equal(outside.status, 400);
    assert.match((yield* bodyJson(outside))["message"], /m2:e0 does not begin inside section beat-1/);
    const applied = yield* postJson("/api/stories/pilot/storyboard/first-pass", { sectionId: plan.sectionId, model: plan.model, prompt: plan.prompt, shots: plan.shots.map(({ anchorWordId, text }) => ({ anchorWordId, text })) });
    assert.equal(applied.status, 202);
    const result = decodeStrict(StoryboardFirstPassResult, yield* bodyJson(applied));
    assert.deepEqual(result.shots, plan.shots);
    assert.deepEqual(result.jobs.map(j => [j.anchorWordId, j.firstPassId]), [["m2:e2", result.firstPassId], ["m2:e8", result.firstPassId]]);
    for (const job of result.jobs) assert.equal((yield* waitForJob(job.id)).status, "done");

    const takes = decodeStrict(SceneDescriptionsResponse, yield* bodyJson(yield* get("/api/stories/pilot/scene-descriptions"))).takes;
    assert.deepEqual(takes.map(t => [t.anchorWordId, t.model, t.text]), [["m2:e8", "anthropic/claude-fable-5.1", "Ice everywhere."], ["m2:e2", "openai/gpt-6-astra", plan.shots[0]!.text]]);
    assert.equal(takes[1]!.prompt, plan.prompt);
    assert.match(takes[1]!.notes ?? "", new RegExp(`^First pass ${result.firstPassId} of beat beat-1 \\("Waking"\\): shot 1 of 2\\.$`));
    const timeline = decodeStrict(TimelineResponse, yield* bodyJson(yield* get("/api/stories/pilot/timeline")));
    const storyboard = timeline.records.filter(r => r.trackId === "storyboard");
    assert.deepEqual(storyboard.filter(r => r.imagePath === undefined).map(r => `${r.anchorWordId} ${r.label}`).sort(), ["m2:e2 Storyboard frame", "m2:e8 Storyboard frame"]);
    const drawn = storyboard.filter(r => r.imagePath !== undefined);
    assert.deepEqual(drawn.map(r => r.anchorWordId).sort(), ["m2:e2", "m2:e8"]);
    assert.match(drawn.find(r => r.anchorWordId === "m2:e8")!.prompt ?? "", /The frame shows: Ice everywhere\./, "an existing description is the one drawn");

    // A second pass over the same beat keeps everything and draws nothing.
    const again = decodeStrict(StoryboardFirstPassPlan, yield* bodyJson(yield* postJson("/api/stories/pilot/storyboard/first-pass/plan", { sectionId: "beat-1" })));
    assert.deepEqual(again.shots.map(x => [x.anchorWordId, x.frame, x.description, x.drawing]), [["m2:e2", "kept", "kept", "kept"], ["m2:e8", "kept", "kept", "kept"]]);
    const rerun = decodeStrict(StoryboardFirstPassResult, yield* bodyJson(yield* postJson("/api/stories/pilot/storyboard/first-pass", { sectionId: "beat-1", model: again.model, prompt: again.prompt, shots: again.shots.map(({ anchorWordId, text }) => ({ anchorWordId, text })) })));
    assert.deepEqual(rerun.jobs, []);
    assert.equal(decodeStrict(SceneDescriptionsResponse, yield* bodyJson(yield* get("/api/stories/pilot/scene-descriptions"))).takes.length, 2);
    assert.equal(decodeStrict(TimelineResponse, yield* bodyJson(yield* get("/api/stories/pilot/timeline"))).records.length, timeline.records.length);
  }));
});

test("a plan the model does not answer as JSON is a 502 naming what it said", async t => {
  const home = await mkdtemp(join(tmpdir(), "codex-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const codex = await fakeCommand("codex", `console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "I would start with the ice." } }));`);
  const s = await serve(t, { words: PASS_WORDS, storyboard: storyboardSettings(codex.path, "/nonexistent/qwen", home) });
  await s.run(Effect.gen(function* () {
    yield* Effect.promise(() => writeMap(s));
    const failed = yield* postJson("/api/stories/pilot/storyboard/first-pass/plan", { sectionId: "beat-1" });
    assert.equal(failed.status, 502);
    const body = yield* bodyJson(failed);
    assert.equal(body["code"], "PlanFailed");
    assert.match(body["message"], /did not answer with the JSON object it was asked for: I would start with the ice\./);
  }));
});
