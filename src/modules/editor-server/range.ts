/** A satisfiable single byte range: `offset` is the first byte, `length` is at least 1. */
export type ByteRange = { readonly offset: number; readonly length: number };

/**
 * RFC 9110 §14.1.2 for a single `bytes=` range against a known size.
 * `null` means serve the whole representation (no header, another unit, invalid syntax, or several ranges, none of which this server supports);
 * `"unsatisfiable"` means 416 (first byte beyond the end, a zero-length suffix, or an empty representation).
 */
export function parseRange(header: string | undefined, size: number): ByteRange | "unsatisfiable" | null {
  if (header === undefined || !Number.isSafeInteger(size) || size < 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (match === null || (match[1] === "" && match[2] === "")) return null;
  const last = BigInt(size) - 1n;
  if (match[1] === "") {
    const suffix = BigInt(match[2]!);
    if (suffix === 0n || size === 0) return "unsatisfiable";
    const offset = suffix > BigInt(size) ? 0n : BigInt(size) - suffix;
    return { offset: Number(offset), length: Number(BigInt(size) - offset) };
  }
  const first = BigInt(match[1]!);
  if (match[2] !== "" && BigInt(match[2]!) < first) return null;
  if (first > last) return "unsatisfiable";
  const end = match[2] === "" || BigInt(match[2]!) > last ? last : BigInt(match[2]!);
  return { offset: Number(first), length: Number(end - first + 1n) };
}
