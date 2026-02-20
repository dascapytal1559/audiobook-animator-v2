import { z } from "zod";

// ── Shared primitives ────────────────────────────────────────────────────────

export const TimestampedWord = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
});

export const TimestampedSegment = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
});

// ── Step: transcribe ─────────────────────────────────────────────────────────

export const TranscribeInput = z.object({
  audioPath: z.string(),
});

export const TranscribeOutput = z.object({
  language: z.string(),
  duration: z.number(),
  segments: z.array(TimestampedSegment),
  words: z.array(TimestampedWord),
});

export const TranscribeContext = z.object({
  step: z.literal("transcribe"),
  createdAt: z.string(),
  input: TranscribeInput,
  output: TranscribeOutput,
});

// ── Step: analyze ────────────────────────────────────────────────────────────

export const SceneType = z.enum(["action", "calm", "dialogue", "transition"]);

export const AnalyzedSegment = TimestampedSegment.extend({
  mood: z.string(),
  energy: z.enum(["low", "medium", "high"]),
  sceneType: SceneType,
  sfxTags: z.array(z.string()),
  imagePrompt: z.string(),
  musicMood: z.string(),
});

export const AnalyzeInput = z.object({
  fromDir: z.string(),
});

export const AnalyzeOutput = z.object({
  segments: z.array(AnalyzedSegment),
});

export const AnalyzeContext = z.object({
  step: z.literal("analyze"),
  createdAt: z.string(),
  input: AnalyzeInput,
  output: AnalyzeOutput,
});

// ── Step: images ─────────────────────────────────────────────────────────────

export const GeneratedImage = z.object({
  segmentIndex: z.number(),
  prompt: z.string(),
  path: z.string(),
  url: z.string().optional(),
});

export const ImagesInput = z.object({
  fromDir: z.string(),
  stylePrompt: z.string().optional(),
});

export const ImagesOutput = z.object({
  images: z.array(GeneratedImage),
});

export const ImagesContext = z.object({
  step: z.literal("images"),
  createdAt: z.string(),
  input: ImagesInput,
  output: ImagesOutput,
});

// ── Step: sfx ────────────────────────────────────────────────────────────────

export const GeneratedSfx = z.object({
  segmentIndex: z.number(),
  tag: z.string(),
  path: z.string(),
  start: z.number(),
});

export const SfxInput = z.object({
  fromDir: z.string(),
});

export const SfxOutput = z.object({
  effects: z.array(GeneratedSfx),
});

export const SfxContext = z.object({
  step: z.literal("sfx"),
  createdAt: z.string(),
  input: SfxInput,
  output: SfxOutput,
});

// ── Step: music ──────────────────────────────────────────────────────────────

export const MusicSection = z.object({
  start: z.number(),
  end: z.number(),
  mood: z.string(),
  path: z.string(),
});

export const MusicInput = z.object({
  fromDir: z.string(),
});

export const MusicOutput = z.object({
  sections: z.array(MusicSection),
});

export const MusicContext = z.object({
  step: z.literal("music"),
  createdAt: z.string(),
  input: MusicInput,
  output: MusicOutput,
});

// ── Step: clips ──────────────────────────────────────────────────────────────

export const VideoClip = z.object({
  segmentIndex: z.number(),
  path: z.string(),
  type: z.enum(["still", "ai-video"]),
  start: z.number(),
  end: z.number(),
});

export const ClipsInput = z.object({
  analyzeDir: z.string(),
  imagesDir: z.string(),
});

export const ClipsOutput = z.object({
  clips: z.array(VideoClip),
});

export const ClipsContext = z.object({
  step: z.literal("clips"),
  createdAt: z.string(),
  input: ClipsInput,
  output: ClipsOutput,
});

// ── Step: assemble ───────────────────────────────────────────────────────────

export const AssembleInput = z.object({
  analyzeDir: z.string(),
  clipsDir: z.string(),
  sfxDir: z.string(),
  musicDir: z.string(),
  audioPath: z.string(),
});

export const AssembleOutput = z.object({
  videoPath: z.string(),
  duration: z.number(),
});

export const AssembleContext = z.object({
  step: z.literal("assemble"),
  createdAt: z.string(),
  input: AssembleInput,
  output: AssembleOutput,
});

// ── Union ────────────────────────────────────────────────────────────────────

export const AnyContext = z.discriminatedUnion("step", [
  TranscribeContext,
  AnalyzeContext,
  ImagesContext,
  SfxContext,
  MusicContext,
  ClipsContext,
  AssembleContext,
]);

export type AnyContext = z.infer<typeof AnyContext>;
export type TranscribeContext = z.infer<typeof TranscribeContext>;
export type AnalyzeContext = z.infer<typeof AnalyzeContext>;
export type ImagesContext = z.infer<typeof ImagesContext>;
export type SfxContext = z.infer<typeof SfxContext>;
export type MusicContext = z.infer<typeof MusicContext>;
export type ClipsContext = z.infer<typeof ClipsContext>;
export type AssembleContext = z.infer<typeof AssembleContext>;
export type AnalyzedSegment = z.infer<typeof AnalyzedSegment>;
export type TimestampedSegment = z.infer<typeof TimestampedSegment>;
export type TimestampedWord = z.infer<typeof TimestampedWord>;
