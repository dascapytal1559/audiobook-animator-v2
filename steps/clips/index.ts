#!/usr/bin/env node
// TODO: clips step - converts images to video clips
// calm scenes: still + Ken Burns pan/zoom via FFmpeg
// action scenes: AI video via Kling / RunwayML
import { Command } from "commander";

const program = new Command();

program
  .name("clips")
  .description("Generate video clips from images (stub)")
  .requiredOption("--analyze <dir>", "Path to analyze output dir")
  .requiredOption("--images <dir>", "Path to images output dir")
  .option("--output <dir>", "Output directory (default: out/<slug>)")
  .action(() => {
    console.log("clips: not yet implemented");
    process.exit(1);
  });

program.parse();
