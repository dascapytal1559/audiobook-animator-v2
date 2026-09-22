import { basename, join, resolve } from "node:path";
import { Duration, Effect, FileSystem, Layer, Schema, Semaphore, Stream } from "effect";
import { AnimatorError } from "../../core/error.js";
import { Sse } from "effect/unstable/encoding";
import { HttpIncomingMessage, HttpRouter, type HttpServerRequest, HttpServerResponse, HttpStaticServer, Multipart } from "effect/unstable/http";
import { clipOf, listStories as listStoryManifests, loadStoryContext, type StoryContext, type StorySettings } from "../story/index.js";
import { decodeJson, imageContentType, readBounded } from "../../core/io.js";
import { addShot, type ClipIdentity, isUlid, loadVisualTimeline, ShotMode, ShotRecord, type VisualTimelineSettings, writeDecisions, type DecisionsBody } from "../visual-timeline/index.js";
import { type TimingEntries } from "../word-timing/index.js";
import { type LoadedStoryMap, loadStoryMap } from "../story-map/index.js";
import { addSceneDescriptionTake, loadSceneDescriptions, SceneDescriptionTakeBody } from "../scene-descriptions/index.js";
import { type ChunkElement, type SceneDescriptionsResponse, type StoriesResponse, type StoryMapResponse, type StorySummary, type TimelineResponse } from "@animator/domain";
export type { StorySummary };
import { type EditorSettings, editorError, type EditorCode } from "./contracts.js";
import type { PeaksIdentity, SpeechIdentity } from "./peaks.js";
import { parseRange } from "./range.js";
import { alignTiming, type Caches, loadTiming, makeCaches, storyPayload, writeManualTiming } from "./timing.js";
type Code = EditorCode;
const fail = (code: Code, message: string) => Effect.fail(editorError({ code, message }));
const HEARTBEAT = Duration.seconds(15);
const MAX_MULTIPART_PARTS = 16;

/** A transcript word with its ORIGINAL provider timing on the clip clock. Effective timing is merged per request by `loadTiming`. */
export type EditorWord = { readonly id: string; readonly value: string; readonly startSample: number; readonly endSample: number };
/** What every story shares: where the stories live and the effective settings of the three modules the server composes. Nothing here names a default story. */
export type EditorShared = {
  /** Every direct subdirectory is a story the server can open. */
  readonly storiesDirectory: string;
  readonly settings: { readonly story: StorySettings; readonly timeline: VisualTimelineSettings; readonly editor: EditorSettings };
};
/** One verified story: the shared configs plus the loaded story, its clip identity, words, and cache identities. */
export type EditorContext = EditorShared & {
  readonly story: StoryContext; readonly clip: ClipIdentity; readonly storyDirectory: string;
  /** Regenerable caches live here, apart from source and work files; the watcher ignores it. */
  readonly cacheDirectory: string;
  readonly peaksPath: string; readonly peaksIdentity: PeaksIdentity; readonly speechPath: string; readonly speechIdentity: SpeechIdentity;
  /** Transcript elements (words with original timing, plus punctuation) in order, for chunking. */
  readonly elements: ReadonlyArray<ChunkElement>;
  readonly words: ReadonlyArray<EditorWord>;
};
/** A story opened by the server: its verified context and its in-memory peaks/speech caches. */
export type OpenStory = { readonly ctx: EditorContext; readonly caches: Caches };
export type EditorLibrary = EditorShared & {
  readonly stories: ReadonlyArray<StorySummary>;
  /** The listed story, verified on first open and kept for the process lifetime; a failed verification is retried on the next open. Unknown ids are `NotFound`. */
  readonly open: (storyId: string | undefined) => Effect.Effect<OpenStory, AnimatorError | AnimatorError, FileSystem.FileSystem>;
};
export type EditorRouteOptions = { readonly producer: { readonly name: string; readonly version: string }; readonly staticDirectory?: string };

const read = (path: string, limit: number) => readBounded(path, limit).pipe(Effect.mapError(e => editorError({ code: "IoFailed", message: e.message })));
const decode = <S extends Schema.Top>(schema: S, bytes: Uint8Array, code: Code, path: string) => decodeJson(schema, bytes, path, true).pipe(Effect.mapError(e => editorError({ code, message: e.message })));

/** Every story under the stories directory, summarized from its manifest. A manifest that fails is InvalidConfig: the server cannot list what it cannot read. */
export function listStories(shared: EditorShared): Effect.Effect<ReadonlyArray<StorySummary>, AnimatorError, FileSystem.FileSystem> {
  return listStoryManifests(shared.storiesDirectory, shared.settings.story.limits).pipe(Effect.mapError(e => editorError({ code: e.code === "IoFailed" ? "IoFailed" : "InvalidConfig", message: e.message })));
}

/** One story verified through story, its words converted to clip samples, and its cache identities. The story directory is what `/events` watches. */
export function openStory(shared: EditorShared, storyId: string): Effect.Effect<EditorContext, AnimatorError | AnimatorError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const story = yield* loadStoryContext({ storyDirectory: join(shared.storiesDirectory, storyId), settings: shared.settings.story });
    const clip: ClipIdentity = clipOf(story);
    const { storyDirectory } = story;
    const toSample = (seconds: number) => Math.min(clip.sampleCount, Math.max(0, Math.round(seconds * clip.sampleRateHz)));
    const elements: ReadonlyArray<ChunkElement> = story.transcript.kind === "story-transcript" ? story.transcript.elements : story.transcript.elements.map(e => e.kind === "word"
      ? { kind: "word", id: e.id, value: e.value, startSample: toSample(e.approximateSegmentStartSeconds), endSample: toSample(e.approximateSegmentEndSeconds) }
      : { kind: "punctuation", value: e.value });
    const words = elements.flatMap(e => e.kind === "word" ? [{ id: e.id, value: e.value, startSample: e.startSample, endSample: e.endSample }] : []);
    const frameSamples = Math.round((shared.settings.editor.speech.frameMs / 1000) * clip.sampleRateHz);
    if (frameSamples < 1) return yield* fail("InvalidConfig", `speech.frameMs ${shared.settings.editor.speech.frameMs} is shorter than one sample at ${clip.sampleRateHz} Hz.`);
    const peaksIdentity: PeaksIdentity = { audioSha256: clip.audioSha256, sampleRateHz: clip.sampleRateHz, sampleCount: clip.sampleCount, samplesPerBucket: shared.settings.editor.peaks.samplesPerBucket };
    const speechIdentity: SpeechIdentity = { audioSha256: clip.audioSha256, sampleRateHz: clip.sampleRateHz, sampleCount: clip.sampleCount, frameSamples, thresholdDbfs: shared.settings.editor.speech.thresholdDbfs, minSilenceMs: shared.settings.editor.speech.minSilenceMs, minSpeechMs: shared.settings.editor.speech.minSpeechMs };
    return { ...shared, story, clip, storyDirectory, cacheDirectory: join(storyDirectory, "cache"), peaksPath: join(storyDirectory, "cache", "peaks.json"), peaksIdentity, speechPath: join(storyDirectory, "cache", "speech.json"), speechIdentity, elements, words };
  });
}

/** The shared settings and one verified story, for the CLIs. The story must be listed; anything else is NotFound naming what is. */
export function loadEditorContext(options: EditorShared & { readonly storyId: string }): Effect.Effect<EditorContext, AnimatorError | AnimatorError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const stories = yield* listStories(options);
    if (!stories.some(s => s.id === options.storyId)) return yield* fail("NotFound", `No story ${options.storyId} under ${options.storiesDirectory}; stories: ${stories.map(s => s.id).join(", ")}.`);
    return yield* openStory(options, options.storyId);
  });
}

/** The shared settings, the story listing taken once at start, and a lazy per-story cache of verified contexts. Stories added on disk later need a restart. */
export function loadEditorLibrary(shared: EditorShared): Effect.Effect<EditorLibrary, AnimatorError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const stories = yield* listStories(shared);
    const sessions = new Map<string, OpenStory>();
    const locks = new Map(stories.map(s => [s.id, Semaphore.makeUnsafe(1)] as const));
    const open = (storyId: string | undefined) => {
      const lock = storyId === undefined ? undefined : locks.get(storyId);
      if (lock === undefined) return fail("NotFound", `No such story: ${storyId ?? ""}.`);
      return lock.withPermits(1)(Effect.gen(function* () {
        const hit = sessions.get(storyId!);
        if (hit !== undefined) return hit;
        const ctx = yield* openStory(shared, storyId!);
        const session: OpenStory = { ctx, caches: makeCaches(ctx) };
        sessions.set(storyId!, session);
        return session;
      }));
    };
    return { ...shared, stories, open };
  });
}

const json = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status, headers: { "cache-control": "no-cache" } });
const errorJson = (status: number, code: string, message: string) => json({ code, message }, status);
/** Every route answers JSON `{ code, message }` on failure; the status follows who is at fault. Decisions from the client are 400, invalid files on disk are 500. */
function errorResponse(error: unknown, options: { readonly decisionsFromClient?: boolean } = {}): HttpServerResponse.HttpServerResponse {
  if (error instanceof AnimatorError) {
    const byModule: Readonly<Record<string, Readonly<Record<string, number>>>> = {
      editor: { InvalidConfig: 500, InvalidRequest: 400, PayloadTooLarge: 413, NotFound: 404, PeaksFailed: 500, IoFailed: 500 },
      timing: { InvalidRequest: 400, InvalidTiming: 500, IdentityMismatch: 409, IoFailed: 500 },
      timeline: { InvalidConfig: 500, InvalidRequest: 400, InvalidRecord: 500, InvalidDecisions: options.decisionsFromClient ? 400 : 500, IdentityMismatch: 409, RecordExists: 409, IoFailed: 500 },
      map: { NotFound: 404, InvalidMap: 500, IdentityMismatch: 409, IoFailed: 500 },
      descriptions: { InvalidRequest: 400, InvalidDescriptions: 500, IdentityMismatch: 409, TakeExists: 409, IoFailed: 500 },
    };
    return errorJson(byModule[error.module]?.[error.code] ?? 500, error.code, error.message);
  }
  if (error instanceof Multipart.MultipartError) {
    const tag = error.reason._tag;
    if (tag === "FileTooLarge" || tag === "BodyTooLarge" || tag === "FieldTooLarge" || tag === "TooManyParts") return errorJson(413, "PayloadTooLarge", `Upload rejected: ${tag}.`);
    return errorJson(tag === "Parse" ? 400 : 500, tag === "Parse" ? "InvalidRequest" : "IoFailed", `Multipart body rejected: ${tag}.`);
  }
  return errorJson(500, "InternalError", "Unexpected server error.");
}
const handle = <E, R>(effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>, options?: { readonly decisionsFromClient?: boolean }) =>
  effect.pipe(Effect.catch(e => Effect.succeed(errorResponse(e, options))));

/** Collect a request body with a hard byte ceiling, checked before and while reading. */
function readBody(request: HttpServerRequest.HttpServerRequest, limit: number) {
  return Effect.gen(function* () {
    const declared = Number(request.headers["content-length"] ?? "0");
    if (declared > limit) return yield* fail("PayloadTooLarge", `Body exceeds the ${limit}-byte limit.`);
    const chunks: Uint8Array[] = [];
    let length = 0;
    yield* request.stream.pipe(
      Stream.mapError(() => editorError({ code: "InvalidRequest", message: "Cannot read the request body." })),
      Stream.runForEach(chunk => { length += chunk.byteLength; if (length > limit) return fail("PayloadTooLarge", `Body exceeds the ${limit}-byte limit.`); chunks.push(chunk); return Effect.void; }));
    return Buffer.concat(chunks, length);
  });
}
const imageUrl = (storyId: string) => (record: ShotRecord) => record.imagePath === undefined ? record : { ...record, imageUrl: `/api/stories/${storyId}/shots/${record.id}/image` };
/** A JSON object body, parsed; anything else is a 400. */
function readJsonObject(request: HttpServerRequest.HttpServerRequest, limit: number) {
  return Effect.gen(function* () {
    const bytes = yield* readBody(request, limit);
    const body = yield* Effect.try({ try: () => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown, catch: () => editorError({ code: "InvalidRequest", message: "Body is not valid UTF-8 JSON." }) });
    if (typeof body !== "object" || body === null || Array.isArray(body)) return yield* fail("InvalidRequest", "Body must be a JSON object.");
    return body as Record<string, unknown>;
  });
}

/**
 * Router layer over every listed story. `GET /api/stories` lists them; everything else lives under `/api/stories/:storyId/`. A story is
 * verified on first open; its records, decisions, and timing overlays are reread on every request because scripts change them under us.
 */
export function makeEditorRoutes(library: EditorLibrary, options: EditorRouteOptions) {
  /** Resolve the story named in the path, then answer with it. An unknown id is a 404 before any file is touched. */
  const withStory = <E, R>(f: (s: OpenStory) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
    Effect.gen(function* () { const { storyId } = yield* HttpRouter.params; return yield* f(yield* library.open(storyId)); });
  const timeline = (ctx: EditorContext) => Effect.gen(function* () {
    const { wordStarts } = yield* loadTiming(ctx);
    const t = yield* loadVisualTimeline({ story: ctx.story, settings: ctx.settings.timeline, wordStarts });
    return { ...t, records: t.records.map(imageUrl(ctx.clip.storyId)) } satisfies TimelineResponse;
  });
  const storyJson = (ctx: EditorContext) => Effect.map(storyPayload(ctx), json);
  const number = (name: string, value: string | undefined) => {
    if (value === undefined) return Effect.succeed(undefined);
    const parsed = Number(value);
    return value.trim() === "" || !Number.isFinite(parsed) ? fail("InvalidRequest", `${name} must be a finite number.`) : Effect.succeed(parsed);
  };
  const sse = (event: string) => Sse.encoder.write({ _tag: "Event", event, id: undefined, data: JSON.stringify({ at: new Date().toISOString() }) });
  const ignoredChange = (ctx: EditorContext, path: string) => basename(path).startsWith(".") || path === ctx.cacheDirectory || path.startsWith(ctx.cacheDirectory + "/");
  const at = <P extends `/${string}`>(path: P) => `/api/stories/:storyId${path}` as const;
  const descriptions = (ctx: EditorContext) => loadSceneDescriptions({ story: ctx.story, maxBytes: ctx.settings.editor.limits.maxSceneDescriptionsBytes });
  /** One writer at a time per story appends a take (A63): each append rereads the file, so two at once would drop one. */
  const takeLocks = new Map<string, Semaphore.Semaphore>();
  const takeLock = (storyId: string) => { const hit = takeLocks.get(storyId); if (hit !== undefined) return hit; const made = Semaphore.makeUnsafe(1); takeLocks.set(storyId, made); return made; };
  const storyMap = (ctx: EditorContext) => loadStoryMap({ story: ctx.story, wordIds: ctx.words.map(w => w.id), maxBytes: ctx.settings.editor.limits.maxStoryMapBytes });
  /** The map as written, with each image given the URL of the route below (A62). */
  const servedMap = (storyId: string, loaded: LoadedStoryMap): StoryMapResponse => ({ ...loaded.map, subjects: loaded.map.subjects.map(({ images, ...subject }) => images === undefined ? subject
    : { ...subject, images: images.map((image, index) => ({ ...image, url: `/api/stories/${storyId}/map/subjects/${subject.id}/images/${index}` })) }) });

  const stories = HttpRouter.add("GET", "/api/stories", json({ stories: library.stories } satisfies StoriesResponse));
  const story = HttpRouter.add("GET", at("/story"), handle(withStory(s => storyJson(s.ctx))));
  const timelineRoute = HttpRouter.add("GET", at("/timeline"), handle(withStory(s => Effect.map(timeline(s.ctx), t => json(t)))));
  const decisions = HttpRouter.add("PUT", at("/decisions"), request => handle(withStory(({ ctx }) => Effect.gen(function* () {
    const body = yield* readJsonObject(request, ctx.settings.timeline.limits.maxDecisionsBytes);
    if (!("settings" in body) || !("shots" in body)) return yield* fail("InvalidRequest", "Body must be a JSON object with settings and shots.");
    const { wordStarts } = yield* loadTiming(ctx);
    yield* writeDecisions({ story: ctx.story, settings: ctx.settings.timeline, decisions: { settings: body["settings"], shots: body["shots"] } as DecisionsBody, wordStarts });
    return json(yield* timeline(ctx));
  })), { decisionsFromClient: true }));
  const wordTiming = HttpRouter.add("PUT", at("/word-timing"), request => handle(withStory(({ ctx }) => Effect.gen(function* () {
    const body = yield* readJsonObject(request, ctx.settings.timeline.limits.maxDecisionsBytes);
    if (!("words" in body)) return yield* fail("InvalidRequest", "Body must be a JSON object with words.");
    yield* writeManualTiming(ctx, body["words"] as TimingEntries);
    return yield* storyJson(ctx);
  }))));
  const align = HttpRouter.add("POST", at("/word-timing/align"), request => handle(withStory(({ ctx, caches }) => Effect.gen(function* () {
    const body = yield* readJsonObject(request, 4096);
    const { startSample, endSample, wholeClip } = body;
    if (typeof startSample !== "number" || typeof endSample !== "number" || (wholeClip !== undefined && typeof wholeClip !== "boolean")) return yield* fail("InvalidRequest", "Body must hold numeric startSample and endSample and an optional boolean wholeClip.");
    const report = yield* alignTiming(ctx, caches, { range: { startSample, endSample }, wholeClip: wholeClip === true, dryRun: false, producer: options.producer });
    return json({ report, story: yield* storyPayload(ctx) });
  }))));
  const speech = HttpRouter.add("GET", at("/speech"), handle(withStory(s => Effect.map(s.caches.speech, json))));
  const shots = HttpRouter.add("POST", at("/shots"), request => handle(withStory(({ ctx }) => Effect.gen(function* () {
    const persisted = yield* request.multipart.pipe(
      Effect.provideService(Multipart.MaxFileSize, ctx.settings.timeline.limits.maxImageBytes),
      Effect.provideService(Multipart.MaxParts, MAX_MULTIPART_PARTS),
      Effect.provideService(HttpIncomingMessage.MaxBodySize, FileSystem.Size(ctx.settings.editor.limits.maxUploadBytes)));
    const text = (name: string) => {
      const value = persisted[name];
      return value === undefined || typeof value === "string" ? Effect.succeed(value) : fail("InvalidRequest", `Field ${name} must appear once as text.`);
    };
    const image = persisted["image"];
    let imageSourcePath: string | undefined;
    if (image !== undefined) {
      if (typeof image === "string" || image.length !== 1 || typeof image[0] === "string") return yield* fail("InvalidRequest", "Field image must be exactly one file.");
      const file = image[0]!;
      if (imageContentType(file.name) === undefined) return yield* fail("InvalidRequest", `Image must be a .png, .jpg, .jpeg, or .webp file, not ${JSON.stringify(file.name)}.`);
      imageSourcePath = file.path;
    }
    const mode = yield* text("mode");
    if (!Schema.is(ShotMode)(mode)) return yield* fail("InvalidRequest", `mode must be one of ${ShotMode.literals.join(", ")}.`);
    const trackId = yield* text("trackId");
    const [startSample, startSeconds, label, prompt, notes] = [yield* number("startSample", yield* text("startSample")), yield* number("startSeconds", yield* text("startSeconds")), yield* text("label"), yield* text("prompt"), yield* text("notes")];
    const record = yield* addShot({ story: ctx.story, settings: ctx.settings.timeline, mode, producer: options.producer,
      ...(trackId !== undefined ? { trackId } : {}),
      ...(startSample !== undefined ? { startSample } : {}), ...(startSeconds !== undefined ? { startSeconds } : {}),
      ...(label !== undefined ? { label } : {}), ...(prompt !== undefined ? { prompt } : {}), ...(notes !== undefined ? { notes } : {}),
      ...(imageSourcePath !== undefined ? { imageSourcePath } : {}) });
    return json(imageUrl(ctx.clip.storyId)(record), 201);
  }))));
  const image = HttpRouter.add("GET", at("/shots/:id/image"), handle(withStory(({ ctx }) => Effect.gen(function* () {
    const notFound = editorError({ code: "NotFound", message: "No image for that shot." });
    const { id } = yield* HttpRouter.params;
    if (id === undefined || !isUlid(id)) return yield* Effect.fail(notFound);
    const directory = join(ctx.storyDirectory, "shots", id);
    const bytes = yield* read(join(directory, "record.json"), ctx.settings.timeline.limits.maxRecordBytes).pipe(Effect.mapError(() => notFound));
    const record = yield* decode(ShotRecord, bytes, "NotFound", id).pipe(Effect.mapError(() => notFound));
    if (record.id !== id || record.imagePath === undefined) return yield* Effect.fail(notFound);
    const type = imageContentType(record.imagePath);
    if (type === undefined) return yield* Effect.fail(notFound);
    return yield* HttpServerResponse.file(join(directory, record.imagePath), { headers: { "content-type": type, "cache-control": "no-cache" } }).pipe(Effect.mapError(() => notFound));
  }))));
  const audio = HttpRouter.add("*", at("/audio"), request => handle(withStory(({ ctx }) => Effect.gen(function* () {
    if (request.method !== "GET" && request.method !== "HEAD") return HttpServerResponse.empty({ status: 405, headers: { allow: "GET, HEAD" } });
    const fs = yield* FileSystem.FileSystem;
    const path = ctx.story.paths.audioPath;
    const size = Number((yield* fs.stat(path)).size);
    const headers = { "accept-ranges": "bytes", "content-type": "audio/flac", "cache-control": "no-cache" };
    // Range applies to GET only (RFC 9110); with no validator to compare, an If-Range condition never matches and the full file is sent.
    const range = request.method === "GET" && request.headers["if-range"] === undefined ? parseRange(request.headers["range"], size) : null;
    if (range === "unsatisfiable") return HttpServerResponse.empty({ status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    if (range === null) return yield* HttpServerResponse.file(path, { headers });
    return yield* HttpServerResponse.file(path, { status: 206, offset: range.offset, bytesToRead: range.length, headers: { ...headers, "content-range": `bytes ${range.offset}-${range.offset + range.length - 1}/${size}` } });
  }))));
  const peaks = HttpRouter.add("GET", at("/peaks"), handle(withStory(s => Effect.map(s.caches.peaks, json))));
  const events = HttpRouter.add("GET", at("/events"), handle(withStory(({ ctx }) => Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    // A watcher failure ends the stream; EventSource reconnects and receives a fresh `ready`.
    const changes = fs.watch(ctx.storyDirectory, { recursive: true }).pipe(Stream.filter(e => !ignoredChange(ctx, e.path)), Stream.debounce(Duration.millis(ctx.settings.editor.watch.debounceMs)), Stream.map(() => sse("timeline-changed")), Stream.catchCause(() => Stream.empty));
    const heartbeats = Stream.tick(HEARTBEAT).pipe(Stream.map(() => ": heartbeat\n\n"));
    const body = Stream.make(sse("ready")).pipe(Stream.concat(Stream.merge(changes, heartbeats)), Stream.encodeText);
    return HttpServerResponse.stream(body, { contentType: "text/event-stream", headers: { "cache-control": "no-cache", "x-accel-buffering": "no" } });
  }))));
  const map = HttpRouter.add("GET", at("/map"), handle(withStory(({ ctx }) => Effect.map(storyMap(ctx), loaded => json(servedMap(ctx.clip.storyId, loaded))))));
  const mapImage = HttpRouter.add("GET", at("/map/subjects/:subjectId/images/:index"), handle(withStory(({ ctx }) => Effect.gen(function* () {
    const { subjectId, index } = yield* HttpRouter.params;
    const notFound = editorError({ code: "NotFound", message: "No such story map image." });
    const loaded = yield* storyMap(ctx);
    const image = loaded.images.find(i => i.subjectId === subjectId && String(i.index) === index);
    if (image === undefined) return yield* Effect.fail(notFound);
    return yield* HttpServerResponse.file(image.path, { headers: { "content-type": image.contentType, "cache-control": "no-cache" } }).pipe(Effect.mapError(() => notFound));
  }))));
  const sceneDescriptions = HttpRouter.add("GET", at("/scene-descriptions"), handle(withStory(({ ctx }) => Effect.map(descriptions(ctx), takes => json({ takes } satisfies SceneDescriptionsResponse)))));
  /** A writer records one description take for a beat (A63): the body is the take's fields, the server adds id, words, time, and producer, and answers 201 with the take as recorded. */
  const sceneDescriptionTake = HttpRouter.add("POST", at("/scene-descriptions"), request => handle(withStory(({ ctx }) => takeLock(ctx.clip.storyId).withPermits(1)(Effect.gen(function* () {
    const body = yield* readJsonObject(request, ctx.settings.editor.limits.maxSceneDescriptionsBytes);
    const take = yield* Schema.decodeUnknownEffect(SceneDescriptionTakeBody, { onExcessProperty: "error" })(body).pipe(Effect.mapError(e => editorError({ code: "InvalidRequest", message: `Body must be a take with sectionId, model, text, and optional prompt and notes. ${e.message.replace(/\s+/g, " ")}` })));
    const loaded = yield* storyMap(ctx);
    const recorded = yield* addSceneDescriptionTake({ story: ctx.story, maxBytes: ctx.settings.editor.limits.maxSceneDescriptionsBytes, take, sections: loaded.map.sections, producer: options.producer });
    return json(recorded, 201);
  })))));
  const apiFallback = HttpRouter.add("*", "/api/*", errorJson(404, "NotFound", "No such API route."));
  const root = options.staticDirectory === undefined
    ? HttpRouter.add("GET", "/", HttpServerResponse.text(`animator-v2 editor server: ${library.stories.length} stories under ${library.storiesDirectory}.\nNo static client directory was given. API routes: /api/stories, then under /api/stories/:storyId: /story /timeline /decisions /word-timing /word-timing/align /shots /shots/:id/image /map /map/subjects/:subjectId/images/:index /scene-descriptions /audio /peaks /speech /events\n`))
    : HttpStaticServer.layer({ root: resolve(options.staticDirectory), index: "index.html", spa: true, cacheControl: "no-cache" });
  return Layer.mergeAll(stories, story, timelineRoute, decisions, wordTiming, align, speech, shots, image, map, mapImage, sceneDescriptions, sceneDescriptionTake, audio, peaks, events, apiFallback, root);
}
