import { randomBytes } from "node:crypto";
import { encodeUlid } from "@animator/domain";
export { encodeUlid, isUlid, ULID_PATTERN } from "@animator/domain";
/** A fresh ULID for now (or an explicit instant) with 80 random bits. */
export const mintUlid = (now: number = Date.now()) => encodeUlid(now, BigInt(`0x${randomBytes(10).toString("hex")}`));
