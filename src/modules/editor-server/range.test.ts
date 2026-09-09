import assert from "node:assert/strict";
import test from "node:test";
import { parseRange } from "./range.js";

test("single byte ranges: closed, open-ended, suffix, clamped, and case-insensitive unit", () => {
  assert.deepEqual(parseRange("bytes=0-99", 300), { offset: 0, length: 100 });
  assert.deepEqual(parseRange("bytes=100-199", 300), { offset: 100, length: 100 });
  assert.deepEqual(parseRange("bytes=295-", 300), { offset: 295, length: 5 });
  assert.deepEqual(parseRange("bytes=0-", 300), { offset: 0, length: 300 });
  assert.deepEqual(parseRange("bytes=299-299", 300), { offset: 299, length: 1 });
  assert.deepEqual(parseRange("bytes=295-999999999999999999999999999", 300), { offset: 295, length: 5 }, "last byte beyond the end is clamped");
  assert.deepEqual(parseRange("bytes=-5", 300), { offset: 295, length: 5 });
  assert.deepEqual(parseRange("bytes=-300", 300), { offset: 0, length: 300 });
  assert.deepEqual(parseRange("bytes=-999999999999999999999999999", 300), { offset: 0, length: 300 }, "suffix longer than the representation returns all of it");
  assert.deepEqual(parseRange(" BYTES=1-2 ", 300), { offset: 1, length: 2 });
});

test("unsatisfiable ranges produce 416: first byte past the end, zero-length suffix, empty representation", () => {
  assert.equal(parseRange("bytes=300-", 300), "unsatisfiable");
  assert.equal(parseRange("bytes=300-400", 300), "unsatisfiable");
  assert.equal(parseRange("bytes=999999999999999999999999999-", 300), "unsatisfiable");
  assert.equal(parseRange("bytes=-0", 300), "unsatisfiable");
  assert.equal(parseRange("bytes=0-0", 0), "unsatisfiable");
  assert.equal(parseRange("bytes=-1", 0), "unsatisfiable");
});

test("absent, foreign-unit, malformed, inverted, and multi-range headers are ignored so the whole file is served", () => {
  assert.equal(parseRange(undefined, 300), null);
  assert.equal(parseRange("items=0-1", 300), null);
  assert.equal(parseRange("bytes=", 300), null);
  assert.equal(parseRange("bytes=-", 300), null);
  assert.equal(parseRange("bytes=a-b", 300), null);
  assert.equal(parseRange("bytes=0-1,4-5", 300), null);
  assert.equal(parseRange("bytes=1-2, 5-6", 300), null);
  assert.equal(parseRange("bytes=10-9", 300), null);
  assert.equal(parseRange("0-99", 300), null);
  assert.equal(parseRange("bytes=0-99", -1), null);
  assert.equal(parseRange("bytes=0-99", 1.5), null);
});
