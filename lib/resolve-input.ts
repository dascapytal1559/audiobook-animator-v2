import fs from "fs";
import path from "path";

const DATA_DIR = "data";

/**
 * Resolve an --audio argument to an absolute path.
 * Accepts:
 *   - a bare number ("1")  → finds data/1_*.{mp3,wav,m4a}
 *   - any other string     → treated as a literal path
 */
export function resolveAudio(input: string): string {
  if (/^\d+$/.test(input)) {
    const n = input;
    const entries = fs.readdirSync(DATA_DIR).filter((f) =>
      f.startsWith(`${n}_`)
    );
    if (entries.length === 0) {
      throw new Error(`No file in data/ starting with "${n}_"`);
    }
    if (entries.length > 1) {
      throw new Error(
        `Ambiguous: multiple files in data/ start with "${n}_":\n  ${entries.join("\n  ")}`
      );
    }
    return path.resolve(DATA_DIR, entries[0]);
  }

  return path.resolve(input);
}
