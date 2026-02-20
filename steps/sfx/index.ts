#!/usr/bin/env node
// TODO: sfx step - generates sound effects for tagged events via ElevenLabs API
import { Command } from "commander";

const program = new Command();

program
  .name("sfx")
  .description("Generate sound effects for scene events (stub)")
  .requiredOption("--input <dir>", "Path to analyze output dir")
  .option("--output <dir>", "Output directory (default: out/<slug>)")
  .action(() => {
    console.log("sfx: not yet implemented");
    process.exit(1);
  });

program.parse();
