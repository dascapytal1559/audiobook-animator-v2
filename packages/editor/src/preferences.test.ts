import assert from "node:assert/strict";
import test from "node:test";
import { SECTION_MIN_HEIGHT, booleanFlags, clampSectionHeight, defaultSectionHeights, renamedField, sectionHeights, sectionMaxHeight, splitRatio } from "./preferences.js";

test("a section's ceiling leaves the lanes their floor and never drops under the minimum", () => {
  assert.equal(sectionMaxHeight(1000), 680);
  assert.equal(sectionMaxHeight(300), SECTION_MIN_HEIGHT);
  assert.equal(sectionMaxHeight(400.7), SECTION_MIN_HEIGHT);
});

test("the opening heights are shares of the window, held under the ceiling on a short window", () => {
  assert.deepEqual(defaultSectionHeights(1000), { video: 420, scenes: 380, cast: 380 });
  assert.deepEqual(defaultSectionHeights(500), { video: 180, scenes: 180, cast: 180 });
});

test("a dragged height is held between the minimum and the ceiling, in whole pixels", () => {
  assert.equal(clampSectionHeight(10, 680), SECTION_MIN_HEIGHT);
  assert.equal(clampSectionHeight(5000, 680), 680);
  assert.equal(clampSectionHeight(300.4, 680), 300);
  assert.equal(clampSectionHeight(-Infinity, 680), SECTION_MIN_HEIGHT);
});

test("remembered section heights keep their defaults for missing or malformed keys and bound the rest", () => {
  const parse = sectionHeights({ video: 400, scenes: 350 }, 680);
  assert.deepEqual(parse(undefined), { video: 400, scenes: 350 });
  assert.deepEqual(parse("nope"), { video: 400, scenes: 350 });
  assert.deepEqual(parse({ video: "tall", scenes: NaN }), { video: 400, scenes: 350 });
  assert.deepEqual(parse({ video: 12, scenes: 9999, extra: 1 }), { video: SECTION_MIN_HEIGHT, scenes: 680 });
  assert.deepEqual(parse({ video: 250.6 }), { video: 251, scenes: 350 });
});

test("a layout saved under the World map name is read as the Scenes section's, and a value saved under the new name wins", () => {
  const migrate = renamedField("worldMap", "scenes");
  assert.deepEqual(migrate({ video: false, worldMap: false }), { video: false, worldMap: false, scenes: false });
  assert.deepEqual(migrate({ video: true, worldMap: false, scenes: true }), { video: true, worldMap: false, scenes: true });
  assert.deepEqual(migrate({ video: true }), { video: true });
  assert.equal(migrate("nope"), "nope");
  const panels = (stored: unknown) => booleanFlags({ video: true, scenes: true, cast: false })(migrate(stored));
  assert.deepEqual(panels({ video: true, worldMap: false }), { video: true, scenes: false, cast: false });
  const heights = (stored: unknown) => sectionHeights({ video: 400, scenes: 350, cast: 350 }, 680)(migrate(stored));
  assert.deepEqual(heights({ video: 300, worldMap: 500 }), { video: 300, scenes: 500, cast: 350 });
});

test("boolean flags and split ratios keep working as before", () => {
  assert.deepEqual(booleanFlags({ video: true, scenes: true })({ video: false, scenes: "no" }), { video: false, scenes: true });
  assert.equal(splitRatio(0.6)(0.95), 0.85);
  assert.equal(splitRatio(0.6)("x"), 0.6);
});
