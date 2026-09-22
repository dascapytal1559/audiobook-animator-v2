import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { fixture } from "../story/context.fixture.js";
import { mintUlid } from "../visual-timeline/index.js";
import { statusReport } from "./index.js";
const run = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>) => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
const encode = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const settings = (story: Awaited<ReturnType<typeof fixture>>["settings"]) => ({ story, timeline: { limits: { maxRecordBytes: 65536, maxDecisionsBytes: 65536, maxRecords: 100, maxImageBytes: 1024 } },
  editor: { ffmpegPath: "ffmpeg", peaks: { samplesPerBucket: 16, maxCacheBytes: 65536 }, speech: { frameMs: 100, thresholdDbfs: -50, minSilenceMs: 200, minSpeechMs: 100 }, alignment: { leadMs: 200, boundaryPauseMs: 300 },
    watch: { debounceMs: 50 }, limits: { maxUploadBytes: 8192, requestTimeoutMs: 5000, maxWordTimingBytes: 1048576, maxStoryMapBytes: 65536, maxSceneDescriptionsBytes: 65536 }, chunking: { pauseBreakMs: 600, minSentenceBreakMs: 0 } } });

test("status reports facts for a verified story: no overlays, no records, absent caches, its documents, and a server that is not listening", async t => {
  const f = await fixture(t);
  await writeFile(join(f.dir, "story-analysis.md"), "# Analysis\n");
  const report = await run(statusReport({ storiesDirectory: f.root, settings: settings(f.settings), editorPort: 1 }));
  assert.equal(report.stories.length, 1);
  const s = report.stories[0]!;
  assert.ok(s.verified);
  if (!s.verified) return;
  assert.deepEqual([s.id, s.transcriptProvider, s.timing.auto, s.timing.manual, s.timing.inversions], ["pilot", "rev-ai", null, 0, 0]);
  assert.deepEqual(s.timeline, { records: 0, withImage: 0, selected: 0, hidden: 0, gaps: [{ trackId: "main", startSample: 0, endSample: 100 }], undecidedGroups: 0, unresolvedAnchors: [] });
  assert.deepEqual(s.caches, { peaks: "absent", speech: "absent" });
  assert.deepEqual(s.documents, ["story-analysis.md"]);
  assert.deepEqual(report.editorServer, { url: "http://127.0.0.1:1", listening: false, stories: null });
});

test("status counts records, selections, undecided groups, an auto overlay's coverage and parameter drift, and reports a broken story instead of omitting it", async t => {
  const f = await fixture(t);
  const clip = { bookId: "book", storyId: "pilot", audioSha256: f.story.audioSha256, transcriptSha256: f.story.transcriptSha256, sampleRateHz: 10, sampleCount: 100 };
  const record = async (startSample: number, createdAt: string, trackId?: string) => {
    const id = mintUlid();
    await mkdir(join(f.dir, "shots", id), { recursive: true });
    await writeFile(join(f.dir, "shots", id, "record.json"), encode({ schemaVersion: 1, kind: "visual-shot-generation", id, clip, startSample, ...(trackId ? { trackId } : {}), mode: "graphic-illustration", createdAt, producer: { name: "t", version: "1" } }));
  };
  await record(0, "2026-01-01T00:00:00.000Z"); await record(0, "2026-01-02T00:00:00.000Z"); await record(50, "2026-01-03T00:00:00.000Z");
  await record(25, "2026-01-01T00:00:00.000Z", "claude"); await record(75, "2026-01-01T00:00:00.000Z", "grok");
  await writeFile(join(f.dir, "word-timing.auto.json"), encode({ schemaVersion: 1, kind: "word-timing-auto", clip, updatedAt: "2026-01-01T00:00:00.000Z", producer: { name: "t", version: "1" },
    parameters: { leadMs: 150, thresholdDbfs: -50, minSilenceMs: 200, minSpeechMs: 100 }, runs: [{ startSample: 0, endSample: 100, ranAt: "2026-01-01T00:00:00.000Z", report: { range: { startSample: 0, endSample: 100 }, wordCount: 1, regionCount: 1, leadMs: 150, boundaryPauseMs: 300,
      before: { wordCount: 1, boundaryCount: 1, onsetErrorMs: null, insideSpeechCount: 0, insideSpeechFraction: 0 }, after: { wordCount: 1, boundaryCount: 1, onsetErrorMs: null, insideSpeechCount: 1, insideSpeechFraction: 1 } } }],
    words: { "m2:e0": { startSample: 15, endSample: 25 } } }));
  const report = await run(statusReport({ storiesDirectory: f.root, settings: settings(f.settings), storyId: "pilot", editorPort: 1 }));
  const s = report.stories[0]!;
  assert.ok(s.verified);
  if (!s.verified) return;
  assert.deepEqual(s.timeline, { records: 5, withImage: 0, selected: 4, hidden: 0, gaps: [{ trackId: "claude", startSample: 0, endSample: 25 }, { trackId: "grok", startSample: 0, endSample: 75 }], undecidedGroups: 1, unresolvedAnchors: [] });
  assert.deepEqual(s.timing.auto, { words: 1, coverage: 1, runs: 1, lastRunAt: "2026-01-01T00:00:00.000Z", parametersMatch: false });
  await writeFile(join(f.dir, "transcript.json"), "{}");
  const broken = (await run(statusReport({ storiesDirectory: f.root, settings: settings(f.settings), editorPort: 1 }))).stories[0]!;
  assert.equal(broken.verified, false);
  if (!broken.verified) assert.equal(broken.error.code, "TranscriptMismatch");
});
