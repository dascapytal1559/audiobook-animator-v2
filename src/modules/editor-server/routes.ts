import { basename, dirname, extname, join, resolve } from "node:path";
import { Duration, Effect, FileSystem, Layer, Schema, Stream } from "effect";
import { Sse } from "effect/unstable/encoding";
import { HttpIncomingMessage, HttpRouter, type HttpServerRequest, HttpServerResponse, HttpStaticServer, Multipart } from "effect/unstable/http";
import { loadStoryContext, StoryPlanningError, type StoryContext } from "../story-planning/index.js";
import { readBounded } from "../story-planning/io.js";
import { addShot, type ClipIdentity, isUlid, loadVisualTimeline, ShotMode, ShotRecord, VisualTimelineConfig, VisualTimelineError, writeDecisions, type DecisionsBody } from "../visual-timeline/index.js";
import { type TimingEntries, WordTimingError } from "../word-timing/index.js";
import type { ChunkElement } from "./chunks.js";
import { EditorServerConfig, EditorServerError } from "./contracts.js";
import type { PeaksIdentity, SpeechIdentity } from "./peaks.js";
import { parseRange } from "./range.js";
import { alignTiming, loadTiming, makeCaches, storyPayload, writeManualTiming } from "./timing.js";
type Code = EditorServerError["code"];
const fail = (code: Code, message: string) => Effect.fail(new EditorServerError({ code, message }));
const IMAGE_TYPES: Readonly<Record<string, string>> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const HEARTBEAT = Duration.seconds(15);
const MAX_MULTIPART_PARTS = 16;

/** A transcript word with its ORIGINAL provider timing on the clip clock. Effective timing is merged per request by `loadTiming`. */
export type EditorWord = { readonly id: string; readonly value: string; readonly startSample: number; readonly endSample: number };
export type EditorContext = {
  readonly configPath: string; readonly config: EditorServerConfig;
  readonly timelineConfigPath: string; readonly timelineConfig: VisualTimelineConfig;
  readonly story: StoryContext; readonly clip: ClipIdentity; readonly storyDirectory: string;
  readonly peaksPath: string; readonly peaksIdentity: PeaksIdentity; readonly speechPath: string; readonly speechIdentity: SpeechIdentity;
  /** Transcript elements (words with original timing, plus punctuation) in order, for chunking. */
  readonly elements: ReadonlyArray<ChunkElement>;
  readonly words: ReadonlyArray<EditorWord>;
};
export type EditorRouteOptions = { readonly producer: { readonly name: string; readonly version: string }; readonly staticDirectory?: string };

const read = (path: string, limit: number) => readBounded(path, limit).pipe(Effect.mapError(e => new EditorServerError({ code: "IoFailed", message: e.message })));
function decode<S extends Schema.Top>(schema: S, bytes: Uint8Array, code: Code, path: string) {
  return Effect.gen(function* () {
    const raw = yield* Effect.try({ try: () => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown, catch: () => new EditorServerError({ code, message: `Input is not valid UTF-8 JSON: ${path}.` }) });
    return yield* Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(raw).pipe(Effect.mapError(e => new EditorServerError({ code, message: `Input does not match the required schema: ${path}. ${e.message.replace(/\s+/g, " ")}` })));
  });
}

/** Both configs, the verified story loaded once, the words converted to clip samples, and the cache identities. The story directory is watched for changes. */
export function loadEditorContext(options: { readonly configPath: string }): Effect.Effect<EditorContext, EditorServerError | StoryPlanningError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    if (!options.configPath || options.configPath.includes("\0")) return yield* fail("InvalidConfig", "Supply an explicit configuration path.");
    const configPath = resolve(options.configPath);
    const config = yield* decode(EditorServerConfig, yield* read(configPath, 65_536), "InvalidConfig", configPath);
    const timelineConfigPath = resolve(dirname(configPath), config.visualTimelineConfigPath);
    const timelineConfig = yield* decode(VisualTimelineConfig, yield* read(timelineConfigPath, 65_536), "InvalidConfig", timelineConfigPath);
    const story = yield* loadStoryContext({ configPath: resolve(dirname(timelineConfigPath), timelineConfig.storyPlanningConfigPath) });
    const clip: ClipIdentity = { bookId: story.bookId, storyId: story.story.id, audioSha256: story.story.audioSha256, transcriptSha256: story.story.transcriptSha256, sampleRateHz: story.story.sampleRateHz, sampleCount: story.story.sampleCount };
    const { storyDirectory } = story;
    const toSample = (seconds: number) => Math.min(clip.sampleCount, Math.max(0, Math.round(seconds * clip.sampleRateHz)));
    const elements: ReadonlyArray<ChunkElement> = story.transcript.elements.map(e => e.kind === "word"
      ? { kind: "word", id: e.id, value: e.value, startSample: toSample(e.approximateSegmentStartSeconds), endSample: toSample(e.approximateSegmentEndSeconds) }
      : { kind: "punctuation", value: e.value });
    const words = elements.flatMap(e => e.kind === "word" ? [{ id: e.id, value: e.value, startSample: e.startSample, endSample: e.endSample }] : []);
    const frameSamples = Math.round((config.speech.frameMs / 1000) * clip.sampleRateHz);
    if (frameSamples < 1) return yield* fail("InvalidConfig", `speech.frameMs ${config.speech.frameMs} is shorter than one sample at ${clip.sampleRateHz} Hz in ${configPath}.`);
    const peaksIdentity: PeaksIdentity = { audioSha256: clip.audioSha256, sampleRateHz: clip.sampleRateHz, sampleCount: clip.sampleCount, samplesPerBucket: config.peaks.samplesPerBucket };
    const speechIdentity: SpeechIdentity = { audioSha256: clip.audioSha256, sampleRateHz: clip.sampleRateHz, sampleCount: clip.sampleCount, frameSamples, thresholdDbfs: config.speech.thresholdDbfs, minSilenceMs: config.speech.minSilenceMs, minSpeechMs: config.speech.minSpeechMs };
    return { configPath, config, timelineConfigPath, timelineConfig, story, clip, storyDirectory, peaksPath: join(storyDirectory, "peaks.json"), peaksIdentity, speechPath: join(storyDirectory, "speech.json"), speechIdentity, elements, words };
  });
}

const json = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status, headers: { "cache-control": "no-cache" } });
const errorJson = (status: number, code: string, message: string) => json({ code, message }, status);
/** Every route answers JSON `{ code, message }` on failure; the status follows who is at fault. Decisions from the client are 400, invalid files on disk are 500. */
function errorResponse(error: unknown, options: { readonly decisionsFromClient?: boolean } = {}): HttpServerResponse.HttpServerResponse {
  if (error instanceof EditorServerError) {
    const status: Record<Code, number> = { InvalidConfig: 500, InvalidRequest: 400, PayloadTooLarge: 413, NotFound: 404, PeaksFailed: 500, IoFailed: 500 };
    return errorJson(status[error.code], error.code, error.message);
  }
  if (error instanceof WordTimingError) {
    const status: Record<WordTimingError["code"], number> = { InvalidRequest: 400, InvalidTiming: 500, IdentityMismatch: 409, IoFailed: 500 };
    return errorJson(status[error.code], error.code, error.message);
  }
  if (error instanceof VisualTimelineError) {
    const status: Record<VisualTimelineError["code"], number> = { InvalidConfig: 500, InvalidRequest: 400, InvalidRecord: 500, InvalidDecisions: options.decisionsFromClient ? 400 : 500, IdentityMismatch: 409, RecordExists: 409, IoFailed: 500 };
    return errorJson(status[error.code], error.code, error.message);
  }
  if (error instanceof StoryPlanningError) return errorJson(500, error.code, error.message);
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
      Stream.mapError(() => new EditorServerError({ code: "InvalidRequest", message: "Cannot read the request body." })),
      Stream.runForEach(chunk => { length += chunk.byteLength; if (length > limit) return fail("PayloadTooLarge", `Body exceeds the ${limit}-byte limit.`); chunks.push(chunk); return Effect.void; }));
    return Buffer.concat(chunks, length);
  });
}
const imageUrl = (record: ShotRecord) => record.imagePath === undefined ? record : { ...record, imageUrl: `/api/shots/${record.id}/image` };
/** A JSON object body, parsed; anything else is a 400. */
function readJsonObject(request: HttpServerRequest.HttpServerRequest, limit: number) {
  return Effect.gen(function* () {
    const bytes = yield* readBody(request, limit);
    const body = yield* Effect.try({ try: () => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown, catch: () => new EditorServerError({ code: "InvalidRequest", message: "Body is not valid UTF-8 JSON." }) });
    if (typeof body !== "object" || body === null || Array.isArray(body)) return yield* fail("InvalidRequest", "Body must be a JSON object.");
    return body as Record<string, unknown>;
  });
}

/** Router layer for one verified story. The story is fixed at load; records, decisions, and timing overlays are reread on every request because scripts change them under us. */
export function makeEditorRoutes(ctx: EditorContext, options: EditorRouteOptions) {
  const timeline = Effect.gen(function* () {
    const { wordStarts } = yield* loadTiming(ctx);
    const t = yield* loadVisualTimeline({ configPath: ctx.timelineConfigPath, wordStarts });
    return { ...t, records: t.records.map(imageUrl) };
  });
  const caches = makeCaches(ctx);
  const storyJson = Effect.map(storyPayload(ctx), json);
  const number = (name: string, value: string | undefined) => {
    if (value === undefined) return Effect.succeed(undefined);
    const parsed = Number(value);
    return value.trim() === "" || !Number.isFinite(parsed) ? fail("InvalidRequest", `${name} must be a finite number.`) : Effect.succeed(parsed);
  };
  const sse = (event: string) => Sse.encoder.write({ _tag: "Event", event, id: undefined, data: JSON.stringify({ at: new Date().toISOString() }) });
  const ignoredChange = (path: string) => basename(path).startsWith(".") || path === ctx.peaksPath || path === ctx.speechPath;

  const story = HttpRouter.add("GET", "/api/story", handle(storyJson));
  const timelineRoute = HttpRouter.add("GET", "/api/timeline", handle(Effect.map(timeline, t => json(t))));
  const decisions = HttpRouter.add("PUT", "/api/decisions", request => handle(Effect.gen(function* () {
    const body = yield* readJsonObject(request, ctx.timelineConfig.limits.maxDecisionsBytes);
    if (!("settings" in body) || !("shots" in body)) return yield* fail("InvalidRequest", "Body must be a JSON object with settings and shots.");
    const { wordStarts } = yield* loadTiming(ctx);
    yield* writeDecisions({ configPath: ctx.timelineConfigPath, decisions: { settings: body["settings"], shots: body["shots"] } as DecisionsBody, wordStarts });
    return json(yield* timeline);
  }), { decisionsFromClient: true }));
  const wordTiming = HttpRouter.add("PUT", "/api/word-timing", request => handle(Effect.gen(function* () {
    const body = yield* readJsonObject(request, ctx.timelineConfig.limits.maxDecisionsBytes);
    if (!("words" in body)) return yield* fail("InvalidRequest", "Body must be a JSON object with words.");
    yield* writeManualTiming(ctx, body["words"] as TimingEntries);
    return yield* storyJson;
  })));
  const align = HttpRouter.add("POST", "/api/word-timing/align", request => handle(Effect.gen(function* () {
    const body = yield* readJsonObject(request, 4096);
    const { startSample, endSample, wholeClip } = body;
    if (typeof startSample !== "number" || typeof endSample !== "number" || (wholeClip !== undefined && typeof wholeClip !== "boolean")) return yield* fail("InvalidRequest", "Body must hold numeric startSample and endSample and an optional boolean wholeClip.");
    const report = yield* alignTiming(ctx, caches, { range: { startSample, endSample }, wholeClip: wholeClip === true, dryRun: false, producer: options.producer });
    return json({ report, story: yield* storyPayload(ctx) });
  })));
  const speech = HttpRouter.add("GET", "/api/speech", handle(Effect.map(caches.speech, json)));
  const shots = HttpRouter.add("POST", "/api/shots", request => handle(Effect.gen(function* () {
    const persisted = yield* request.multipart.pipe(
      Effect.provideService(Multipart.MaxFileSize, ctx.timelineConfig.limits.maxImageBytes),
      Effect.provideService(Multipart.MaxParts, MAX_MULTIPART_PARTS),
      Effect.provideService(HttpIncomingMessage.MaxBodySize, FileSystem.Size(ctx.config.limits.maxUploadBytes)));
    const text = (name: string) => {
      const value = persisted[name];
      return value === undefined || typeof value === "string" ? Effect.succeed(value) : fail("InvalidRequest", `Field ${name} must appear once as text.`);
    };
    const image = persisted["image"];
    let imageSourcePath: string | undefined;
    if (image !== undefined) {
      if (typeof image === "string" || image.length !== 1 || typeof image[0] === "string") return yield* fail("InvalidRequest", "Field image must be exactly one file.");
      const file = image[0]!;
      if (IMAGE_TYPES[extname(file.name).toLowerCase()] === undefined) return yield* fail("InvalidRequest", `Image must be a .png, .jpg, .jpeg, or .webp file, not ${JSON.stringify(file.name)}.`);
      imageSourcePath = file.path;
    }
    const mode = yield* text("mode");
    if (mode !== "graphic-illustration" && mode !== "poetic-abstraction") return yield* fail("InvalidRequest", `mode must be one of ${ShotMode.literals.join(", ")}.`);
    const [startSample, startSeconds, label, prompt, notes] = [yield* number("startSample", yield* text("startSample")), yield* number("startSeconds", yield* text("startSeconds")), yield* text("label"), yield* text("prompt"), yield* text("notes")];
    const record = yield* addShot({ configPath: ctx.timelineConfigPath, mode, producer: options.producer,
      ...(startSample !== undefined ? { startSample } : {}), ...(startSeconds !== undefined ? { startSeconds } : {}),
      ...(label !== undefined ? { label } : {}), ...(prompt !== undefined ? { prompt } : {}), ...(notes !== undefined ? { notes } : {}),
      ...(imageSourcePath !== undefined ? { imageSourcePath } : {}) });
    return json(imageUrl(record), 201);
  })));
  const image = HttpRouter.add("GET", "/api/shots/:id/image", handle(Effect.gen(function* () {
    const notFound = new EditorServerError({ code: "NotFound", message: "No image for that shot." });
    const { id } = yield* HttpRouter.params;
    if (id === undefined || !isUlid(id)) return yield* Effect.fail(notFound);
    const directory = join(ctx.storyDirectory, "shots", id);
    const bytes = yield* read(join(directory, "record.json"), ctx.timelineConfig.limits.maxRecordBytes).pipe(Effect.mapError(() => notFound));
    const record = yield* decode(ShotRecord, bytes, "NotFound", id).pipe(Effect.mapError(() => notFound));
    if (record.id !== id || record.imagePath === undefined) return yield* Effect.fail(notFound);
    const type = IMAGE_TYPES[extname(record.imagePath).toLowerCase()];
    if (type === undefined) return yield* Effect.fail(notFound);
    return yield* HttpServerResponse.file(join(directory, record.imagePath), { headers: { "content-type": type, "cache-control": "no-cache" } }).pipe(Effect.mapError(() => notFound));
  })));
  const audio = HttpRouter.add("*", "/api/audio", request => handle(Effect.gen(function* () {
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
  })));
  const peaks = HttpRouter.add("GET", "/api/peaks", handle(Effect.map(caches.peaks, json)));
  const events = HttpRouter.add("GET", "/api/events", Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    // A watcher failure ends the stream; EventSource reconnects and receives a fresh `ready`.
    const changes = fs.watch(ctx.storyDirectory, { recursive: true }).pipe(Stream.filter(e => !ignoredChange(e.path)), Stream.debounce(Duration.millis(ctx.config.watch.debounceMs)), Stream.map(() => sse("timeline-changed")), Stream.catchCause(() => Stream.empty));
    const heartbeats = Stream.tick(HEARTBEAT).pipe(Stream.map(() => ": heartbeat\n\n"));
    const body = Stream.make(sse("ready")).pipe(Stream.concat(Stream.merge(changes, heartbeats)), Stream.encodeText);
    return HttpServerResponse.stream(body, { contentType: "text/event-stream", headers: { "cache-control": "no-cache", "x-accel-buffering": "no" } });
  }));
  const apiFallback = HttpRouter.add("*", "/api/*", errorJson(404, "NotFound", "No such API route."));
  const root = options.staticDirectory === undefined
    ? HttpRouter.add("GET", "/", HttpServerResponse.text(`animator-v2 editor server for ${ctx.clip.bookId}/${ctx.clip.storyId}.\nNo static client directory was given. API routes: /api/story /api/timeline /api/decisions /api/word-timing /api/word-timing/align /api/shots /api/shots/:id/image /api/audio /api/peaks /api/speech /api/events\n`))
    : HttpStaticServer.layer({ root: resolve(options.staticDirectory), index: "index.html", spa: true, cacheControl: "no-cache" });
  return Layer.mergeAll(story, timelineRoute, decisions, wordTiming, align, speech, shots, image, audio, peaks, events, apiFallback, root);
}
