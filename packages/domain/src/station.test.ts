import assert from "node:assert/strict";
import test from "node:test";
import type { ClipIdentity } from "./identity.js";
import { judgeStationAction, stationImage, stationOrigin, type StationImage, type StationVersion, stationWriterOf, versionsForShot } from "./station.js";

const clip: ClipIdentity = { bookId: "b", storyId: "s", audioSha256: "a".repeat(64), transcriptSha256: "b".repeat(64), sampleRateHz: 48000, sampleCount: 96000 };
const producer = { name: "t", version: "1" };
const direction = (title: string, carried?: { versionId: string; direction: number }) => ({ title, description: title, prompt: title, motion: null, motionOptions: [], ...(carried ? { carried } : {}) });
const ids = { a: "01ARZ3NDEKTSV4RRFFQ69G5FA1", b: "01ARZ3NDEKTSV4RRFFQ69G5FA2", c: "01ARZ3NDEKTSV4RRFFQ69G5FA3", d: "01ARZ3NDEKTSV4RRFFQ69G5FA4", e: "01ARZ3NDEKTSV4RRFFQ69G5FA5" };
const version = (id: string, minute: number, fields: Partial<StationVersion>): StationVersion => ({ schemaVersion: 1, kind: "shot-station-version", clip, id, shotWordId: "w3", span: { startWordId: "w3", endWordId: "w9" },
  parentId: null, action: { kind: "describe", director: "ice", count: 2 }, writer: { model: "openai/gpt-6-astra", prompt: "p", seconds: 1 }, directions: [direction("one"), direction("two")],
  createdAt: `2026-10-09T00:0${minute}:00.000Z`, producer, ...fields });
const image = (id: string, versionId: string, direction: number, minute: number, drawn: boolean): StationImage => ({ schemaVersion: 1, kind: "shot-station-image", clip, id, versionId, direction, prompt: "p",
  ...(drawn ? { renderer: "codex-chatgpt" as const, notes: "n", imagePath: "image.png" } : { error: "not logged in" }), createdAt: `2026-10-09T00:0${minute}:00.000Z`, producer });

const described = version(ids.a, 1, {});
const picked = version(ids.b, 2, { parentId: ids.a, action: { kind: "pick", direction: 1 }, writer: null, directions: [direction("two", { versionId: ids.a, direction: 1 })] });
const moving = version(ids.c, 3, { parentId: ids.b, action: { kind: "motion", motion: "pan" }, writer: null, directions: [direction("two", { versionId: ids.a, direction: 1 })] });
const edited = version(ids.d, 4, { parentId: ids.b, action: { kind: "edit", direction: 0, instruction: "red sky" }, writer: { model: "openai/gpt-writer", prompt: "q", seconds: 2 }, directions: [direction("red sky")] });
const versions = [described, picked, moving, edited];

test("a carried direction leads back to the direction that was drawn, and shows its newest drawn image; a direction with only failed tries is failed, one with none is none", () => {
  assert.deepEqual(stationOrigin(versions, ids.c, 0), { versionId: ids.a, direction: 1 });
  assert.deepEqual(stationOrigin(versions, ids.d, 0), { versionId: ids.d, direction: 0 });
  const images = [image(ids.e, ids.a, 1, 2, false), image("01ARZ3NDEKTSV4RRFFQ69G5FB1", ids.a, 1, 3, true), image("01ARZ3NDEKTSV4RRFFQ69G5FB2", ids.a, 0, 4, false)];
  const shown = stationImage(versions, images, ids.c, 0);
  assert.equal(shown.status, "drawn");
  if (shown.status === "drawn") assert.equal(shown.image.id, "01ARZ3NDEKTSV4RRFFQ69G5FB1", "a drawn try wins over an earlier failed one");
  const failed = stationImage(versions, images, ids.a, 0);
  assert.equal(failed.status, "failed");
  assert.deepEqual(stationImage(versions, images, ids.d, 0), { status: "none" });
  assert.deepEqual(stationImage(versions, [image("01ARZ3NDEKTSV4RRFFQ69G5FB3", ids.a, 1, 5, false), ...images], ids.b, 0).status, "drawn", "a later failed try does not hide a drawn one");
});

test("a direction's writer is the model that first wrote it; a pick or a motion choice wrote nothing of its own", () => {
  assert.equal(stationWriterOf(versions, ids.c, 0)?.model, "openai/gpt-6-astra");
  assert.equal(stationWriterOf(versions, ids.d, 0)?.model, "openai/gpt-writer");
  assert.equal(stationWriterOf(versions, "01ARZ3NDEKTSV4RRFFQ69G5FZZ", 0), null);
});

test("a shot's versions are those made for it or begun at its word, with every version they descend from, oldest first", () => {
  const elsewhere = version(ids.e, 5, { shotWordId: "w20", span: { startWordId: "w20", endWordId: "w30" } });
  const moved = version("01ARZ3NDEKTSV4RRFFQ69G5FB9", 6, { shotWordId: "w3", span: { startWordId: "w5", endWordId: "w9" }, parentId: ids.d, action: { kind: "motion", motion: null }, writer: null, directions: [direction("red sky", { versionId: ids.d, direction: 0 })] });
  const all = [moved, elsewhere, ...versions];
  assert.deepEqual(versionsForShot(all, "w3").map(v => v.id), [ids.a, ids.b, ids.c, ids.d, moved.id]);
  assert.deepEqual(versionsForShot(all, "w5").map(v => v.id), [ids.a, ids.b, ids.d, moved.id], "a version begun at a word belongs to the frame saved there, with its ancestors");
  assert.deepEqual(versionsForShot(all, "w20").map(v => v.id), [ids.e]);
  assert.deepEqual(versionsForShot(all, "w99"), []);
});

test("an action is judged against the directions of the version it follows", () => {
  assert.equal(judgeStationAction({ kind: "describe", director: "x", count: 4 }, null, 6), null);
  assert.match(judgeStationAction({ kind: "describe", director: "x", count: 7 }, 2, 6) ?? "", /at most 6 directions, not 7/);
  assert.equal(judgeStationAction({ kind: "pick", direction: 1 }, 2, 6), null);
  assert.match(judgeStationAction({ kind: "pick", direction: 2 }, 2, 6) ?? "", /no direction 3 to pick/);
  assert.match(judgeStationAction({ kind: "edit", direction: 0 , instruction: "x" }, null, 6) ?? "", /no direction 1 to edit/);
  assert.equal(judgeStationAction({ kind: "mix", directions: [0, 2], instruction: "" }, 3, 6), null);
  assert.match(judgeStationAction({ kind: "mix", directions: [0], instruction: "" }, 3, 6) ?? "", /two directions or more/);
  assert.match(judgeStationAction({ kind: "mix", directions: [0, 0], instruction: "" }, 3, 6) ?? "", /each direction once/);
  assert.match(judgeStationAction({ kind: "mix", directions: [0, 3], instruction: "" }, 3, 6) ?? "", /a direction the version does not have/);
  assert.equal(judgeStationAction({ kind: "motion", motion: null }, 1, 6), null);
  assert.match(judgeStationAction({ kind: "motion", motion: "pan" }, 4, 6) ?? "", /pick one first/);
});
