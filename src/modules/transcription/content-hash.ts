import { createHash } from "node:crypto";

/** Content identity shared by transcript imports and paired story artifacts. */
export const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
