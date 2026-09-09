import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { inspectSourceMedia } from "../source-media/index.js";
import { extractStoryAudio } from "../story-audio/index.js";
import { sha256 } from "../transcription/content-hash.js";
import { jsonBytes, readBookArtifact, retainBookArtifact } from "../transcription/book-artifacts.js";
import { BookTranscriptForSplit, StorySplitConfig, StorySplitError, StorySplitPlan, type SplitInventoryEntry, type StorySplitResult, type StorySplitSegment } from "./contracts.js";

export { StorySplitConfig, StorySplitError, StorySplitPlan } from "./contracts.js";
export type { StorySplitResult, StorySplitSegment } from "./contracts.js";

const configLimit = 64 * 1024;
const absoluteTool = (base: string, path: string): string => !isAbsolute(path) && path.includes("/") ? resolve(base, path) : path;
const read = (path: string, limit: number) => readBookArtifact(path, limit).pipe(
  Effect.mapError((error) => new StorySplitError({ code: "ArtifactIoFailed", message: error.message })),
);
const retain = (path: string, bytes: Uint8Array, limit: number) => retainBookArtifact(path, bytes, limit).pipe(
  Effect.mapError((error) => new StorySplitError({ code: error.code === "ArtifactMismatch" ? "ArtifactMismatch" : "ArtifactIoFailed", message: error.message })),
);
const parse = (bytes: Uint8Array, code: "InvalidConfig" | "InvalidPlan" | "TranscriptMismatch" | "ArtifactMismatch") => Effect.try({
  try: () => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown,
  catch: () => new StorySplitError({ code, message: "Required input is not valid UTF-8 JSON." }),
});
const SavedRunSource = Schema.Struct({
  source: Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/^[^\0]+$/)) }),
});

interface StorySplitInputs {
  readonly planPath: string;
  readonly configPath: string;
  /** Optional current locator, resolved from the working directory without editing the plan. */
  readonly sourcePath?: string;
}

interface ValidatedInputs {
  readonly config: StorySplitConfig;
  readonly plan: StorySplitPlan;
  readonly planPath: string;
  readonly planBytes: Buffer;
  readonly planSha256: string;
  readonly transcript: BookTranscriptForSplit;
  readonly transcriptPath: string;
  readonly sourcePath: string;
  readonly evidence: ReadonlyArray<{ readonly path: string; readonly sha256: string; readonly description: string }>;
}

function requirePath(path: string, description: string) {
  return path && !path.includes("\0")
    ? Effect.succeed(resolve(path))
    : Effect.fail(new StorySplitError({ code: "InvalidConfig", message: `Supply an explicit ${description} path.` }));
}

function loadInputs(options: StorySplitInputs) {
  return Effect.gen(function* () {
    const configPath = yield* requirePath(options.configPath, "configuration");
    const planPath = yield* requirePath(options.planPath, "split plan");
    const configBytes = yield* read(configPath, configLimit);
    if (!configBytes) return yield* Effect.fail(new StorySplitError({ code: "InvalidConfig", message: "The split configuration does not exist." }));
    const rawConfig = yield* parse(configBytes, "InvalidConfig");
    const decodedConfig = yield* Schema.decodeUnknownEffect(StorySplitConfig, { onExcessProperty: "error" })(rawConfig).pipe(
      Effect.mapError(() => new StorySplitError({ code: "InvalidConfig", message: "Supply all explicit splitter limits, concurrency, timing tolerance, and audio extraction settings." })),
    );
    const config: StorySplitConfig = {
      ...decodedConfig,
      audio: { ...decodedConfig.audio, ffmpegPath: absoluteTool(dirname(configPath), decodedConfig.audio.ffmpegPath),
        inspection: { ...decodedConfig.audio.inspection, ffprobePath: absoluteTool(dirname(configPath), decodedConfig.audio.inspection.ffprobePath) } },
    };
    const planBytes = yield* read(planPath, config.maxPlanBytes);
    if (!planBytes) return yield* Effect.fail(new StorySplitError({ code: "InvalidPlan", message: "The required split plan does not exist." }));
    const rawPlan = yield* parse(planBytes, "InvalidPlan");
    const plan = yield* Schema.decodeUnknownEffect(StorySplitPlan, { onExcessProperty: "error" })(rawPlan).pipe(
      Effect.mapError(() => new StorySplitError({ code: "InvalidPlan", message: "The split plan requires pinned source/transcript identities, timing evidence, and explicit element/sample ranges for every segment." })),
    );
    if (plan.segments.length === 0 || plan.segments.length > config.maxSegments || !plan.segments.some((segment) => segment.kind === "story") || plan.evidence.length === 0) {
      return yield* Effect.fail(new StorySplitError({ code: "InvalidPlan", message: "A split plan requires at least one story and one evidence file, within the configured segment limit." }));
    }
    const base = dirname(planPath);
    const transcriptPath = resolve(base, plan.transcript.path);
    const bytes = yield* read(transcriptPath, config.maxTranscriptBytes);
    if (!bytes || sha256(bytes) !== plan.transcript.sha256) return yield* Effect.fail(new StorySplitError({ code: "TranscriptMismatch", message: "The normalized transcript does not match the SHA-256 pinned in the split plan." }));
    const rawTranscript = yield* parse(bytes, "TranscriptMismatch");
    const transcript = yield* Schema.decodeUnknownEffect(BookTranscriptForSplit)(rawTranscript).pipe(
      Effect.mapError(() => new StorySplitError({ code: "TranscriptMismatch", message: "The pinned transcript has an invalid provider, source, word, or punctuation contract." })),
    );
    if (transcript.provider.jobId !== plan.transcript.providerJobId || transcript.provider.rawSha256 !== plan.transcript.providerRawSha256) {
      return yield* Effect.fail(new StorySplitError({ code: "TranscriptMismatch", message: "The transcript's Rev job or raw-export hash differs from the split plan." }));
    }
    if (transcript.source.sha256 !== plan.source.sha256 || transcript.source.byteLength !== plan.source.byteLength
      || transcript.source.audio.streamIndex !== plan.source.audioStreamIndex || transcript.source.audio.sampleRateHz !== plan.source.sampleRateHz) {
      return yield* Effect.fail(new StorySplitError({ code: "SourceMismatch", message: "The transcript source does not match the split plan's source hash, byte length, audio stream, and sample rate." }));
    }
    const seenElements = new Set<string>();
    let wordCount = 0;
    for (const element of transcript.elements) {
      if (seenElements.has(element.id)) return yield* Effect.fail(new StorySplitError({ code: "InvalidAssignment", message: `Duplicate transcript element ID: ${element.id}.` }));
      seenElements.add(element.id);
      if (element.kind === "word") {
        wordCount++;
        if (element.providerEndSeconds < element.providerStartSeconds) return yield* Effect.fail(new StorySplitError({ code: "TranscriptMismatch", message: `Reversed word times for ${element.id}.` }));
      }
    }
    if (wordCount !== transcript.wordCount) return yield* Effect.fail(new StorySplitError({ code: "TranscriptMismatch", message: "The transcript's word count does not match its timed elements." }));
    const segmentIds = new Set<string>();
    let nextElement = 0;
    let previousEndSample = 0;
    for (const segment of plan.segments) {
      if (segmentIds.has(segment.id) || segment.elementStartIndex !== nextElement || segment.elementEndIndexExclusive <= segment.elementStartIndex
        || segment.elementEndIndexExclusive > transcript.elements.length || segment.startSample < previousEndSample || segment.endSample <= segment.startSample) {
        return yield* Effect.fail(new StorySplitError({ code: "InvalidAssignment", message: `Segment ${segment.id} duplicates an ID, drops/overlaps elements, or has unordered/overlapping sample bounds.` }));
      }
      segmentIds.add(segment.id);
      let segmentWords = 0;
      const audioStart = segment.startSample / plan.source.sampleRateHz;
      const audioEnd = segment.endSample / plan.source.sampleRateHz;
      for (let i = segment.elementStartIndex; i < segment.elementEndIndexExclusive; i++) {
        const element = transcript.elements[i]!;
        if (element.kind !== "word") continue;
        segmentWords++;
        const start = element.providerStartSeconds + plan.timing.providerToDecodedOffsetSeconds;
        const end = element.providerEndSeconds + plan.timing.providerToDecodedOffsetSeconds;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < audioStart - config.wordTimingToleranceSeconds || end > audioEnd + config.wordTimingToleranceSeconds) {
          return yield* Effect.fail(new StorySplitError({ code: "WordOutsideAudio", message: `Word ${element.id} falls outside segment ${segment.id}'s audio interval at the configured ${config.wordTimingToleranceSeconds}-second tolerance.` }));
        }
      }
      if (segmentWords === 0) return yield* Effect.fail(new StorySplitError({ code: "InvalidAssignment", message: `Segment ${segment.id} has no timed words.` }));
      nextElement = segment.elementEndIndexExclusive;
      previousEndSample = segment.endSample;
    }
    if (nextElement !== transcript.elements.length) return yield* Effect.fail(new StorySplitError({ code: "InvalidAssignment", message: "The split plan leaves transcript elements unassigned at the end of the book." }));
    const evidence = [];
    for (const reference of plan.evidence) {
      const path = resolve(base, reference.path);
      const evidenceBytes = yield* read(path, config.maxEvidenceBytes);
      if (!evidenceBytes || sha256(evidenceBytes) !== reference.sha256) return yield* Effect.fail(new StorySplitError({ code: "EvidenceMismatch", message: `Split evidence does not match its pinned hash: ${path}.` }));
      evidence.push({ ...reference, path });
    }
    const sourcePath = options.sourcePath === undefined
      ? resolve(base, plan.source.path)
      : yield* requirePath(options.sourcePath, "source override");
    const source = yield* inspectSourceMedia({ ...config.audio.inspection, sourcePath, audioStreamIndex: plan.source.audioStreamIndex });
    if (source.source.sha256 !== plan.source.sha256 || source.source.stat.byteLength !== String(plan.source.byteLength)
      || source.audio.sampleRateHz !== plan.source.sampleRateHz) return yield* Effect.fail(new StorySplitError({ code: "SourceMismatch", message: "The current source bytes or sample rate differ from the split plan." }));
    return { config, plan, planPath, planBytes, planSha256: sha256(planBytes), transcript, transcriptPath, sourcePath, evidence } satisfies ValidatedInputs;
  });
}

/** Validate the caller's complete plan and its input evidence without extracting audio. */
export function validateStorySplit(options: StorySplitInputs) {
  return loadInputs(options).pipe(Effect.map(({ plan, planSha256, transcript }) => ({
    status: "inputs-validated" as const, planSha256,
    storyCount: plan.segments.filter((segment) => segment.kind === "story").length,
    extraCount: plan.segments.filter((segment) => segment.kind !== "story").length,
    assignedElementCount: transcript.elements.length, assignedWordCount: transcript.wordCount,
    audioCutQuality: "supplied-by-plan-evidence-not-verified-by-input-validation" as const,
  })));
}

function segmentTranscript(input: ValidatedInputs, segment: StorySplitSegment) {
  const elements = input.transcript.elements.slice(segment.elementStartIndex, segment.elementEndIndexExclusive).map((element, index) => {
    const common = { ...element, bookElementIndex: segment.elementStartIndex + index };
    if (element.kind !== "word") return common;
    return { ...common,
      approximateSegmentStartSeconds: element.providerStartSeconds + input.plan.timing.providerToDecodedOffsetSeconds - segment.startSample / input.plan.source.sampleRateHz,
      approximateSegmentEndSeconds: element.providerEndSeconds + input.plan.timing.providerToDecodedOffsetSeconds - segment.startSample / input.plan.source.sampleRateHz,
    };
  });
  let previousMonologue: string | undefined;
  let text = "";
  for (const element of elements) {
    const monologue = element.id.split(":")[0];
    if (previousMonologue !== undefined && monologue !== previousMonologue) text += "\n";
    text += element.value;
    previousMonologue = monologue;
  }
  return { elements, text, wordCount: elements.filter((element) => element.kind === "word").length };
}

function durationDisplay(samples: number, rate: number): string {
  const milliseconds = Math.round(samples / rate * 1000);
  return `${Math.floor(milliseconds / 3_600_000).toString().padStart(2, "0")}:${Math.floor(milliseconds % 3_600_000 / 60_000).toString().padStart(2, "0")}:${Math.floor(milliseconds % 60_000 / 1000).toString().padStart(2, "0")}.${(milliseconds % 1000).toString().padStart(3, "0")}`;
}
const markdownText = (text: string): string => text.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\r", " ").replaceAll("\n", " ").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function inventoryMarkdown(bookTitle: string, stories: ReadonlyArray<SplitInventoryEntry>, extras: ReadonlyArray<SplitInventoryEntry>): string {
  const table = (entries: ReadonlyArray<SplitInventoryEntry>) => [
    "| Title | Verified duration | Audio | Transcript |", "| --- | ---: | --- | --- |",
    ...entries.map((entry) => `| ${markdownText(entry.title)} | ${entry.durationDisplay} | [FLAC](${entry.audioPath}) | [Text](${entry.textPath}) · [Timed JSON](${entry.transcriptPath}) |`),
  ].join("\n");
  return `# ${markdownText(bookTitle)}\n\n${stories.length} stories, ready to select. Audio durations come from verified sample counts and are displayed to the nearest millisecond. Word timestamps remain approximate.\n\n${table(stories)}\n\n## Extras\n\n${table(extras)}\n`;
}

/** Pair every supplied segment with verified audio, then publish the complete inventory last. */
export function splitStories(
  options: StorySplitInputs & { readonly artifactDirectory: string },
  extractAudio: typeof extractStoryAudio = extractStoryAudio,
) {
  return Effect.gen(function* () {
    const input = yield* loadInputs(options);
    const { plan, config } = input;
    const directory = yield* requirePath(options.artifactDirectory, "artifact directory");
    const fs = yield* FileSystem.FileSystem;
    const manifestPath = join(directory, "run-manifest.json");
    const identity = {
      schemaVersion: 1, kind: "story-split-identity", artifactDirectory: directory, config,
      plan: { path: input.planPath, sha256: input.planSha256 },
      transcript: { path: input.transcriptPath, sha256: plan.transcript.sha256, providerJobId: plan.transcript.providerJobId, providerRawSha256: plan.transcript.providerRawSha256 },
      source: { ...plan.source, path: input.sourcePath }, evidence: input.evidence,
    };
    const existing = yield* read(manifestPath, config.maxRunManifestBytes);
    if (existing) {
      const raw = yield* parse(existing, "ArtifactMismatch");
      const saved = yield* Schema.decodeUnknownEffect(SavedRunSource)(raw).pipe(
        Effect.mapError(() => new StorySplitError({ code: "ArtifactMismatch", message: "The saved split run has an invalid source locator." })),
      );
      // The complete previous record must still match; only its source locator is historical.
      const previousIdentity = { ...identity, source: { ...identity.source, path: saved.source.path } };
      if (!existing.equals(jsonBytes(previousIdentity))) return yield* Effect.fail(new StorySplitError({ code: "ArtifactMismatch", message: "The saved split run differs in plan, transcript, evidence, source content, or explicit configuration. Only the source locator may change." }));
    } else {
      const exists = yield* fs.exists(directory).pipe(Effect.mapError(() => new StorySplitError({ code: "ArtifactIoFailed", message: "Cannot inspect the split artifact directory." })));
      if (exists) {
        const entries = yield* fs.readDirectory(directory).pipe(Effect.mapError(() => new StorySplitError({ code: "ArtifactIoFailed", message: "Cannot inspect the split artifact directory." })));
        if (entries.length > 0) return yield* Effect.fail(new StorySplitError({ code: "ArtifactMismatch", message: "Split artifacts exist without their run identity. Preserve and reconcile this directory before running again." }));
      }
    }
    yield* retain(manifestPath, existing ?? jsonBytes(identity), config.maxRunManifestBytes);
    yield* retain(join(directory, "plan.raw.json"), input.planBytes, config.maxPlanBytes);
    const entries = yield* Effect.forEach(plan.segments, (segment) => Effect.gen(function* () {
      const segmentDirectory = join(directory, "segments", segment.id);
      // The audio module reserves its own new directory; only it may create audio/.
      const audio = yield* extractAudio({
        ...config.audio, sourcePath: input.sourcePath,
        expectedSource: { sha256: plan.source.sha256, byteLength: plan.source.byteLength }, audioStreamIndex: plan.source.audioStreamIndex,
        interval: { clock: "ffmpeg-decoded-audio-samples", startSample: segment.startSample, endSample: segment.endSample },
        artifactDirectory: join(segmentDirectory, "audio"),
      });
      const output = audio.manifest.output;
      if (output.sampleRateHz !== plan.source.sampleRateHz || output.sampleCount !== segment.endSample - segment.startSample
        || audio.manifest.identity.source.sha256 !== plan.source.sha256
        || audio.manifest.identity.request.interval.startSample !== segment.startSample || audio.manifest.identity.request.interval.endSample !== segment.endSample) {
        return yield* Effect.fail(new StorySplitError({ code: "InvalidAudioResult", message: `Verified audio for ${segment.id} does not match its source/sample interval.` }));
      }
      const audioManifestBytes = yield* read(audio.manifestPath, config.audio.maxManifestBytes);
      if (!audioManifestBytes?.equals(jsonBytes(audio.manifest))) return yield* Effect.fail(new StorySplitError({ code: "InvalidAudioResult", message: `Audio manifest for ${segment.id} changed after verification.` }));
      const audioManifestSha256 = sha256(audioManifestBytes);
      const parsed = segmentTranscript(input, segment);
      const durationSeconds = output.sampleCount / output.sampleRateHz;
      const transcriptPath = join(segmentDirectory, "transcript.json");
      const textPath = join(segmentDirectory, "transcript.txt");
      const transcriptBytes = jsonBytes({
        schemaVersion: 1, kind: "paired-story-segment-transcript", segment,
        provenance: { planSha256: input.planSha256, transcriptSha256: plan.transcript.sha256, providerJobId: plan.transcript.providerJobId,
          providerRawSha256: plan.transcript.providerRawSha256, sourceSha256: plan.source.sha256, evidence: input.evidence },
        timing: { ...plan.timing, wordTiming: "approximate-provider-times-mapped-to-segment" as const,
          caveat: "Provider word times are retained unchanged. Segment-relative times use the documented offset and sample start; they are approximate, are not clamped, and are not forced alignment.",
          wordTimingToleranceSeconds: config.wordTimingToleranceSeconds },
        audio: { path: "audio/audio.flac", manifestPath: "audio/manifest.json", manifestSha256: audioManifestSha256,
          sha256: output.sha256, sampleCount: output.sampleCount, sampleRateHz: output.sampleRateHz, channels: output.channels, durationSeconds },
        ...parsed,
      });
      const textBytes = Buffer.from(`${parsed.text}\n`, "utf8");
      yield* retain(transcriptPath, transcriptBytes, config.maxSegmentTranscriptBytes);
      yield* retain(textPath, textBytes, config.maxSegmentTranscriptBytes);
      return {
        id: segment.id, title: segment.title, kind: segment.kind, wordCount: parsed.wordCount,
        sampleCount: output.sampleCount, sampleRateHz: output.sampleRateHz, durationSeconds, durationDisplay: durationDisplay(output.sampleCount, output.sampleRateHz),
        audioPath: relative(directory, audio.audioPath), audioSha256: output.sha256,
        audioManifestPath: relative(directory, audio.manifestPath), audioManifestSha256,
        transcriptPath: relative(directory, transcriptPath), transcriptSha256: sha256(transcriptBytes),
        textPath: relative(directory, textPath), textSha256: sha256(textBytes),
      } satisfies SplitInventoryEntry;
    }), { concurrency: config.concurrency });
    // Long extractions must not finish against a plan/transcript/evidence file edited mid-run.
    for (const file of [
      { path: input.planPath, sha256: input.planSha256, limit: config.maxPlanBytes },
      { path: input.transcriptPath, sha256: plan.transcript.sha256, limit: config.maxTranscriptBytes },
      ...input.evidence.map((entry) => ({ ...entry, limit: config.maxEvidenceBytes })),
    ]) {
      const bytes = yield* read(file.path, file.limit);
      if (!bytes || sha256(bytes) !== file.sha256) return yield* Effect.fail(new StorySplitError({ code: "ArtifactMismatch", message: `Input evidence changed while splitting: ${file.path}. No complete inventory was published.` }));
    }
    const stories = entries.filter((entry) => entry.kind === "story");
    const extras = entries.filter((entry) => entry.kind !== "story");
    const inventoryPath = join(directory, "inventory.json");
    const readableInventoryPath = join(directory, "inventory.md");
    const inventory = {
      schemaVersion: 1, kind: "verified-story-inventory", status: "complete", bookTitle: plan.bookTitle,
      planSha256: input.planSha256, transcriptSha256: plan.transcript.sha256,
      sourceSha256: plan.source.sha256, providerJobId: plan.transcript.providerJobId,
      checks: { assignedElementCount: input.transcript.elements.length, assignedWordCount: input.transcript.wordCount,
        everyElementAssignedExactlyOnce: true, everySegmentAudioVerified: true, durationBasis: "verified-sample-count-divided-by-sample-rate", wordTiming: "approximate" },
      storyCount: stories.length, extraCount: extras.length, stories, extras,
    };
    yield* retain(readableInventoryPath, Buffer.from(inventoryMarkdown(plan.bookTitle, stories, extras), "utf8"), config.maxInventoryBytes);
    yield* retain(inventoryPath, jsonBytes(inventory), config.maxInventoryBytes);
    return { artifactDirectory: directory, inventoryPath, readableInventoryPath, storyCount: stories.length, extraCount: extras.length, stories, extras } satisfies StorySplitResult;
  });
}
