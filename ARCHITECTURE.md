# Architecture

## Overview

An enhanced animated audiobook pipeline. The original MP3 narration is the backbone — it plays unchanged as the primary audio track. The pipeline generates and layers visuals, sound effects, and background music on top to produce a short-form video (target: Twitter, "psyod anime" aesthetic).

## Pipeline

```
[MP3]
  │
  ▼
transcribe       word/segment timestamps via OpenAI Whisper
  │
  ▼
analyze          per-segment mood, energy, scene type, SFX tags,
  │              image prompts, music mood via GPT-4o
  │
  ├──────────────────────┬──────────────────────┐
  ▼                      ▼                      ▼
images                  sfx                   music
one image per segment   AI-generated SFX      AI-generated score
(Flux API)              per tagged event      per mood section
  │                     (ElevenLabs)          (Suno / MusicGen)
  ▼
clips
  calm scenes   → still image + Ken Burns pan/zoom (FFmpeg)
  action scenes → AI image-to-video (Kling / RunwayML)
  │
  ▼
assemble
  FFmpeg: narration + clips + SFX + music → final MP4
```

## Step Communication

Each step writes its output to a named directory: `data/{step}/{adjective}-{animal}/context.json`.

The slug is auto-generated (e.g. `data/transcribe/crimson-tiger/`). Pass a previous step's output dir as `--input` to the next step.

```jsonc
// example: data/transcribe/crimson-tiger/context.json  (transcribe output)
{
  "step": "transcribe",
  "createdAt": "...",
  "input": { "audioPath": "/abs/path/to/book.mp3" },
  "output": {
    "language": "en",
    "duration": 3600.4,
    "segments": [{ "start": 0, "end": 12.4, "text": "..." }],
    "words":    [{ "start": 0, "end": 0.5,  "word": "In"  }]
  }
}
```

Zod schemas for every step's `context.json` live in [lib/types.ts](lib/types.ts).

## Project Structure

```
animator-v2/
├── lib/
│   ├── types.ts       Zod schemas for all step context shapes
│   ├── context.ts     readContext / writeContext helpers
│   ├── slug.ts        adjective-animal slug generator
│   └── index.ts       re-exports
├── steps/
│   ├── transcribe/    MP3 → transcript (OpenAI Whisper)
│   ├── analyze/       transcript → scene metadata (GPT-4o)
│   ├── images/        scenes → images (Flux API)
│   ├── sfx/           scenes → sound effects (ElevenLabs)
│   ├── music/         scenes → background music (Suno/MusicGen)
│   ├── clips/         images → video clips (Kling / FFmpeg)
│   └── assemble/      all assets → final MP4 (FFmpeg)
├── data/
│   ├── transcribe/    runs grouped by step, gitignored
│   ├── analyze/
│   └── ...
├── package.json       single package, all deps, bin entries per step
├── tsconfig.json      single tsconfig covering entire repo
└── ARCHITECTURE.md    this file
```

Each step is a single `index.ts`. Add sibling files within the step dir as it grows complex (e.g. `steps/clips/kling.ts`, `steps/clips/ffmpeg.ts`). If a helper becomes reusable across steps, move it to `lib/`.

## Running Steps

```bash
# run any step directly
npx tsx steps/transcribe/index.ts --audio 1

# pass output of one step as input to the next
npx tsx steps/analyze/index.ts --input data/transcribe/crimson-tiger

# images, sfx, music can run in parallel from the same analyze output
npx tsx steps/images/index.ts --input data/transcribe/crimson-tiger &
npx tsx steps/sfx/index.ts   --input data/transcribe/crimson-tiger &
npx tsx steps/music/index.ts --input data/transcribe/crimson-tiger &
wait
```

## Key Dependencies

| Package | Used by |
|---|---|
| `openai` | transcribe (Whisper), analyze (GPT-4o) |
| `commander` | all step CLIs |
| `zod` | lib — context schema validation |
| `unique-names-generator` | lib — slug generation |
| `fluent-ffmpeg` | clips, assemble |
| `dotenv` | all steps |
