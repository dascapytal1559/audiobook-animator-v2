/** Crockford base32 alphabet without I, L, O, U. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 26 characters: 10 for a 48-bit millisecond timestamp (leading character therefore 0-7), 16 for 80 random bits. */
export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
/** Encode an explicit timestamp and 80-bit randomness; deterministic imports supply both. Minting with fresh randomness needs a random source and lives beside the writer. */
export function encodeUlid(timestamp: number, randomness: bigint): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp >= 2 ** 48) throw new RangeError("ULID timestamp must be an integer of at most 48 bits.");
  if (randomness < 0n || randomness >= 1n << 80n) throw new RangeError("ULID randomness must be an unsigned 80-bit integer.");
  let value = (BigInt(timestamp) << 80n) | randomness;
  let text = "";
  for (let i = 0; i < 26; i++) { text = ALPHABET[Number(value & 31n)] + text; value >>= 5n; }
  return text;
}
export const isUlid = (value: string): boolean => ULID_PATTERN.test(value);
