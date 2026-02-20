#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { writeContext, generateSlug } from "../../lib/index.js";
import { resolveAudio } from "../../lib/resolve-input.js";

const program = new Command();

program
  .name("transcribe")
  .description("Transcribe an MP3 audiobook using OpenAI Whisper")
  .requiredOption("--audio <path|number>", "Path to MP3, or index number (e.g. 1 → data/1_*.mp3)")
  .option("--output <dir>", "Output directory (default: data/transcribe/<slug>)")
  .action(async (opts: { audio: string; output?: string }) => {
    let audioPath: string;
    try {
      audioPath = resolveAudio(opts.audio);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }

    if (!fs.existsSync(audioPath)) {
      console.error(`Audio file not found: ${audioPath}`);
      process.exit(1);
    }

    const outDir = opts.output ?? path.join("data", "transcribe", generateSlug());
    const fileSizeMb = (fs.statSync(audioPath).size / 1024 / 1024).toFixed(1);
    console.log(`audio  ${path.basename(audioPath)} (${fileSizeMb} MB)`);
    console.log(`output ${outDir}`);

    const client = new OpenAI();

    console.log(`\ntranscribing via Whisper API ...`);
    const response = await client.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word", "segment"],
    });
    console.log(`done  ${response.segments?.length ?? 0} segments, ${response.words?.length ?? 0} words`);

    writeContext(outDir, {
      step: "transcribe",
      createdAt: new Date().toISOString(),
      input: { audioPath },
      output: {
        language: response.language ?? "en",
        duration: response.duration ?? 0,
        segments: (response.segments ?? []).map((s) => ({
          start: s.start,
          end: s.end,
          text: s.text.trim(),
        })),
        words: (response.words ?? []).map((w) => ({
          word: w.word,
          start: w.start,
          end: w.end,
        })),
      },
    });

    console.log(`wrote ${outDir}/context.json`);
  });

program.parse();
