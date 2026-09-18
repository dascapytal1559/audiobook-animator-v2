import assert from "node:assert/strict";
import test from "node:test";
import { viewFromSearch } from "./view.js";

test("opening links preserve a track and fractional clip time, while rejecting unusable view values", () => {
  assert.deepEqual(viewFromSearch("?story=understand&track=proof-voyage&at=496.76390022675736"), { view: "timeline", trackId: "proof-voyage", seconds: 496.76390022675736 });
  assert.deepEqual(viewFromSearch("?story=understand&view=explorer&at=12"), { view: "explorer", trackId: "main", seconds: 12 });
  for (const search of ["", "?track=../bad&at=Infinity", "?track=&at=-1", "?at=no", "?at=%20", "?view=cast", "?view="]) {
    assert.deepEqual(viewFromSearch(search), { view: "timeline", trackId: "main", seconds: 0 });
  }
});
