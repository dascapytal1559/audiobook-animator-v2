import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { fixture } from "../story/context.fixture.js";
import { loadStoryContext } from "../story/index.js";
import { addSceneDescriptionTake, loadSceneDescriptions } from "./index.js";

const encode = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

test("scene descriptions read as no takes until a take is recorded; each take is appended for a declared shot, never replacing an earlier one; repeats, undeclared shots, foreign clips, and unshaped files are refused by name", async t => {
  const story = await fixture(t);
  const ctx = await Effect.runPromise(loadStoryContext({ storyDirectory: story.dir, settings: story.settings }).pipe(Effect.provide(NodeServices.layer)));
  const target = { story: ctx, maxBytes: 65536 };
  const shots = [{ anchorWordId: "m2:e0", startSample: 13 }];
  const producer = { name: "editor", version: "test" };
  const load = () => Effect.runPromise(loadSceneDescriptions(target).pipe(Effect.provide(NodeServices.layer)));
  const add = (take: { anchorWordId: string; model: string; text: string; prompt?: string; notes?: string }) => Effect.runPromise(addSceneDescriptionTake({ ...target, take, shots, producer }).pipe(Effect.result, Effect.provide(NodeServices.layer)));
  const failure = async (take: Parameters<typeof add>[0]) => { const r = await add(take); assert.equal(r._tag, "Failure"); return r._tag === "Failure" ? [r.failure.module, r.failure.code, r.failure.message] as const : assert.fail(); };
  const path = join(story.dir, "scene-descriptions.json");

  assert.deepEqual(await load(), []);
  const first = await add({ anchorWordId: "m2:e0", model: "openai/gpt-6-astra", text: "Under the ice.", prompt: "Describe it." });
  assert.equal(first._tag, "Success");
  if (first._tag !== "Success") return;
  assert.deepEqual({ ...first.success, id: "x", createdAt: "t" }, { id: "x", anchorWordId: "m2:e0", model: "openai/gpt-6-astra", text: "Under the ice.", prompt: "Describe it.", createdAt: "t", producer });
  const file = JSON.parse(await readFile(path, "utf8")) as { schemaVersion: number; kind: string; clip: { storyId: string }; takes: unknown[] };
  assert.deepEqual([file.schemaVersion, file.kind], [2, "scene-descriptions"]);
  assert.equal(file.clip.storyId, "pilot");
  assert.deepEqual(file.takes, [first.success]);

  const second = await add({ anchorWordId: "m2:e0", model: "anthropic/claude-fable-5.1", text: "Beneath a ceiling of ice." });
  assert.equal(second._tag, "Success");
  assert.deepEqual((await load()).map(t => t.model), ["openai/gpt-6-astra", "anthropic/claude-fable-5.1"]);
  assert.deepEqual((await failure({ anchorWordId: "m2:e0", model: "openai/gpt-6-astra", text: "Under the ice." })).slice(0, 2), ["descriptions", "TakeExists"]);
  const undeclared = await failure({ anchorWordId: "m2:e9", model: "openai/gpt-6-astra", text: "Lost." });
  assert.deepEqual(undeclared.slice(0, 2), ["descriptions", "InvalidRequest"]);
  assert.match(undeclared[2], /No declared shot starts at m2:e9/);
  assert.match((await failure({ anchorWordId: "m2:e0", model: "Not A Model", text: "x" }))[2], /the new take/);
  assert.equal((await load()).length, 2);

  const written = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  await writeFile(path, encode({ ...written, clip: { ...(written["clip"] as object), transcriptSha256: "b".repeat(64) } }));
  await assert.rejects(load(), (e: { code: string }) => e.code === "IdentityMismatch");
  await writeFile(path, encode({ ...written, extra: 1 }));
  await assert.rejects(load(), (e: { code: string }) => e.code === "InvalidDescriptions");
});
