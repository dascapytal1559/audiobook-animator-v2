import { createHash } from "node:crypto";
import { basename, dirname, join, resolve, sep } from "node:path";
import { Effect, FileSystem } from "effect";
import { StoryAudioManifest } from "../story-audio/contracts.js";
import { type ManifestLimits, PairedAudioManifest, PairedTranscript, PlanningTranscript, StoryManifest, StoryPlanningConfig, StoryPlanningError } from "./contracts.js";
import { decode, readBounded } from "./io.js";
export { type ManifestLimits, PairedAudioManifest, PairedTranscript, PlanningTranscript, StoryManifest, StoryOrigin, StoryPlanningConfig, StoryPlanningError } from "./contracts.js";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fail = (code: StoryPlanningError["code"], message: string) => Effect.fail(new StoryPlanningError({ code, message }));

/** `HH:MM:SS.mmm` from a verified sample count, or `H:MM:SS` rounded to the second for reading views. */
export function durationDisplay(samples: number, rate: number, milliseconds: boolean): string {
  const unit = milliseconds ? 1000 : 1;
  const total = Math.round(samples / rate * unit);
  const seconds = Math.floor(total / unit);
  const clock = `${Math.floor(seconds / 3600).toString().padStart(milliseconds ? 2 : 1, "0")}:${Math.floor(seconds % 3600 / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  return milliseconds ? `${clock}.${(total % 1000).toString().padStart(3, "0")}` : clock;
}

/**
 * `<storyDirectory>/story.json` with every linked file checked against its recorded hash and length, and the paired transcript's
 * provenance checked against the manifest's origin. All linked files must live inside the story directory. Read-only; the shared
 * first step of planning and of the inventory.
 */
export function loadStoryManifest(options: { readonly storyDirectory: string; readonly limits: ManifestLimits }) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const storyDirectory = resolve(options.storyDirectory);
    const manifestPath = join(storyDirectory, "story.json");
    const manifestBytes = yield* readBounded(manifestPath, options.limits.maxManifestBytes);
    const manifest = yield* decode(StoryManifest, manifestBytes, "InvalidManifest", manifestPath, true);
    if (manifest.id !== basename(storyDirectory)) return yield* fail("InvalidManifest", `Manifest id ${manifest.id} does not match its directory name: ${storyDirectory}.`);
    if (manifest.durationSeconds !== manifest.sampleCount / manifest.sampleRateHz || manifest.durationDisplay !== durationDisplay(manifest.sampleCount, manifest.sampleRateHz, true)) {
      return yield* fail("InvalidManifest", `Duration does not match the verified samples in ${manifestPath}.`);
    }
    const inside = (relativePath: string) => {
      const path = resolve(storyDirectory, relativePath);
      return path.startsWith(`${storyDirectory}${sep}`) ? path : null;
    };
    const paths = { manifestPath, transcriptPath: inside(manifest.transcriptPath), textPath: inside(manifest.textPath), audioPath: inside(manifest.audioPath), audioManifestPath: inside(manifest.audioManifestPath) };
    if (paths.transcriptPath === null || paths.textPath === null || paths.audioPath === null || paths.audioManifestPath === null) return yield* fail("InvalidManifest", `Every linked file must live inside the story directory: ${manifestPath}.`);
    const resolved = { manifestPath, transcriptPath: paths.transcriptPath, textPath: paths.textPath, audioPath: paths.audioPath, audioManifestPath: paths.audioManifestPath };
    const transcriptBytes = yield* readBounded(resolved.transcriptPath, options.limits.maxTranscriptBytes);
    if (hash(transcriptBytes) !== manifest.transcriptSha256) return yield* fail("TranscriptMismatch", `Paired transcript changed for ${manifest.id}.`);
    const transcript = yield* decode(PairedTranscript, transcriptBytes, "TranscriptMismatch", resolved.transcriptPath, false);
    const { segment, audio, provenance } = transcript;
    if (segment.id !== manifest.id || segment.title !== manifest.title || transcript.wordCount !== manifest.wordCount
      || segment.endSample - segment.startSample !== manifest.sampleCount || audio.sampleCount !== manifest.sampleCount || audio.sampleRateHz !== manifest.sampleRateHz
      || audio.durationSeconds !== manifest.durationSeconds || audio.sha256 !== manifest.audioSha256 || audio.manifestSha256 !== manifest.audioManifestSha256
      || resolve(dirname(resolved.transcriptPath), audio.path) !== resolved.audioPath || resolve(dirname(resolved.transcriptPath), audio.manifestPath) !== resolved.audioManifestPath) {
      return yield* fail("TranscriptMismatch", `Paired transcript identity, audio links, or sample counts do not match ${manifestPath}.`);
    }
    if (provenance.planSha256 !== manifest.origin.planSha256 || provenance.transcriptSha256 !== manifest.origin.transcriptSha256
      || provenance.sourceSha256 !== manifest.origin.sourceSha256 || provenance.providerJobId !== manifest.origin.providerJobId) {
      return yield* fail("TranscriptMismatch", `Paired transcript provenance does not match the manifest origin in ${manifestPath}.`);
    }
    const textBytes = yield* readBounded(resolved.textPath, options.limits.maxTranscriptBytes);
    if (hash(textBytes) !== manifest.textSha256) return yield* fail("ArtifactMismatch", `Plain transcript changed for ${manifest.id}.`);
    const audioManifestBytes = yield* readBounded(resolved.audioManifestPath, options.limits.maxAudioManifestBytes);
    if (hash(audioManifestBytes) !== manifest.audioManifestSha256) return yield* fail("ArtifactMismatch", `Audio manifest changed for ${manifest.id}.`);
    const audioManifest = yield* decode(PairedAudioManifest, audioManifestBytes, "ArtifactMismatch", resolved.audioManifestPath, false);
    const info = yield* fs.stat(resolved.audioPath);
    if (info.type !== "File" || info.size !== BigInt(audioManifest.output.byteLength) || audioManifest.output.sha256 !== manifest.audioSha256
      || audioManifest.output.sampleCount !== manifest.sampleCount || audioManifest.output.sampleRateHz !== manifest.sampleRateHz
      || resolve(dirname(resolved.audioManifestPath), audioManifest.output.filename) !== resolved.audioPath) {
      return yield* fail("ArtifactMismatch", `Audio manifest or file length does not match ${manifest.id}.`);
    }
    return { storyDirectory, manifest, manifestSha256: hash(manifestBytes), paths: resolved, transcript, transcriptBytes, textBytes, audioManifestBytes, audioByteLength: Number(info.size) };
  }).pipe(Effect.mapError(error => error instanceof StoryPlanningError ? error : new StoryPlanningError({ code: "IoFailed", message: "Cannot read a linked story artifact." })));
}
export type LoadedStoryManifest = Effect.Success<ReturnType<typeof loadStoryManifest>>;

/**
 * Read-only planning input: the manifest-verified story plus its complete paired transcript, checked element by element. Historical evidence locators are retained, not reopened.
 * The story is the config's `storyDirectory` (the default story, A18) unless an explicit `storyDirectory` is given; the config always supplies the limits.
 */
export function loadStoryContext(options: { readonly configPath: string; readonly storyDirectory?: string }) {
  return Effect.gen(function* () {
    if (!options.configPath || options.configPath.includes("\0")) return yield* fail("InvalidConfig", "Supply an explicit configuration path.");
    if (options.storyDirectory !== undefined && (options.storyDirectory === "" || options.storyDirectory.includes("\0"))) return yield* fail("InvalidConfig", "An explicit story directory must be a non-empty path.");
    const configPath = resolve(options.configPath);
    const config = yield* decode(StoryPlanningConfig, yield* readBounded(configPath, 65_536), "InvalidConfig", configPath, true);
    const loaded = yield* loadStoryManifest({ storyDirectory: options.storyDirectory ?? resolve(dirname(configPath), config.storyDirectory), limits: config.limits });
    const { manifest: story, paths, storyDirectory } = loaded;
    const transcript = yield* decode(PlanningTranscript, loaded.transcriptBytes, "TranscriptMismatch", paths.transcriptPath, true);
    const { segment, audio, provenance, timing } = transcript;
    if (segment.kind !== "story" || transcript.elements.length > config.limits.maxElements || transcript.elements.length !== segment.elementEndIndexExclusive - segment.elementStartIndex) {
      return yield* fail("TranscriptMismatch", "Transcript element count is inconsistent or exceeds its configured limit.");
    }
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
    if (!loaded.textBytes.equals(Buffer.from(`${transcript.text}\n`))) return yield* fail("TranscriptMismatch", "Plain transcript differs from paired transcript text.");
    const manifest = yield* decode(StoryAudioManifest, loaded.audioManifestBytes, "ArtifactMismatch", paths.audioManifestPath, true);
    const output = manifest.output;
    if (output.channels !== audio.channels || manifest.identity.source.sampleRateHz !== audio.sampleRateHz || manifest.identity.source.channels !== audio.channels
      || manifest.identity.source.sha256 !== provenance.sourceSha256 || manifest.identity.request.interval.startSample !== segment.startSample
      || manifest.identity.request.interval.endSample !== segment.endSample) return yield* fail("ArtifactMismatch", "Audio manifest channels or source interval do not match the selected story.");
    return { bookId: story.book.id, bookTitle: story.book.title, storyDirectory, manifestSha256: loaded.manifestSha256, story, paths, transcript,
      audioVerification: "existing-manifest-association-and-file-size; audio-content-not-rehashed" as const };
  }).pipe(Effect.mapError(error => error instanceof StoryPlanningError ? error : new StoryPlanningError({ code: "IoFailed", message: "Cannot read a linked story artifact." })));
}
export type StoryContext = Effect.Success<ReturnType<typeof loadStoryContext>>;
