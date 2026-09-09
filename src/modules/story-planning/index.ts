import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { Effect, FileSystem } from "effect";
import { StoryAudioManifest } from "../story-audio/contracts.js";
import { PlanningInventory, PlanningTranscript, StoryPlanningConfig, StoryPlanningError } from "./contracts.js";
import { decode, readBounded } from "./io.js";
export { StoryPlanningConfig, StoryPlanningError, PlanningTranscript } from "./contracts.js";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fail = (code: StoryPlanningError["code"], message: string) => Effect.fail(new StoryPlanningError({ code, message }));

/** Read-only planning input. Historical evidence locators are retained, not reopened. */
export function loadStoryContext(options: { readonly configPath: string }) {
  return Effect.gen(function* () {
    if (!options.configPath || options.configPath.includes("\0")) return yield* fail("InvalidConfig", "Supply an explicit configuration path.");
    const fs = yield* FileSystem.FileSystem;
    const configPath = resolve(options.configPath);
    const config = yield* decode(StoryPlanningConfig, yield* readBounded(configPath, 65_536), "InvalidConfig", configPath, true);
    const inventoryPath = resolve(dirname(configPath), config.inventoryPath);
    const inventoryBytes = yield* readBounded(inventoryPath, config.limits.maxInventoryBytes);
    if (hash(inventoryBytes) !== config.inventorySha256) return yield* fail("InvalidInventory", "Selected inventory changed; review its identity before updating configuration.");
    const inventory = yield* decode(PlanningInventory, inventoryBytes, "InvalidInventory", inventoryPath, false);
    if (inventory.bookTitle !== config.bookTitle || inventory.storyCount !== inventory.stories.length || inventory.extraCount !== inventory.extras.length
      || new Set(inventory.stories.map(s => s.id)).size !== inventory.storyCount) return yield* fail("InvalidInventory", "Book title or inventory counts/IDs do not match.");
    const story = inventory.stories.find(s => s.id === config.storyId);
    if (!story) return yield* fail("InvalidInventory", `No story named ${config.storyId} in the selected inventory; notes and credits cannot be planned as stories.`);
    const paths = { inventoryPath, transcriptPath: resolve(dirname(inventoryPath), story.transcriptPath), textPath: resolve(dirname(inventoryPath), story.textPath),
      audioPath: resolve(dirname(inventoryPath), story.audioPath), audioManifestPath: resolve(dirname(inventoryPath), story.audioManifestPath) };
    const bytes = yield* readBounded(paths.transcriptPath, config.limits.maxTranscriptBytes);
    if (hash(bytes) !== story.transcriptSha256) return yield* fail("TranscriptMismatch", "Selected paired transcript changed.");
    const transcript = yield* decode(PlanningTranscript, bytes, "TranscriptMismatch", paths.transcriptPath, true);
    const { segment, audio, provenance, timing } = transcript;
    if (segment.kind !== "story" || segment.id !== story.id || segment.title !== story.title || transcript.wordCount !== story.wordCount
      || provenance.planSha256 !== inventory.planSha256 || provenance.transcriptSha256 !== inventory.transcriptSha256
      || provenance.sourceSha256 !== inventory.sourceSha256 || provenance.providerJobId !== inventory.providerJobId
      || segment.endSample - segment.startSample !== story.sampleCount || audio.sampleCount !== story.sampleCount || audio.sampleRateHz !== story.sampleRateHz
      || audio.durationSeconds !== story.sampleCount / story.sampleRateHz || story.durationSeconds !== audio.durationSeconds
      || audio.sha256 !== story.audioSha256 || audio.manifestSha256 !== story.audioManifestSha256
      || resolve(dirname(paths.transcriptPath), audio.path) !== paths.audioPath || resolve(dirname(paths.transcriptPath), audio.manifestPath) !== paths.audioManifestPath) {
      return yield* fail("TranscriptMismatch", "Story identity, provenance, samples, or audio references do not match the inventory.");
    }
    if (transcript.elements.length > config.limits.maxElements || transcript.elements.length !== segment.elementEndIndexExclusive - segment.elementStartIndex) return yield* fail("TranscriptMismatch", "Transcript element count is inconsistent or exceeds its configured limit.");
    const ids = new Set<string>();
    let wordCount = 0;
    let text = "";
    let previousMonologue: string | undefined;
    let previousStart = -Infinity;
    let previousMonologueIndex = -1;
    let previousElementIndex = -1;
    for (const [index, element] of transcript.elements.entries()) {
      if (!/^m\d+:e\d+$/.test(element.id) || ids.has(element.id) || element.bookElementIndex !== segment.elementStartIndex + index || element.speaker < 0) return yield* fail("TranscriptMismatch", `Invalid stable ID or source index at element ${index}.`);
      const [monologueIndex, providerElementIndex] = element.id.slice(1).split(":e").map(Number) as [number, number];
      if (!Number.isSafeInteger(monologueIndex) || !Number.isSafeInteger(providerElementIndex) || monologueIndex < previousMonologueIndex
        || (monologueIndex === previousMonologueIndex && providerElementIndex !== previousElementIndex + 1)
        || (previousMonologueIndex >= 0 && monologueIndex !== previousMonologueIndex && providerElementIndex !== 0)) {
        return yield* fail("TranscriptMismatch", `Unordered or missing provider reference at ${element.id}.`);
      }
      previousMonologueIndex = monologueIndex;
      previousElementIndex = providerElementIndex;
      ids.add(element.id);
      const monologue = element.id.split(":")[0]!;
      if (previousMonologue !== undefined && monologue !== previousMonologue) text += "\n";
      text += element.value;
      if (monologue !== previousMonologue) previousStart = -Infinity;
      previousMonologue = monologue;
      if (element.kind !== "word") continue;
      wordCount++;
      const start = element.providerStartSeconds + timing.providerToDecodedOffsetSeconds - segment.startSample / audio.sampleRateHz;
      const end = element.providerEndSeconds + timing.providerToDecodedOffsetSeconds - segment.startSample / audio.sampleRateHz;
      if (element.providerStartSeconds < previousStart || end < start || start < -timing.wordTimingToleranceSeconds || end > audio.durationSeconds + timing.wordTimingToleranceSeconds
        || element.approximateSegmentStartSeconds !== start || element.approximateSegmentEndSeconds !== end) return yield* fail("TranscriptMismatch", `Invalid provider or story-relative timing for ${element.id}.`);
      previousStart = element.providerStartSeconds;
    }
    if (wordCount !== transcript.wordCount || text !== transcript.text) return yield* fail("TranscriptMismatch", "Transcript text or word count does not match its unchanged elements.");
    const textBytes = yield* readBounded(paths.textPath, config.limits.maxTranscriptBytes);
    if (hash(textBytes) !== story.textSha256 || !textBytes.equals(Buffer.from(`${transcript.text}\n`))) return yield* fail("TranscriptMismatch", "Plain transcript differs from paired transcript text.");
    const manifestBytes = yield* readBounded(paths.audioManifestPath, config.limits.maxAudioManifestBytes);
    if (hash(manifestBytes) !== story.audioManifestSha256) return yield* fail("ArtifactMismatch", "Audio manifest changed.");
    const manifest = yield* decode(StoryAudioManifest, manifestBytes, "ArtifactMismatch", paths.audioManifestPath, true);
    const info = yield* fs.stat(paths.audioPath);
    const output = manifest.output;
    if (info.type !== "File" || info.size !== BigInt(output.byteLength) || output.sha256 !== audio.sha256 || output.sampleCount !== audio.sampleCount
      || output.sampleRateHz !== audio.sampleRateHz || output.channels !== audio.channels || resolve(dirname(paths.audioManifestPath), output.filename) !== paths.audioPath
      || manifest.identity.source.sampleRateHz !== audio.sampleRateHz || manifest.identity.source.channels !== audio.channels
      || manifest.identity.source.sha256 !== provenance.sourceSha256 || manifest.identity.request.interval.startSample !== segment.startSample
      || manifest.identity.request.interval.endSample !== segment.endSample) return yield* fail("ArtifactMismatch", "Audio file size, manifest association, or source interval does not match the selected story.");
    return { bookId: config.bookId, bookTitle: inventory.bookTitle, inventorySha256: config.inventorySha256, story, paths, transcript,
      audioVerification: "existing-manifest-association-and-file-size; audio-content-not-rehashed" as const };
  }).pipe(Effect.mapError(error => error instanceof StoryPlanningError ? error : new StoryPlanningError({ code: "IoFailed", message: "Cannot read a linked story artifact." })));
}
export type StoryContext = Effect.Success<ReturnType<typeof loadStoryContext>>;
