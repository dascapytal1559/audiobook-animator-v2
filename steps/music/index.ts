#!/usr/bin/env node
// TODO: music step - generates mood-matched background music via Suno/MusicGen
import { Command } from "commander";

const program = new Command();

program
  .name("music")
  .description("Generate background music sections (stub)")
  .requiredOption("--input <dir>", "Path to analyze output dir")
  .option("--output <dir>", "Output directory (default: out/<slug>)")
  .action(() => {
    console.log("music: not yet implemented");
    process.exit(1);
  });

program.parse();
