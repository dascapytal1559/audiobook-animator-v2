import { Schema } from "effect";

/**
 * The schema primitives every module builds its contracts from. Declared once here; a module never declares its own `Path` or `Positive`.
 * Where earlier per-module copies disagreed, the stricter form won: `Text` requires a non-space character, and `Path` is a `Text`.
 */

/** A non-empty string that is not only whitespace. */
export const Text = Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/\S/));
/** A file-system path: non-blank and free of NUL. Resolution rules belong to the caller. */
export const Path = Text.check(Schema.isPattern(/^[^\0]+$/));
/** A book or story id: lowercase, digits, hyphens, at most 101 characters; also the directory name. */
export const Id = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,100}$/));
/** A safe integer of at least 1: counts, limits, sample rates. */
export const Positive = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));
/** A safe integer of at least 0: sample positions, indexes, sizes that may be empty. */
export const NonNegative = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
/** A finite duration strictly above zero. */
export const PositiveSeconds = Schema.Finite.check(Schema.isGreaterThan(0));
/** A lowercase hex SHA-256 digest. */
export const Sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
/** ISO-8601 UTC instant with a Z suffix, as produced by Date#toISOString. */
export const IsoUtc = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/));
