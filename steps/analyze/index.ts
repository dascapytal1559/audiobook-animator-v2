#!/usr/bin/env node
// TODO: analyze step - takes transcribe output, produces per-segment analysis
// (mood, energy, sceneType, sfxTags, imagePrompt, musicMood) via GPT-4o
import { Command } from "commander";

const program = new Command();

program
  .name("analyze")
  .description("Analyze transcript segments (stub)")
  .requiredOption("--input <dir>", "Path to transcribe output dir")
  .option("--output <dir>", "Output directory (default: out/<slug>)")
  .action(() => {
    console.log("analyze: not yet implemented");
    process.exit(1);
  });

program.parse();
