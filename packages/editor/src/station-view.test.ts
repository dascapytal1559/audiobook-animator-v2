import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClipIdentity } from "@animator/domain";
import type { ServedStationImage, StationVersion, StoryboardJob } from "./api.js";
import { cardImage, DEFAULT_DIRECTIONS, directorOf, EMPTY_STATION_DRAFT, isEmptyStationDraft, motionLabel, openVersion, parseDirectionCount, parseStationDrafts, versionLabel } from "./station-view.js";

const clip: ClipIdentity = { bookId: "b", storyId: "s", audioSha256: "a".repeat(64), transcriptSha256: "b".repeat(64), sampleRateHz: 48000, sampleCount: 96000 };
const producer = { name: "t", version: "1" };
const ids = { a: "01ARZ3NDEKTSV4RRFFQ69G5FA1", b: "01ARZ3NDEKTSV4RRFFQ69G5FA2", c: "01ARZ3NDEKTSV4RRFFQ69G5FA3" };
const direction = (title: string, carried?: { versionId: string; direction: number }) => ({ title, description: title, prompt: title, motion: null, motionOptions: [], ...(carried ? { carried } : {}) });
const version = (id: string, minute: number, fields: Partial<StationVersion>): StationVersion => ({ schemaVersion: 1, kind: "shot-station-version", clip, id, shotWordId: "w3", span: { startWordId: "w3", endWordId: "w9" },
  parentId: null, action: { kind: "describe", director: "a keeper on the lighthouse gallery", count: 2 }, writer: { model: "openai/gpt-6-astra", prompt: "p", seconds: 1 }, directions: [direction("one"), direction("two")],
  createdAt: `2026-10-09T00:0${minute}:00.000Z`, producer, ...fields });
const described = version(ids.a, 1, {});
const picked = version(ids.b, 2, { parentId: ids.a, action: { kind: "pick", direction: 1 }, writer: null, directions: [direction("two", { versionId: ids.a, direction: 1 })] });
const third = version(ids.c, 3, { parentId: ids.b, action: { kind: "motion", motion: "pan" }, writer: null, directions: [direction("two", { versionId: ids.a, direction: 1 })] });
const numbers = [described, picked, third];

test("a version reads by what made it, naming the version it came from by its number among the shot's versions", () => {
  assert.equal(versionLabel(described, numbers), "2 directions");
  assert.equal(versionLabel({ ...described, parentId: ids.b, directions: [direction("x")] }, numbers), "1 direction, revising v2");
  assert.equal(versionLabel(picked, numbers), "picked 2 of v1");
  assert.equal(versionLabel({ ...picked, action: { kind: "mix", directions: [0, 2], instruction: " the light of 1 " } }, numbers), "mixed 1 + 3 of v1: “the light of 1”");
  assert.equal(versionLabel({ ...picked, action: { kind: "mix", directions: [0, 1], instruction: "" } }, numbers), "mixed 1 + 2 of v1");
  assert.equal(versionLabel({ ...picked, parentId: ids.b, action: { kind: "edit", direction: 0, instruction: "make the sky red" } }, numbers), "edited v2: “make the sky red”", "a version of one direction is named without it");
  assert.equal(versionLabel({ ...picked, parentId: ids.a, action: { kind: "edit", direction: 2, instruction: "closer" } }, numbers), "edited 3 of v1: “closer”");
  assert.equal(versionLabel({ ...picked, parentId: ids.c, action: { kind: "motion", motion: "slow push in" } }, numbers), "motion of v3: slow push in");
  assert.equal(versionLabel({ ...picked, parentId: ids.c, action: { kind: "motion", motion: null } }, numbers), "still, from v3");
  assert.equal(motionLabel({ motion: null }), "still");
});

test("a card shows its image once drawn, the job's line while it is drawn, why it failed, or that it was lost; a carried direction shows its origin's", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 9, 0, 0, s)).toISOString();
  const image = (id: string, direction: number, drawn: boolean): ServedStationImage => ({ schemaVersion: 1, kind: "shot-station-image", clip, id, versionId: ids.a, direction, prompt: "p", createdAt: at(30), producer,
    ...(drawn ? { renderer: "codex-chatgpt" as const, imagePath: "image.png", imageUrl: `/img/${id}` } : { error: "quota" }) });
  const job = (direction: number, status: StoryboardJob["status"]): StoryboardJob => ({ id: "01ARZ3NDEKTSV4RRFFQ69G5FB0", kind: "station", anchorWordId: "w3", status, requestedAt: at(0), versionId: ids.a, direction,
    attempts: status === "queued" ? [] : [{ renderer: "codex-chatgpt", startedAt: at(2) }] });
  const versions = [described, picked];
  const now = Date.parse(at(20));
  assert.deepEqual(cardImage(versions, [image("01ARZ3NDEKTSV4RRFFQ69G5FC1", 1, true)], [], ids.b, 0, now), { kind: "drawn", url: "/img/01ARZ3NDEKTSV4RRFFQ69G5FC1", by: "ChatGPT (Codex CLI)" });
  assert.deepEqual(cardImage(versions, [], [job(1, "running")], ids.b, 0, now), { kind: "drawing", line: "Drawing with ChatGPT (Codex CLI)… 18 s" });
  assert.deepEqual(cardImage(versions, [], [job(0, "queued")], ids.a, 0, now), { kind: "drawing", line: "Waiting for a free renderer… 20 s" });
  assert.deepEqual(cardImage(versions, [], [job(0, "done")], ids.a, 0, now), { kind: "drawing", line: "Drawn; loading…" });
  assert.deepEqual(cardImage(versions, [image("01ARZ3NDEKTSV4RRFFQ69G5FC2", 0, false)], [], ids.a, 0, now), { kind: "failed", line: "Drawing failed. quota" });
  assert.deepEqual(cardImage(versions, [], [{ ...job(0, "failed"), error: "x", attempts: [{ renderer: "codex-chatgpt", startedAt: at(2), finishedAt: at(3), error: "quota" }] }], ids.a, 0, now), { kind: "failed", line: "Drawing failed. ChatGPT (Codex CLI) failed: quota" });
  assert.deepEqual(cardImage(versions, [], [], ids.a, 0, now), { kind: "missing" });
});

test("the open version is the one chosen while it is there, else the newest; a version's description is its own or its nearest ancestor's", () => {
  assert.equal(openVersion([described, picked], null)?.id, ids.b);
  assert.equal(openVersion([described, picked], ids.a)?.id, ids.a);
  assert.equal(openVersion([described, picked], ids.c)?.id, ids.b);
  assert.equal(openVersion([], null), null);
  assert.deepEqual(directorOf([described, picked], picked), { text: "a keeper on the lighthouse gallery", versionId: ids.a });
  assert.equal(directorOf([picked], picked), null);
});

test("what a browser kept of the station is read back part by part; anything malformed is dropped, an empty draft is no draft, and a direction count outside 1 to 6 is the default", () => {
  const kept = parseStationDrafts({
    w1: { director: "a keeper on the gallery", from: ids.a, span: { startWordId: "w1", endWordId: "w4" }, open: ids.b },
    w2: { director: 3, from: "", span: { startWordId: "w2" }, open: null },
    w3: { director: "typed" },
    w4: "junk",
  });
  assert.deepEqual(kept, { w1: { director: "a keeper on the gallery", from: ids.a, span: { startWordId: "w1", endWordId: "w4" }, open: ids.b }, w3: { director: "typed", from: null, span: null, open: null } });
  assert.deepEqual([parseStationDrafts(null), parseStationDrafts([1]), parseStationDrafts("x")], [{}, {}, {}]);
  assert.equal(isEmptyStationDraft(EMPTY_STATION_DRAFT), true);
  assert.equal(isEmptyStationDraft({ ...EMPTY_STATION_DRAFT, open: ids.a }), false);
  assert.deepEqual([parseDirectionCount(2), parseDirectionCount(6), parseDirectionCount(7), parseDirectionCount(0), parseDirectionCount("4"), parseDirectionCount(2.5)], [2, 6, DEFAULT_DIRECTIONS, DEFAULT_DIRECTIONS, DEFAULT_DIRECTIONS, DEFAULT_DIRECTIONS]);
});
