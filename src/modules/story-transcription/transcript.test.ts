import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { fixture } from "../story/context.fixture.js";
import { loadStoryContext } from "../story/index.js";
import { loadEditorLibrary } from "../editor-server/routes.js";
import { storyPayload, writeManualTiming } from "../editor-server/timing.js";
import { StoryTranscript } from "./contracts.js";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const encode = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2)+"\n");
const run = <A, E>(effect: Effect.Effect<A, E, import("effect").FileSystem.FileSystem>) => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

test("GPT is the working planning/editor transcript; edits use GPT IDs and reject retired Rev IDs", async t => {
  const f = await fixture(t);
  const transcript: StoryTranscript = {
    schemaVersion: 1, kind: "story-transcript", storyId: "pilot", provider: { name: "openai", model: "gpt-transcribe" },
    audio: { sha256: f.story.audioSha256, sampleCount: 100, sampleRateHz: 10, sourceStartSample: 100 },
    provenance: { runPath: "transcription/run.json", runSha256: "a".repeat(64), bookSourceSha256: f.story.origin.sourceSha256 },
    timing: { method: "rev-seeded", seedTranscriptSha256: f.story.transcriptSha256 },
    text: "Corrected.\n", wordCount: 1, elements: [{ kind: "word", id: "gpt:w0", value: "Corrected", startSample: 13, endSample: 23 }, { kind: "punctuation", value: ".\n" }],
  };
  const save = async (value: StoryTranscript) => {
    await writeFile(join(f.dir, "transcript.json"), encode(value));
    await writeFile(join(f.dir, "transcript.txt"), value.text);
    await writeFile(join(f.dir, "story.json"), encode({ ...f.story, transcriptProvider: "openai", transcriptSha256: hash(encode(value)), textSha256: hash(Buffer.from(value.text)) }));
  };
  await save(transcript);
  assert.equal((await run(loadStoryContext({ storyDirectory: f.dir, settings: f.settings }))).transcript.kind, "story-transcript");
  const library = await run(loadEditorLibrary({ storiesDirectory: f.root, settings: { story: f.settings, timeline: { limits: { maxRecordBytes: 65536, maxDecisionsBytes: 65536, maxRecords: 100, maxImageBytes: 1024 } },
    editor: { ffmpegPath: "ffmpeg", peaks: { samplesPerBucket: 16, maxCacheBytes: 65536 }, speech: { frameMs: 100, thresholdDbfs: -50, minSilenceMs: 150, minSpeechMs: 50 }, alignment: { leadMs: 150, boundaryPauseMs: 300 },
      watch: { debounceMs: 50 }, limits: { maxUploadBytes: 8192, requestTimeoutMs: 5000, maxWordTimingBytes: 1048576 }, chunking: { pauseBreakMs: 600, minSentenceBreakMs: 0 } } } }));
  const { ctx } = await run(library.open("pilot"));
  const payload = await run(storyPayload(ctx));
  assert.equal(payload.story.transcriptProvider, "openai");
  assert.equal(payload.words[0]!.value, "Corrected");
  assert.equal(payload.sourceStartSample, 100);
  await run(writeManualTiming(ctx, { "gpt:w0": { startSample: 30, endSample: 40 } }));
  assert.equal((await run(storyPayload(ctx))).words[0]!.startSample, 30);
  await assert.rejects(run(writeManualTiming(ctx, { "m2:e0": { startSample: 30, endSample: 40 } })));
  assert.equal(JSON.parse(await readFile(join(f.dir, "word-timing.json"), "utf8")).clip.transcriptSha256, hash(encode(transcript)));
  for (const bad of [
    { ...transcript, wordCount: 2 },
    { ...transcript, text: "Wrong text" },
    { ...transcript, elements: [{ kind: "word" as const, id: "m2:e0", value: "Corrected", startSample: 13, endSample: 23 }, transcript.elements[1]!] },
    { ...transcript, audio: { ...transcript.audio, sourceStartSample: 101 } },
  ]) {
    await save(bad);
    await assert.rejects(run(loadStoryContext({ storyDirectory: f.dir, settings: f.settings })));
  }
});
