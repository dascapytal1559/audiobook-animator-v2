import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { Console, Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { loadEditorLibrary, makeEditorRoutes } from "./routes.js";
export { type Chunk, type ChunkBreakReason, type ChunkElement, computeChunks } from "@animator/domain";
export { EditorServerConfig, EditorServerError, PeaksFile, SpeechFile } from "./contracts.js";
export { computePeaksAndSpeech, type DecodeOptions, PeakAccumulator, type PeaksIdentity, readPeaksCache, readSpeechCache, type SpeechIdentity, writeCache } from "./peaks.js";
export { type AlignOptions, alignTiming, type Caches, loadTiming, makeCaches, type StoryPayload, storyPayload, timingPaths, writeManualTiming } from "./timing.js";
export { type ByteRange, parseRange } from "./range.js";
export { type EditorConfigContext, type EditorContext, type EditorLibrary, type EditorRouteOptions, type EditorWord, listStories, loadEditorConfig, loadEditorContext, loadEditorLibrary, makeEditorRoutes, openStory, type OpenStory, type StorySummary } from "./routes.js";

export type EditorServerOptions = {
  readonly configPath: string; readonly port: number; readonly staticDirectory?: string;
  readonly producer: { readonly name: string; readonly version: string };
};
/**
 * The whole server: the story listing taken once, the default story verified before listening (the others verify on first open), routes, and a
 * loopback-only Node listener. Launch it with `Layer.launch`; the URL goes to stderr once it listens.
 */
export function makeEditorServer(options: EditorServerOptions) {
  return Layer.unwrap(Effect.gen(function* () {
    const library = yield* loadEditorLibrary({ configPath: options.configPath });
    const { ctx } = yield* library.open(library.defaultStoryId);
    const routes = makeEditorRoutes(library, { producer: options.producer, ...(options.staticDirectory !== undefined ? { staticDirectory: options.staticDirectory } : {}) });
    const requestTimeout = library.config.limits.requestTimeoutMs;
    // Node's requestTimeout bounds receiving a request, not streaming a response, so the long-lived /events connection is unaffected.
    const listener = NodeHttpServer.layer(() => createServer({ requestTimeout, headersTimeout: Math.min(15_000, requestTimeout), keepAliveTimeout: 5_000, maxHeaderSize: 16_384 }), { host: "127.0.0.1", port: options.port });
    const announce = Layer.effectDiscard(HttpServer.addressFormattedWith(address => Console.error(`Editor server for ${library.stories.length} stories under ${library.storiesDirectory} listening at ${address} (default ${ctx.clip.bookId}/${ctx.clip.storyId})`)));
    return HttpRouter.serve(routes, { disableLogger: true, disableListenLog: true }).pipe(Layer.merge(announce), Layer.provide(listener));
  }));
}
