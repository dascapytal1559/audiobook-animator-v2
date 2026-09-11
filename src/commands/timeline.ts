/** The visual timeline of one story: show the merged timeline, add a generation record, or run the one-time seed import. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import { Console, Effect, FileSystem, Option, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import packageJson from "../../package.json" with { type: "json" };
import { loadStoryContext } from "../modules/story/index.js";
import { addShot, DEFAULT_SETTINGS, loadVisualTimeline, ShotMode, type ShotRecord, VisualTimelineError, writeDecisions } from "../modules/visual-timeline/index.js";
import { checkTreatmentRows, PANELS, parseTreatmentTable, PrototypeAssets, PrototypePrompts, prototypeSeeds, type SeedShot, suggestedDecisions, treatmentSeeds } from "../modules/visual-timeline/seed.js";
import { handle, invalid, printJson, run, runFlag, story, storyFlag } from "./shared.js";

const optionalText = (name: string, description: string) => Flag.optional(Flag.string(name)).pipe(Flag.withDescription(description));
const has = <A>(o: Option.Option<A>) => Option.isSome(o);

/** The verified story and the timeline settings a verb works on. */
const target = (flags: { readonly story: Option.Option<string>; readonly run: Option.Option<string> }) => Effect.gen(function* () {
  const settings = yield* run(flags.run);
  const storyDirectory = yield* story(settings, flags.story);
  return { story: yield* loadStoryContext({ storyDirectory, settings: settings.story }), settings: settings.timeline };
});

const show = Command.make("show", { story: storyFlag, run: runFlag }, handle(flags => Effect.gen(function* () {
  yield* printJson(yield* loadVisualTimeline(yield* target(flags)));
}))).pipe(Command.withDescription("Load every generation record under <story>/shots/ and the decisions overlay, verify them against the story, and print the merged candidates and stitched timeline."));

const add = Command.make("add", {
  story: storyFlag, run: runFlag,
  atSample: Flag.optional(Flag.integer("at-sample")).pipe(Flag.withDescription("Start on the clip clock, in samples.")),
  atSeconds: Flag.optional(Flag.float("at-seconds")).pipe(Flag.withDescription("Start on the clip clock, in seconds.")),
  mode: Flag.choice("mode", ShotMode.literals).pipe(Flag.withDescription("Visual mode of the shot.")),
  label: optionalText("label", "Short label."), prompt: optionalText("prompt", "Generation prompt, if any."), notes: optionalText("notes", "Free notes."),
  image: optionalText("image", "Image file to copy beside the record, resolved from the working directory."),
  producerName: Flag.string("producer-name").pipe(Flag.withDefault("visual-timeline-cli"), Flag.withDescription("Who is writing the record.")),
  producerVersion: Flag.string("producer-version").pipe(Flag.withDefault(packageJson.version), Flag.withDescription("Their version.")),
}, handle(flags => Effect.gen(function* () {
  const t = yield* target(flags);
  const record = yield* addShot({ ...t, mode: flags.mode, producer: { name: flags.producerName, version: flags.producerVersion },
    ...(has(flags.atSample) ? { startSample: flags.atSample.value } : {}), ...(has(flags.atSeconds) ? { startSeconds: flags.atSeconds.value } : {}),
    ...(has(flags.label) ? { label: flags.label.value } : {}), ...(has(flags.prompt) ? { prompt: flags.prompt.value } : {}),
    ...(has(flags.image) ? { imageSourcePath: flags.image.value } : {}), ...(has(flags.notes) ? { notes: flags.notes.value } : {}) });
  yield* printJson(record);
}))).pipe(Command.withDescription("Mint a ULID, copy the image beside a new record.json, and print the record. Never overwrites an existing shot."));

const exec = promisify(execFile);
const tool = (file: string, args: ReadonlyArray<string>) => Effect.tryPromise({
  try: () => exec(file, [...args], { maxBuffer: 1 << 20 }),
  catch: e => new VisualTimelineError({ code: "IoFailed", message: `${file} ${args.join(" ")} failed: ${e instanceof Error ? e.message : String(e)}` }),
});
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const IMAGE_NAME = "image.png";
const RECORD_FIELDS = ["startSample", "mode", "label", "prompt", "imagePath", "notes", "createdAt", "producer", "clip"] as const;
const attempt = <A>(f: () => A) => Effect.try({ try: f, catch: e => invalid(e instanceof Error ? e.message : String(e)) });
function decodeText<S extends Schema.Top>(schema: S, text: string, path: string) {
  return Effect.gen(function* () {
    const raw = yield* Effect.try({ try: () => JSON.parse(text) as unknown, catch: () => invalid(`Input is not valid JSON: ${path}.`) });
    return yield* Schema.decodeUnknownEffect(schema, { onExcessProperty: "ignore" })(raw).pipe(Effect.mapError(e => invalid(`Input does not match the required schema: ${path}. ${e.message.replace(/\s+/g, " ")}`)));
  });
}

const seed = Command.make("seed", {
  story: storyFlag, run: runFlag,
  treatment: Flag.string("treatment").pipe(Flag.withDescription("The visual treatment Markdown with the fixed six-column table under \"Proposed sequences\".")),
  prototype: Flag.string("prototype").pipe(Flag.withDescription("The visual-prototype directory with assets.json, prompts.json, and the boards.")),
  dryRun: Flag.boolean("dry-run").pipe(Flag.withDefault(false), Flag.withDescription("Validate everything, including the crops, and print the plan without writing.")),
  ffmpeg: Flag.string("ffmpeg").pipe(Flag.withDefault("ffmpeg")), ffprobe: Flag.string("ffprobe").pipe(Flag.withDefault("ffprobe")),
}, handle(flags => Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const t = yield* target(flags);
  const timeline = yield* loadVisualTimeline(t);
  const { clip } = timeline;
  const shotsDirectory = join(timeline.storyDirectory, "shots");
  const decisionsPath = join(timeline.storyDirectory, "decisions.json");
  const treatmentPath = resolve(flags.treatment);
  const markdown = yield* fs.readFileString(treatmentPath).pipe(Effect.mapError(() => invalid(`Cannot read the treatment: ${treatmentPath}.`)));
  const rows = yield* attempt(() => parseTreatmentTable(markdown));
  yield* attempt(() => checkTreatmentRows(rows, clip));
  const prototypeDirectory = resolve(flags.prototype);
  const readText = (name: string) => fs.readFileString(join(prototypeDirectory, name)).pipe(Effect.mapError(() => invalid(`Cannot read ${join(prototypeDirectory, name)}.`)));
  const assets = yield* decodeText(PrototypeAssets, yield* readText("assets.json"), join(prototypeDirectory, "assets.json"));
  const prompts = yield* decodeText(PrototypePrompts, yield* readText("prompts.json"), join(prototypeDirectory, "prompts.json"));
  if (prompts.panelsPerAsset !== PANELS.length) return yield* Effect.fail(invalid(`prompts.json declares ${prompts.panelsPerAsset} panels per asset, expected ${PANELS.length}.`));
  for (const board of assets.assets) {
    const path = join(prototypeDirectory, board.path);
    const bytes = yield* fs.readFile(path).pipe(Effect.mapError(() => invalid(`Cannot read prototype board: ${path}.`)));
    if (bytes.byteLength !== board.byteLength || sha256(bytes) !== board.sha256) return yield* Effect.fail(invalid(`Prototype board does not match assets.json (byteLength/sha256): ${path}.`));
  }
  const seeds: ReadonlyArray<SeedShot> = [...(yield* attempt(() => treatmentSeeds(rows, clip.sampleRateHz))), ...(yield* attempt(() => prototypeSeeds(assets.assets, prompts.prompts, clip.sampleRateHz)))];
  if (new Set(seeds.map(s => s.id)).size !== seeds.length) return yield* Effect.fail(invalid("Derived seed ids collide."));
  const temp = yield* Effect.tryPromise({ try: () => mkdtemp(join(tmpdir(), "visual-timeline-seed-")), catch: () => new VisualTimelineError({ code: "IoFailed", message: "Cannot create a temporary directory." }) });
  const work = Effect.gen(function* () {
    const panels = new Map<string, { readonly path: string; readonly sha256: string }>();
    for (const s of seeds) {
      if (!s.image) continue;
      const { crop } = s.image;
      const out = join(temp, `${s.id}.png`);
      yield* tool(flags.ffmpeg, ["-v", "error", "-y", "-i", join(prototypeDirectory, s.image.boardPath), "-vf", `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`, "-frames:v", "1", out]);
      const probe = yield* tool(flags.ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", out]);
      if (probe.stdout.trim() !== `${crop.width},${crop.height}`) return yield* Effect.fail(new VisualTimelineError({ code: "IoFailed", message: `Cropped panel ${s.key} is ${probe.stdout.trim()}, expected ${crop.width},${crop.height}.` }));
      panels.set(s.id, { path: out, sha256: sha256(yield* fs.readFile(out).pipe(Effect.mapError(() => new VisualTimelineError({ code: "IoFailed", message: `Cannot read ${out}.` })))) });
    }
    const byId = new Map(timeline.records.map(r => [r.id, r] as const));
    const mismatches: string[] = [];
    const additions: SeedShot[] = [];
    for (const s of seeds) {
      const existing = byId.get(s.id);
      if (!existing) { additions.push(s); continue; }
      const expected: ShotRecord = { schemaVersion: 1, kind: "visual-shot-generation", id: s.id, clip, startSample: s.startSample, mode: s.mode, label: s.label,
        ...(s.prompt !== undefined ? { prompt: s.prompt } : {}), ...(s.image ? { imagePath: IMAGE_NAME } : {}), notes: s.notes, createdAt: s.createdAt, producer: s.producer };
      const different: string[] = RECORD_FIELDS.filter(k => !isDeepStrictEqual(existing[k], expected[k]));
      if (s.image && existing.imagePath !== undefined) {
        const imagePath = join(shotsDirectory, s.id, existing.imagePath);
        const bytes = yield* fs.readFile(imagePath).pipe(Effect.mapError(() => new VisualTimelineError({ code: "IoFailed", message: `Cannot read ${imagePath}.` })));
        if (sha256(bytes) !== panels.get(s.id)!.sha256) different.push("image bytes");
      }
      if (different.length > 0) mismatches.push(`${s.id} (${s.key}): ${different.join(", ")}`);
      else yield* Console.log(`unchanged  ${s.id}  ${String(s.startSample).padStart(9)}  ${s.label}`);
    }
    if (mismatches.length > 0) return yield* Effect.fail(new VisualTimelineError({ code: "RecordExists", message: `Existing records differ from the seed; nothing was written. Differing fields:\n  ${mismatches.join("\n  ")}` }));
    for (const s of additions) {
      const image = panels.get(s.id);
      if (!flags.dryRun) {
        yield* addShot({ ...t, id: s.id, startSample: s.startSample, mode: s.mode, label: s.label, notes: s.notes, createdAt: s.createdAt, producer: s.producer,
          ...(s.prompt !== undefined ? { prompt: s.prompt } : {}), ...(image ? { imageSourcePath: image.path } : {}) });
      }
      yield* Console.log(`${flags.dryRun ? "would add" : "added    "}  ${s.id}  ${String(s.startSample).padStart(9)}  ${s.label}`);
    }
    const decisionsExist = yield* fs.exists(decisionsPath).pipe(Effect.mapError(() => new VisualTimelineError({ code: "IoFailed", message: `Cannot inspect ${decisionsPath}.` })));
    let decisionsStatus: string;
    if (decisionsExist) decisionsStatus = `decisions.json already exists; left untouched: ${decisionsPath}`;
    else {
      const shots = yield* attempt(() => suggestedDecisions(seeds));
      const selected = Object.keys(shots).map(id => seeds.find(s => s.id === id)!.label).join(", ");
      if (flags.dryRun) decisionsStatus = `would write decisions.json selecting: ${selected}`;
      else { yield* writeDecisions({ ...t, decisions: { settings: DEFAULT_SETTINGS, shots } }); decisionsStatus = `wrote decisions.json selecting: ${selected}`; }
    }
    yield* Console.log(`\n${seeds.length} seed records: ${seeds.length - additions.length} unchanged, ${additions.length} ${flags.dryRun ? "to add (dry run, nothing written)" : "added"}.\n${decisionsStatus}`);
  });
  yield* work.pipe(Effect.ensuring(Effect.promise(() => rm(temp, { recursive: true, force: true }))));
}))).pipe(Command.withDescription("One-time seed import (A33): the treatment spans as image-less records and the prototype panels, cropped with ffmpeg, as image records, all with deterministic ULIDs so a re-run is a no-op. Writes a suggested decisions.json only when none exists. Progress lines go to stderr."));

export const timelineCommand = Command.make("timeline").pipe(Command.withDescription("The storyboard of one story: immutable generation records under shots/ and the decisions overlay."), Command.withSubcommands([show, add, seed]));
