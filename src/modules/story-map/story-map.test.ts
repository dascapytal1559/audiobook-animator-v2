import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { fixture } from "../story/context.fixture.js";
import { loadStoryContext } from "../story/index.js";
import { loadStoryMap } from "./index.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const encode = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

test("the story map is refused when absent, unpinned, off-transcript, or naming a missing or foreign image, and served with resolved images otherwise", async t => {
  const story = await fixture(t, { words: [{ value: "second", startSeconds: 3, endSeconds: 3.5, punctuation: " " }, { value: "third", startSeconds: 3.5, endSeconds: 4, punctuation: "." }] });
  const ctx = await Effect.runPromise(loadStoryContext({ storyDirectory: story.dir, settings: story.settings }).pipe(Effect.provide(NodeServices.layer)));
  const wordIds = ["m2:e0", "m2:e2", "m2:e4"];
  const clip = { bookId: "book", storyId: "pilot", audioSha256: story.story.audioSha256, transcriptSha256: story.story.transcriptSha256, sampleRateHz: 10, sampleCount: 100 };
  const base = { schemaVersion: 1, kind: "story-map", clip, createdAt: "2026-09-18T00:00:00.000Z", producer: { name: "test", version: "1" } };
  const load = () => Effect.runPromise(loadStoryMap({ story: ctx, wordIds, maxBytes: 65536 }).pipe(Effect.result, Effect.provide(NodeServices.layer)));
  const failure = async () => { const r = await load(); assert.equal(r._tag, "Failure"); return r._tag === "Failure" ? [r.failure.module, r.failure.code, r.failure.message] as const : assert.fail(); };
  const path = join(story.dir, "story-map.json");
  const write = (map: unknown) => writeFile(path, encode(map));

  assert.deepEqual((await failure()).slice(0, 2), ["map", "NotFound"]);
  await write({ ...base, clip: { ...clip, transcriptSha256: "b".repeat(64) }, subjects: [], sections: [] });
  assert.deepEqual((await failure()).slice(0, 2), ["map", "IdentityMismatch"]);
  await write({ ...base, subjects: [], sections: [{ id: "a", kind: "act", title: "A", startWordId: "m2:e0", endWordId: "m2:e9" }] });
  assert.match((await failure())[2], /^section a names an unknown word m2:e9 in .*story-map\.json\.$/);
  await write({ ...base, extra: 1, subjects: [], sections: [] });
  assert.equal((await failure())[1], "InvalidMap");
  await write({ ...base, subjects: [{ id: "hero", kind: "character", name: "Hero", mentions: [], images: [{ path: "refs/hero.png", role: "canonical" }] }], sections: [] });
  assert.match((await failure())[2], /^subject hero image 0 does not exist: .*refs\/hero\.png, named in /);
  await mkdir(join(story.dir, "refs"));
  await writeFile(join(story.dir, "refs", "hero.txt"), "not an image");
  await write({ ...base, subjects: [{ id: "hero", kind: "character", name: "Hero", mentions: [], images: [{ path: "refs/hero.txt", role: "canonical" }] }], sections: [] });
  assert.match((await failure())[2], /must be a \.png, \.jpg, \.jpeg, or \.webp file, not refs\/hero\.txt/);
  await write({ ...base, subjects: [{ id: "hero", kind: "character", name: "Hero", mentions: [], images: [{ path: "../hero.png", role: "canonical" }] }], sections: [] });
  assert.match((await failure())[2], /must be a relative path inside the story directory/);

  await writeFile(join(story.dir, "refs", "hero.png"), PNG);
  const map = { ...base, subjects: [{ id: "hero", kind: "character", name: "Hero", mentions: [{ startWordId: "m2:e2", endWordId: "m2:e4" }], images: [{ path: "refs/hero.png", role: "canonical" }] }],
    sections: [{ id: "act-1", kind: "act", title: "All", startWordId: "m2:e0", endWordId: "m2:e4" }, { id: "beat-1", kind: "beat", title: "Later", summary: "The rest.", startWordId: "m2:e2", endWordId: "m2:e4" }] };
  await write(map);
  const loaded = await load();
  assert.equal(loaded._tag, "Success");
  if (loaded._tag !== "Success") return;
  assert.deepEqual(loaded.success.map, map);
  assert.deepEqual(loaded.success.images, [{ subjectId: "hero", index: 0, path: join(story.dir, "refs", "hero.png"), contentType: "image/png" }]);
  assert.equal(loaded.success.path, path);
});
