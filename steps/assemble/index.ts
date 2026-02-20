#!/usr/bin/env node
// TODO: assemble step - mix narration + video clips + sfx + music into final MP4 via FFmpeg
import { Command } from "commander";

const program = new Command();

program
  .name("assemble")
  .description("Assemble final video (stub)")
  .requiredOption("--analyze <dir>", "Path to analyze output dir")
  .requiredOption("--clips <dir>", "Path to clips output dir")
  .requiredOption("--sfx <dir>", "Path to sfx output dir")
  .requiredOption("--music <dir>", "Path to music output dir")
  .requiredOption("--audio <path>", "Path to original MP3")
  .option("--output <dir>", "Output directory (default: out/<slug>)")
  .action(() => {
    console.log("assemble: not yet implemented");
    process.exit(1);
  });

program.parse();
