import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual, parseArgs, promisify } from "node:util";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Schema } from "effect";
import { loadStoryContext, StoryError } from "./modules/story/index.js";
import { addShot, DEFAULT_SETTINGS, loadVisualTimeline, type ShotRecord, VisualTimelineError, writeDecisions } from "./modules/visual-timeline/index.js";
import { loadRun, RunError, selectStory } from "./run.js";
import { checkTreatmentRows, PANELS, parseTreatmentTable, PrototypeAssets, PrototypePrompts, prototypeSeeds, type SeedShot, suggestedDecisions, treatmentSeeds } from "./modules/visual-timeline/seed.js";

const usage = `Usage:
  node dist/visual-timeline-seed.js --story <id> [--run <file>] --treatment <visual-treatment.md> --prototype <visual-prototype dir> [--dry-run] [--ffmpeg PATH] [--ffprobe PATH]

One-time seed import for The Great Silence (PIPELINE A33 / B17). Imports the 14 treatment spans as image-less records and the 15 prototype
panels (each board cropped into thirds with ffmpeg) as image records, all with deterministic ULIDs, so re-running is a no-op: an existing
record must equal what would be written or the run fails with a diff summary. Writes a suggested decisions.json only when none exists.
--dry-run validates everything, including the crops, and prints the plan without writing into the story directory.
--ffmpeg / --ffprobe default to the PATH commands. Treatment and prototype paths resolve from the working directory. Nothing is ever deleted.
Without --story the available ids are listed. Settings are the code defaults unless --run names a JSON file that overrides some of them.`;

const invalid = (message: string) => new VisualTimelineError({ code: "InvalidRequest", message });
const attempt = <A>(f: () => A) => Effect.try({ try: f, catch: e => invalid(e instanceof Error ? e.message : String(e)) });
const exec = promisify(execFile);
const tool = (file: string, args: ReadonlyArray<string>) => Effect.tryPromise({
  try: () => exec(file, [...args], { maxBuffer: 1 << 20 }),
  catch: e => new VisualTimelineError({ code: "IoFailed", message: `${file} ${args.join(" ")} failed: ${e instanceof Error ? e.message : String(e)}` }),
});
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const IMAGE_NAME = "image.png";
const RECORD_FIELDS = ["startSample", "mode", "label", "prompt", "imagePath", "notes", "createdAt", "producer", "clip"] as const;

function decodeJson<S extends Schema.Top>(schema: S, text: string, path: string) {
  return Effect.gen(function* () {
    const raw = yield* Effect.try({ try: () => JSON.parse(text) as unknown, catch: () => invalid(`Input is not valid JSON: ${path}.`) });
    return yield* Schema.decodeUnknownEffect(schema, { onExcessProperty: "ignore" })(raw).pipe(
      Effect.mapError(e => invalid(`Input does not match the required schema: ${path}. ${e.message.replace(/\s+/g, " ")}`)));
  });
}

const main = Effect.gen(function* () {
  const values = yield* Effect.try({
    try: () => parseArgs({ options: { story: { type: "string" }, run: { type: "string" }, treatment: { type: "string" }, prototype: { type: "string" }, "dry-run": { type: "boolean" },
      ffmpeg: { type: "string" }, ffprobe: { type: "string" }, help: { type: "boolean" } }, strict: true, allowPositionals: false }).values,
    catch: () => invalid("Invalid arguments. Run with --help for usage."),
  });
  if (values.help) return yield* Console.error(usage);
  if (!values.treatment || !values.prototype) return yield* Effect.fail(invalid("Supply explicit --treatment and --prototype paths. Run with --help for usage."));
  const dryRun = values["dry-run"] === true;
  const ffmpeg = values.ffmpeg ?? "ffmpeg";
  const ffprobe = values.ffprobe ?? "ffprobe";
  const fs = yield* FileSystem.FileSystem;
  const run = yield* loadRun(values.run);
  const story = yield* loadStoryContext({ storyDirectory: yield* selectStory(run, values.story), settings: run.story });
  const target = { story, settings: run.timeline };
  const timeline = yield* loadVisualTimeline(target);
  const { clip } = timeline;
  const shotsDirectory = join(timeline.storyDirectory, "shots");
  const decisionsPath = join(timeline.storyDirectory, "decisions.json");

  // Treatment spans.
  const treatmentPath = resolve(values.treatment);
  const markdown = yield* fs.readFileString(treatmentPath).pipe(Effect.mapError(() => invalid(`Cannot read the treatment: ${treatmentPath}.`)));
  const rows = yield* attempt(() => parseTreatmentTable(markdown));
  yield* attempt(() => checkTreatmentRows(rows, clip));

  // Prototype boards: manifest, prompts, and every board verified against its recorded hash before cropping.
  const prototypeDirectory = resolve(values.prototype);
  const readText = (name: string) => fs.readFileString(join(prototypeDirectory, name)).pipe(Effect.mapError(() => invalid(`Cannot read ${join(prototypeDirectory, name)}.`)));
  const assets = yield* decodeJson(PrototypeAssets, yield* readText("assets.json"), join(prototypeDirectory, "assets.json"));
  const prompts = yield* decodeJson(PrototypePrompts, yield* readText("prompts.json"), join(prototypeDirectory, "prompts.json"));
  if (prompts.panelsPerAsset !== PANELS.length) return yield* Effect.fail(invalid(`prompts.json declares ${prompts.panelsPerAsset} panels per asset, expected ${PANELS.length}.`));
  for (const board of assets.assets) {
    const path = join(prototypeDirectory, board.path);
    const bytes = yield* fs.readFile(path).pipe(Effect.mapError(() => invalid(`Cannot read prototype board: ${path}.`)));
    if (bytes.byteLength !== board.byteLength || sha256(bytes) !== board.sha256) return yield* Effect.fail(invalid(`Prototype board does not match assets.json (byteLength/sha256): ${path}.`));
  }
  const seeds: ReadonlyArray<SeedShot> = [...(yield* attempt(() => treatmentSeeds(rows, clip.sampleRateHz))), ...(yield* attempt(() => prototypeSeeds(assets.assets, prompts.prompts, clip.sampleRateHz)))];
  if (new Set(seeds.map(s => s.id)).size !== seeds.length) return yield* Effect.fail(invalid("Derived seed ids collide."));

  // Crop every panel into a temp directory and verify its geometry, in dry-run too, so the plan is fully validated.
  const temp = yield* Effect.tryPromise({ try: () => mkdtemp(join(tmpdir(), "visual-timeline-seed-")), catch: () => new VisualTimelineError({ code: "IoFailed", message: "Cannot create a temporary directory." }) });
  const work = Effect.gen(function* () {
    const panels = new Map<string, { readonly path: string; readonly sha256: string }>();
    for (const seed of seeds) {
      if (!seed.image) continue;
      const { crop } = seed.image;
      const out = join(temp, `${seed.id}.png`);
      yield* tool(ffmpeg, ["-v", "error", "-y", "-i", join(prototypeDirectory, seed.image.boardPath), "-vf", `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`, "-frames:v", "1", out]);
      const probe = yield* tool(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", out]);
      if (probe.stdout.trim() !== `${crop.width},${crop.height}`) return yield* Effect.fail(new VisualTimelineError({ code: "IoFailed", message: `Cropped panel ${seed.key} is ${probe.stdout.trim()}, expected ${crop.width},${crop.height}.` }));
      panels.set(seed.id, { path: out, sha256: sha256(yield* fs.readFile(out).pipe(Effect.mapError(() => new VisualTimelineError({ code: "IoFailed", message: `Cannot read ${out}.` })))) });
    }

    // Compare against existing records before writing anything; any difference aborts the whole run.
    const byId = new Map(timeline.records.map(r => [r.id, r] as const));
    const mismatches: string[] = [];
    const additions: SeedShot[] = [];
    for (const seed of seeds) {
      const existing = byId.get(seed.id);
      if (!existing) { additions.push(seed); continue; }
      const expected: ShotRecord = { schemaVersion: 1, kind: "visual-shot-generation", id: seed.id, clip, startSample: seed.startSample, mode: seed.mode, label: seed.label,
        ...(seed.prompt !== undefined ? { prompt: seed.prompt } : {}), ...(seed.image ? { imagePath: IMAGE_NAME } : {}), notes: seed.notes, createdAt: seed.createdAt, producer: seed.producer };
      const different: string[] = RECORD_FIELDS.filter(k => !isDeepStrictEqual(existing[k], expected[k]));
      if (seed.image && existing.imagePath !== undefined) {
        const imagePath = join(shotsDirectory, seed.id, existing.imagePath);
        const bytes = yield* fs.readFile(imagePath).pipe(Effect.mapError(() => new VisualTimelineError({ code: "IoFailed", message: `Cannot read ${imagePath}.` })));
        if (sha256(bytes) !== panels.get(seed.id)!.sha256) different.push("image bytes");
      }
      if (different.length > 0) mismatches.push(`${seed.id} (${seed.key}): ${different.join(", ")}`);
      else yield* Console.log(`unchanged  ${seed.id}  ${String(seed.startSample).padStart(9)}  ${seed.label}`);
    }
    if (mismatches.length > 0) return yield* Effect.fail(new VisualTimelineError({ code: "RecordExists", message: `Existing records differ from the seed; nothing was written. Differing fields:\n  ${mismatches.join("\n  ")}` }));
    for (const seed of additions) {
      const image = panels.get(seed.id);
      if (!dryRun) {
        yield* addShot({ ...target, id: seed.id, startSample: seed.startSample, mode: seed.mode, label: seed.label, notes: seed.notes, createdAt: seed.createdAt, producer: seed.producer,
          ...(seed.prompt !== undefined ? { prompt: seed.prompt } : {}), ...(image ? { imageSourcePath: image.path } : {}) });
      }
      yield* Console.log(`${dryRun ? "would add" : "added    "}  ${seed.id}  ${String(seed.startSample).padStart(9)}  ${seed.label}`);
    }

    // Suggested decisions: only ever written when no overlay exists.
    const decisionsExist = yield* fs.exists(decisionsPath).pipe(Effect.mapError(() => new VisualTimelineError({ code: "IoFailed", message: `Cannot inspect ${decisionsPath}.` })));
    let decisionsStatus: string;
    if (decisionsExist) decisionsStatus = `decisions.json already exists; left untouched: ${decisionsPath}`;
    else {
      const shots = yield* attempt(() => suggestedDecisions(seeds));
      const selected = Object.keys(shots).map(id => seeds.find(s => s.id === id)!.label).join(", ");
      if (dryRun) decisionsStatus = `would write decisions.json selecting: ${selected}`;
      else { yield* writeDecisions({ ...target, decisions: { settings: DEFAULT_SETTINGS, shots } }); decisionsStatus = `wrote decisions.json selecting: ${selected}`; }
    }
    yield* Console.log(`\n${seeds.length} seed records: ${seeds.length - additions.length} unchanged, ${additions.length} ${dryRun ? "to add (dry run, nothing written)" : "added"}.\n${decisionsStatus}`);
  });
  yield* work.pipe(Effect.ensuring(Effect.promise(() => rm(temp, { recursive: true, force: true }))));
});

main.pipe(
  Effect.catch((error) => Console.error(error instanceof VisualTimelineError || error instanceof StoryError || error instanceof RunError ? `${error.code}: ${error.message}` : "Cannot seed the visual timeline.").pipe(
    Effect.andThen(Effect.sync(() => { process.exitCode = 1; })),
  )),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
