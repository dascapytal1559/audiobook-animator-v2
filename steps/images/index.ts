#!/usr/bin/env node
// TODO: images step - generates one image per analyzed segment via Flux API
import { Command } from "commander";

const program = new Command();

program
  .name("images")
  .description("Generate images for each scene (stub)")
  .requiredOption("--input <dir>", "Path to analyze output dir")
  .option("--style <prompt>", "Base style prompt")
  .option("--output <dir>", "Output directory (default: out/<slug>)")
  .action(() => {
    console.log("images: not yet implemented");
    process.exit(1);
  });

program.parse();
