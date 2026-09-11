/** The editor server's wire shapes. The server types its payloads against these; the client decodes every response with them. */
import { Schema } from "effect";
import { Chunk } from "./chunks.js";
import { ClipIdentity } from "./identity.js";
import { Id, NonNegative, Positive, PositiveSeconds, Text } from "./schema.js";
import { CandidateGroup, Decisions, ServedShotRecord, ShotId, StitchedEntry } from "./shots.js";
import { AlignReport, AlignRun, TimingEntries, TimingEntry } from "./timing.js";

/** One entry of `GET /api/stories`: identity and size from the manifest, without opening the transcript. */
export const StorySummary = Schema.Struct({
  id: Id, title: Text, bookId: Id, bookTitle: Text,
  wordCount: Positive, sampleRateHz: Positive, sampleCount: Positive, durationSeconds: PositiveSeconds, durationDisplay: Text,
});
export type StorySummary = typeof StorySummary.Type;
export const StoriesResponse = Schema.Struct({ defaultStoryId: Id, stories: Schema.Array(StorySummary) });
export type StoriesResponse = typeof StoriesResponse.Type;

/** A transcript word with its three timing layers (A42): the top-level times are effective (manual, else auto, else original). */
export const StoryWord = Schema.Struct({
  id: Text, value: Text, startSample: NonNegative, endSample: NonNegative,
  original: TimingEntry, auto: Schema.optionalKey(TimingEntry), manual: Schema.optionalKey(TimingEntry),
});
export type StoryWord = typeof StoryWord.Type;
/** The transcript's element order: words by id (their timing is in `words`) and the punctuation between them, so the client can chunk with the server's rule. */
export const StoryElement = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("word"), id: Text }),
  Schema.Struct({ kind: Schema.Literal("punctuation"), value: Schema.String }),
]);
export type StoryElement = typeof StoryElement.Type;
/** A transcriber sentence mark the effective timing merged away because the gap behind it was under `minSentenceBreakMs` (A54). */
export const MergedSentenceBreak = Schema.Struct({ afterWordId: Text, nextWordId: Text, gapSamples: Schema.Int, gapMs: Schema.Int, text: Schema.String });
export const StoryChunking = Schema.Struct({ pauseBreakMs: Positive, minSentenceBreakMs: NonNegative, mergedSentenceBreaks: Schema.Array(MergedSentenceBreak) });
export type StoryChunking = typeof StoryChunking.Type;
export const TimingSummary = Schema.Struct({ inversions: NonNegative, autoRuns: Schema.Array(AlignRun), manualCount: NonNegative, autoCount: NonNegative });
export type TimingSummary = typeof TimingSummary.Type;
/** `GET .../story`. */
export const StoryResponse = Schema.Struct({
  clip: ClipIdentity, story: Schema.Struct({ title: Text, bookTitle: Text, transcriptProvider: Schema.Literals(["rev-ai", "openai"]) }),
  /** The clip's start on the book clock, for a book-time display. */
  sourceStartSample: NonNegative,
  elements: Schema.Array(StoryElement), words: Schema.Array(StoryWord), chunks: Schema.Array(Chunk), chunking: StoryChunking, timing: TimingSummary,
});
export type StoryResponse = typeof StoryResponse.Type;

/** `GET .../timeline` and the reply to `PUT .../decisions`. */
export const TimelineResponse = Schema.Struct({
  clip: ClipIdentity, storyDirectory: Text, records: Schema.Array(ServedShotRecord), decisions: Decisions,
  candidates: Schema.Array(CandidateGroup), stitched: Schema.Array(StitchedEntry), unresolvedAnchors: Schema.Array(ShotId),
});
export type TimelineResponse = typeof TimelineResponse.Type;

/** `PUT .../word-timing`: the complete manual overlay, keyed by word id (A36). Replaces the file wholesale, like decisions. */
export const WordTimingBody = Schema.Struct({ words: TimingEntries });
export type WordTimingBody = typeof WordTimingBody.Type;
/** `POST .../word-timing/align`. A range covering the whole clip is refused unless `wholeClip` is true (A43). */
export const AlignRequest = Schema.Struct({ startSample: NonNegative, endSample: Positive, wholeClip: Schema.optionalKey(Schema.Boolean) });
export type AlignRequest = typeof AlignRequest.Type;
export const AlignResponse = Schema.Struct({ report: AlignReport, story: StoryResponse });
export type AlignResponse = typeof AlignResponse.Type;
/** Every error body: a stable code and a message naming the file or rule. */
export const ApiErrorBody = Schema.Struct({ code: Text, message: Schema.String });
export type ApiErrorBody = typeof ApiErrorBody.Type;
