import { open, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { NodeRuntime } from "@effect/platform-node";
import { Console, Effect } from "effect";

/** A single HTTP byte range. Multipart ranges are deliberately outside this demo server. */
function byteRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || size === 0 || (match[1] === "" && match[2] === "")) return null;
  const length = BigInt(size);
  if (match[1] === "") {
    const suffixLength = BigInt(match[2]!);
    if (suffixLength === 0n) return null;
    return { start: Number(suffixLength >= length ? 0n : length - suffixLength), end: size - 1 };
  }
  const start = BigInt(match[1]!);
  const end = match[2] === "" ? length - 1n : BigInt(match[2]!);
  if (start >= length || end < start) return null;
  return { start: Number(start), end: Number(end >= length ? length - 1n : end) };
}

async function respond(directory: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD", "Content-Length": 0 });
    response.end();
    return;
  }
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  // Never turn the requested URL into a filesystem path or expose directory listings.
  const filename = pathname === "/" || pathname === "/demo.html" ? "demo.html"
    : pathname === "/input.flac" ? "input.flac" : null;
  if (filename === null) {
    response.writeHead(404, { "Content-Length": 0 });
    response.end();
    return;
  }
  const file = await open(join(directory, filename), "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || !Number.isSafeInteger(info.size)) throw new Error("The demo resource is not a supported regular file.");
    const headers: Record<string, string | number> = {
      "Accept-Ranges": "bytes",
      "Content-Type": filename === "input.flac" ? "audio/flac" : "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    // RFC 9110 applies Range to GET. HEAD describes the complete representation.
    // This server has no validators; an If-Range condition cannot match, so send the full file.
    const rangeHeader = request.method === "GET" && request.headers["if-range"] === undefined ? request.headers.range : undefined;
    const range = rangeHeader === undefined ? undefined : byteRange(rangeHeader, info.size);
    if (range === null) {
      response.writeHead(416, { ...headers, "Content-Range": `bytes */${info.size}`, "Content-Length": 0 });
      response.end();
      return;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? info.size - 1;
    headers["Content-Length"] = range === undefined ? info.size : end - start + 1;
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
    response.writeHead(range === undefined ? 200 : 206, headers);
    if (request.method === "HEAD" || info.size === 0) {
      response.end();
      return;
    }
    await pipeline(file.createReadStream({ start, end, autoClose: false }), response);
  } finally {
    await file.close();
  }
}

export async function startDemoServer(options: { readonly directory: string; readonly port: number }): Promise<{ server: Server; url: string }> {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error("Port must be an integer between 0 and 65535.");
  const directory = resolve(options.directory);
  for (const filename of ["demo.html", "input.flac"]) {
    if (!(await stat(join(directory, filename))).isFile()) throw new Error(`${filename} must be a regular file in the demo directory.`);
  }
  const server = createServer({ requestTimeout: 30_000, headersTimeout: 15_000, keepAliveTimeout: 5_000, maxHeaderSize: 16_384 }, (request, response) => {
    void respond(directory, request, response).catch((error: unknown) => {
      if (response.headersSent || response.destroyed) response.destroy();
      else {
        const missing = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
        response.writeHead(missing ? 404 : 500, { "Content-Length": 0 });
        response.end();
      }
    });
  });
  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: options.port }, () => {
      server.removeListener("error", reject);
      resolveListening();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The loopback server did not receive a TCP address.");
  return { server, url: `http://127.0.0.1:${address.port}/demo.html` };
}

export function stopDemoServer(server: Server): Promise<void> {
  return new Promise((resolveClosed) => {
    server.close(() => resolveClosed());
    server.closeAllConnections();
  });
}

const main = Effect.scoped(Effect.gen(function* () {
  const { values } = yield* Effect.try(() => parseArgs({ options: {
    directory: { type: "string" }, port: { type: "string" }, help: { type: "boolean" },
  }, strict: true, allowPositionals: false }));
  if (values.help) {
    yield* Console.log("Usage: node dist/demo-serve.js --directory data/demo/rev-ai --port 63618\nServes only demo.html and input.flac on 127.0.0.1, with single-byte-range support. Ctrl-C stops the server.");
    return;
  }
  if (!values.directory || !values.port || !/^\d+$/.test(values.port) || Number(values.port) < 1) {
    return yield* Effect.fail(new Error("Supply explicit --directory and --port (1–65535)."));
  }
  const directory = values.directory;
  const port = Number(values.port);
  const running = yield* Effect.acquireRelease(
    Effect.tryPromise(() => startDemoServer({ directory, port })),
    ({ server }) => Effect.promise(() => stopDemoServer(server)),
  );
  yield* Console.log(JSON.stringify({ url: running.url, directory: resolve(directory), byteRanges: "single" }));
  return yield* Effect.never;
}));

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main.pipe(Effect.catch((error) => Console.error(String(error)).pipe(
    Effect.andThen(Effect.sync(() => { process.exitCode = 1; })),
  )), NodeRuntime.runMain({ disableErrorReporting: true }));
}
