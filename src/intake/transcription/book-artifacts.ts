import { randomUUID } from "node:crypto";
import { link, mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect } from "effect";
import { BookTranscriptionError } from "./book-contracts.js";

const hasCode = (error: unknown, code: string): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === code;

/** Read through one handle, enforcing the limit even if the file grows while being read. */
export function readBookArtifact(path: string, maxBytes: number) {
  return Effect.tryPromise({
    try: async (): Promise<Buffer | undefined> => {
      let handle;
      try { handle = await open(path, "r"); } catch (error) {
        if (hasCode(error, "ENOENT")) return undefined;
        throw error;
      }
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.size > maxBytes) throw new Error("Not a bounded regular file.");
        const parts: Buffer[] = [];
        let total = 0;
        while (true) {
          const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - total + 1));
          const { bytesRead } = await handle.read(buffer);
          if (bytesRead === 0) break;
          total += bytesRead;
          if (total > maxBytes) throw new Error("Read limit exceeded.");
          parts.push(buffer.subarray(0, bytesRead));
        }
        const after = await handle.stat();
        if (before.size !== total || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("Artifact changed while reading.");
        return Buffer.concat(parts, total);
      } finally { await handle.close(); }
    },
    catch: () => new BookTranscriptionError({ code: "ArtifactIoFailed", message: `Cannot read stable, bounded artifact ${path}.` }),
  });
}

/** Publish a complete file without replacing an existing artifact. Equal bytes are reusable. */
export function retainBookArtifact(path: string, bytes: Uint8Array, maxBytes: number) {
  return Effect.gen(function* () {
    if (bytes.byteLength > maxBytes) return yield* Effect.fail(new BookTranscriptionError({ code: "ArtifactIoFailed", message: `Artifact exceeds its configured write limit: ${path}.` }));
    const created = yield* Effect.tryPromise({
      try: async () => {
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          const handle = await open(temporary, "wx", 0o600);
          try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
          try { await link(temporary, path); } catch (error) {
            if (hasCode(error, "EEXIST")) return false;
            throw error;
          }
          const directory = await open(dirname(path), "r");
          try { await directory.sync(); } finally { await directory.close(); }
          return true;
        } finally { await rm(temporary, { force: true }); }
      },
      catch: () => new BookTranscriptionError({ code: "ArtifactIoFailed", message: `Cannot publish artifact ${path}.` }),
    });
    if (!created) {
      const previous = yield* readBookArtifact(path, maxBytes);
      if (!previous?.equals(bytes)) return yield* Effect.fail(new BookTranscriptionError({ code: "ArtifactMismatch", message: `Existing artifact differs: ${path}. Keep it and choose a separate artifact directory for a different source, job, configuration, or export.` }));
    }
  });
}

export const jsonBytes = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");

export function parseBookJson(bytes: Uint8Array, description: string) {
  return Effect.try({
    try: () => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown,
    catch: () => new BookTranscriptionError({ code: "InvalidTranscript", message: `${description} is not valid UTF-8 JSON. Any retained raw export remains unchanged.` }),
  });
}
