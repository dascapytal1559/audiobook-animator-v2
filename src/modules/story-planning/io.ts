import { Effect, FileSystem, Option, Schema } from "effect";
import { StoryPlanningError } from "./contracts.js";
const fail = (code: StoryPlanningError["code"], message: string) => Effect.fail(new StoryPlanningError({ code, message }));

/** Enforce the byte limit on one handle, including files that grow while being read. */
export function readBounded(path: string, limit: number) {
  return Effect.scoped(Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* fs.open(path, { flag: "r" });
    const before = yield* file.stat;
    if (before.type !== "File" || before.size > BigInt(limit)) return yield* fail("IoFailed", `Input is not a bounded regular file: ${path}.`);
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const chunk = yield* file.readAlloc(Math.min(65_536, limit - length + 1));
      if (Option.isNone(chunk)) break;
      length += chunk.value.byteLength;
      if (length > limit) return yield* fail("IoFailed", `Input exceeds its configured byte limit: ${path}.`);
      chunks.push(chunk.value);
    }
    const after = yield* file.stat;
    if (before.size !== BigInt(length) || after.size !== before.size
      || Option.getOrNull(before.mtime)?.getTime() !== Option.getOrNull(after.mtime)?.getTime()) {
      return yield* fail("IoFailed", `Input changed while being read: ${path}.`);
    }
    return Buffer.concat(chunks, length);
  })).pipe(Effect.mapError((error) => error instanceof StoryPlanningError ? error
    : new StoryPlanningError({ code: "IoFailed", message: `Cannot read input: ${path}.` })));
}

export function decode<S extends Schema.Top>(schema: S, bytes: Uint8Array, code: StoryPlanningError["code"], path: string, strict: boolean) {
  return Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: () => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown,
      catch: () => new StoryPlanningError({ code, message: `Input is not valid UTF-8 JSON: ${path}.` }),
    });
    return yield* Schema.decodeUnknownEffect(schema, { onExcessProperty: strict ? "error" : "ignore" })(raw).pipe(
      Effect.mapError(() => new StoryPlanningError({ code, message: `Input does not match the required schema: ${path}.` })),
    );
  });
}

