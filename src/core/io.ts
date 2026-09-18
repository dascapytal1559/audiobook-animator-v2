import { randomBytes } from "node:crypto";
import { basename, dirname, extname, join } from "node:path";
import { Effect, FileSystem, Option, Schema } from "effect";
import { AnimatorError, errorsOf } from "./error.js";

/** Failures of the shared readers and writers. Modules map these onto their own error codes at the boundary. */
export type IoCode = "IoFailed" | "InvalidJson" | "SchemaMismatch";
const errors = errorsOf<"core", IoCode>("core");
/** A core failure: the shared AnimatorError with this module's code union. */
export const ioError = errors.make;
export const isIoError = errors.is;
const fail = (code: IoCode, path: string, message: string) => Effect.fail(ioError({ code, path, message }));

/** Read a regular file of at most `limit` bytes on one handle, failing if it grows, shrinks, or is touched while being read. */
export function readBounded(path: string, limit: number): Effect.Effect<Buffer, AnimatorError, FileSystem.FileSystem> {
  return Effect.scoped(Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* fs.open(path, { flag: "r" });
    const before = yield* file.stat;
    if (before.type !== "File" || before.size > BigInt(limit)) return yield* fail("IoFailed", path, `Input is not a bounded regular file: ${path}.`);
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const chunk = yield* file.readAlloc(Math.min(65_536, limit - length + 1));
      if (Option.isNone(chunk)) break;
      length += chunk.value.byteLength;
      if (length > limit) return yield* fail("IoFailed", path, `Input exceeds its configured byte limit: ${path}.`);
      chunks.push(chunk.value);
    }
    const after = yield* file.stat;
    if (before.size !== BigInt(length) || after.size !== before.size
      || Option.getOrNull(before.mtime)?.getTime() !== Option.getOrNull(after.mtime)?.getTime()) {
      return yield* fail("IoFailed", path, `Input changed while being read: ${path}.`);
    }
    return Buffer.concat(chunks, length);
  })).pipe(Effect.mapError(error => isIoError(error) ? error : ioError({ code: "IoFailed", path, message: `Cannot read input: ${path}.` })));
}

/** Parse UTF-8 JSON and decode it with `schema`. `strict` rejects unknown keys. `path` names the input in messages; it may be a description for in-memory bytes. */
export function decodeJson<S extends Schema.Top>(schema: S, bytes: Uint8Array, path: string, strict: boolean): Effect.Effect<S["Type"], AnimatorError, S["DecodingServices"]> {
  return Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: () => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown,
      catch: () => ioError({ code: "InvalidJson", path, message: `Input is not valid UTF-8 JSON: ${path}.` }),
    });
    return yield* Schema.decodeUnknownEffect(schema, { onExcessProperty: strict ? "error" : "ignore" })(raw).pipe(
      Effect.mapError(e => ioError({ code: "SchemaMismatch", path, message: `Input does not match the required schema: ${path}. ${e.message.replace(/\s+/g, " ")}` })),
    );
  });
}

/** Write bytes to a sibling temp file, then rename into place so readers never observe a partial file. The temp file is removed if the rename fails. */
export function writeAtomic(path: string, bytes: Uint8Array): Effect.Effect<void, AnimatorError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
    yield* fs.writeFile(temp, bytes, { flag: "wx" });
    yield* fs.rename(temp, path).pipe(Effect.onError(() => fs.remove(temp).pipe(Effect.ignore)));
  }).pipe(Effect.mapError(e => ioError({ code: "IoFailed", path, message: `Cannot write ${path}: ${e.message}` })));
}

/** Pretty JSON with a trailing newline, the on-disk form of every artifact this repository writes. */
export const encodeJson = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

/** The image files the editor serves, by extension: the content type, or undefined for anything else. */
const IMAGE_TYPES: Readonly<Record<string, string>> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
export const imageContentType = (path: string): string | undefined => IMAGE_TYPES[extname(path).toLowerCase()];
