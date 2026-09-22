import assert from "node:assert/strict";
import test from "node:test";
import { SECTION_MIN_HEIGHT, booleanFlags, clampSectionHeight, defaultSectionHeights, sectionHeights, sectionMaxHeight, splitRatio } from "./preferences.js";

test("a section's ceiling leaves the lanes their floor and never drops under the minimum", () => {
  assert.equal(sectionMaxHeight(1000), 680);
  assert.equal(sectionMaxHeight(300), SECTION_MIN_HEIGHT);
  assert.equal(sectionMaxHeight(400.7), SECTION_MIN_HEIGHT);
});

test("the opening heights are shares of the window, held under the ceiling on a short window", () => {
  assert.deepEqual(defaultSectionHeights(1000), { video: 420, worldMap: 380 });
  assert.deepEqual(defaultSectionHeights(500), { video: 180, worldMap: 180 });
});

test("a dragged height is held between the minimum and the ceiling, in whole pixels", () => {
  assert.equal(clampSectionHeight(10, 680), SECTION_MIN_HEIGHT);
  assert.equal(clampSectionHeight(5000, 680), 680);
  assert.equal(clampSectionHeight(300.4, 680), 300);
  assert.equal(clampSectionHeight(-Infinity, 680), SECTION_MIN_HEIGHT);
});

test("remembered section heights keep their defaults for missing or malformed keys and bound the rest", () => {
  const parse = sectionHeights({ video: 400, worldMap: 350 }, 680);
  assert.deepEqual(parse(undefined), { video: 400, worldMap: 350 });
  assert.deepEqual(parse("nope"), { video: 400, worldMap: 350 });
  assert.deepEqual(parse({ video: "tall", worldMap: NaN }), { video: 400, worldMap: 350 });
  assert.deepEqual(parse({ video: 12, worldMap: 9999, extra: 1 }), { video: SECTION_MIN_HEIGHT, worldMap: 680 });
  assert.deepEqual(parse({ video: 250.6 }), { video: 251, worldMap: 350 });
});

test("boolean flags and split ratios keep working as before", () => {
  assert.deepEqual(booleanFlags({ video: true, worldMap: true })({ video: false, worldMap: "no" }), { video: false, worldMap: true });
  assert.equal(splitRatio(0.6)(0.95), 0.85);
  assert.equal(splitRatio(0.6)("x"), 0.6);
});
