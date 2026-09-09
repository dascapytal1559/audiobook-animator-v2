import { test } from "node:test";
import assert from "node:assert/strict";
import { selectItem, selectedIds, selectedRange } from "./selection.js";

const order = ["w1", "w2", "w3", "w4", "w5", "w6"];

test("click selects one item; shift-click extends from the anchor in either direction", () => {
  let selection = selectItem(null, { first: "w3", last: "w3" }, false);
  assert.deepEqual(selectedRange(order, selection), { first: 2, last: 2 });
  selection = selectItem(selection, { first: "w5", last: "w5" }, true);
  assert.deepEqual(selectedRange(order, selection), { first: 2, last: 4 });
  selection = selectItem(selection, { first: "w1", last: "w1" }, true);
  assert.deepEqual(selectedRange(order, selection), { first: 0, last: 2 }, "the anchor stays put; the focus moves to the other side");
  selection = selectItem(selection, { first: "w6", last: "w6" }, false);
  assert.deepEqual([...selectedIds(order, selection)], ["w6"], "a plain click resets the anchor");
});

test("sentence items cover their whole word span and a shift-click with no anchor is a plain click", () => {
  const selection = selectItem(null, { first: "w2", last: "w4" }, true);
  assert.deepEqual([...selectedIds(order, selection)], ["w2", "w3", "w4"]);
  const extended = selectItem(selection, { first: "w5", last: "w6" }, true);
  assert.deepEqual(selectedRange(order, extended), { first: 1, last: 5 });
});

test("a selection whose words are gone resolves to nothing", () => {
  const selection = selectItem(null, { first: "w9", last: "w9" }, false);
  assert.equal(selectedRange(order, selection), null);
  assert.equal(selectedIds(order, selection).size, 0);
  assert.equal(selectedRange(order, null), null);
});
