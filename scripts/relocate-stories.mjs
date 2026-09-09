#!/usr/bin/env node
// Move every verified story out of its book's split directory into data/stories/<story-id>/ and write the story manifest.
//
//   node scripts/relocate-stories.mjs --books data/books --stories data/stories --evidence data/story-relocation.json [--dry-run]
//
// For each book under --books with a complete split/inventory.json, every entry of kind "story" moves:
//   split/segments/<id>/audio/            -> <stories>/<id>/audio/
//   split/segments/<id>/transcript.json   -> <stories>/<id>/transcript.json
//   split/segments/<id>/transcript.txt    -> <stories>/<id>/transcript.txt
// and <stories>/<id>/story.json is written from the inventory entry, the book's synopses.json, and the split provenance.
// A book's planning/<id>/ directory, if present, is merged into <stories>/<id>/ entry by entry. Notes and credits stay in the book.
// Every moved file is hashed before and after the rename; any mismatch aborts before anything else moves. Already-relocated
// stories are verified and skipped, so the script can be rerun. Superseded book-level views (synopses.json, the combined
// books/inventory.md and inventory.json) are removed once their content is carried by the manifests, and their hashes recorded.
// The evidence file records every move and removal with hashes; reruns append to it. Nothing is ever overwritten.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { books: { type: "string" }, stories: { type: "string" }, evidence: { type: "string" }, "dry-run": { type: "boolean" } }, strict: true });
if (!values.books || !values.stories || !values.evidence) { console.error("Supply --books, --stories, and --evidence paths."); process.exit(2); }
const dryRun = values["dry-run"] === true;
const booksRoot = resolve(values.books);
const storiesRoot = resolve(values.stories);
const evidencePath = resolve(values.evidence);
const ID = /^[a-z0-9][a-z0-9-]{0,100}$/;

const sha256 = path => new Promise((done, failed) => {
  const hash = createHash("sha256");
  createReadStream(path).on("data", chunk => hash.update(chunk)).on("end", () => done(hash.digest("hex"))).on("error", failed);
});
const exists = path => stat(path).then(() => true, () => false);
const readJson = async path => JSON.parse(await readFile(path, "utf8"));
const encode = value => `${JSON.stringify(value, null, 2)}\n`;
const rel = (from, to) => relative(from, to).split("/").join("/");
const fail = message => { throw new Error(message); };

function durationDisplay(samples, rate) {
  const total = Math.round((samples / rate) * 1000);
  const seconds = Math.floor(total / 1000);
  return `${Math.floor(seconds / 3600).toString().padStart(2, "0")}:${Math.floor((seconds % 3600) / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}.${(total % 1000).toString().padStart(3, "0")}`;
}

/** The four files of one paired story, as { name, from, to } with the name relative to the segment directory. */
const pairFiles = (segment, target) => ["audio/audio.flac", "audio/manifest.json", "transcript.json", "transcript.txt"].map(name => ({ name, from: join(segment, name), to: join(target, name) }));

async function fingerprint(path) {
  const info = await stat(path);
  if (!info.isFile()) fail(`Not a regular file: ${path}`);
  return { path, byteLength: info.size, sha256: await sha256(path) };
}

/** Build the manifest for one inventory entry. Paths inside the manifest are relative to the story directory. */
function manifestFor({ bookId, inventory, inventoryPath, inventorySha256, entry, synopsis, target, segment }) {
  return {
    schemaVersion: 1, kind: "story-manifest", id: entry.id, title: entry.title,
    book: { id: bookId, title: inventory.bookTitle },
    spoilerPolicy: "premise-only", synopsis,
    wordCount: entry.wordCount, sampleCount: entry.sampleCount, sampleRateHz: entry.sampleRateHz, durationSeconds: entry.durationSeconds, durationDisplay: entry.durationDisplay,
    audioPath: "audio/audio.flac", audioSha256: entry.audioSha256, audioManifestPath: "audio/manifest.json", audioManifestSha256: entry.audioManifestSha256,
    transcriptPath: "transcript.json", transcriptSha256: entry.transcriptSha256, textPath: "transcript.txt", textSha256: entry.textSha256,
    origin: {
      splitInventoryPath: rel(target, inventoryPath), splitInventorySha256: inventorySha256, segmentPath: rel(target, segment),
      planSha256: inventory.planSha256, transcriptSha256: inventory.transcriptSha256, sourceSha256: inventory.sourceSha256, providerJobId: inventory.providerJobId,
    },
  };
}

const log = [];
const moves = [];
const removals = [];
const say = line => { log.push(line); console.log(line); };

async function moveVerified(from, to) {
  const before = await fingerprint(from);
  if (await exists(to)) fail(`Destination already exists: ${to}`);
  if (dryRun) { moves.push({ from, to, ...before, path: undefined, verified: "dry-run" }); return; }
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
  const after = await fingerprint(to);
  if (after.sha256 !== before.sha256 || after.byteLength !== before.byteLength) fail(`Content changed while moving ${from} -> ${to}; stopping.`);
  moves.push({ from, to, byteLength: before.byteLength, sha256: before.sha256, verified: "sha256-before-and-after-rename" });
}

/** Move every entry of a directory into target (no overwrites), then remove the emptied directory. */
async function mergeDirectory(source, target) {
  const entries = (await readdir(source)).filter(e => e !== ".DS_Store");
  for (const entry of entries) {
    const from = join(source, entry);
    const to = join(target, entry);
    if (await exists(to)) fail(`Cannot merge ${from}: ${to} already exists.`);
    if ((await stat(from)).isDirectory()) {
      // Directories move as a unit; hash-verify every file inside before and after.
      const files = await listFiles(from);
      const before = new Map();
      for (const file of files) before.set(rel(from, file), await fingerprint(file));
      if (dryRun) { say(`would move ${from} -> ${to} (${files.length} files)`); continue; }
      await rename(from, to);
      for (const [name, fp] of before) {
        const after = await fingerprint(join(to, name));
        if (after.sha256 !== fp.sha256 || after.byteLength !== fp.byteLength) fail(`Content changed while moving ${from}/${name}; stopping.`);
        moves.push({ from: join(from, name), to: join(to, name), byteLength: fp.byteLength, sha256: fp.sha256, verified: "sha256-before-and-after-rename" });
      }
    } else {
      if (dryRun) { say(`would move ${from} -> ${to}`); continue; }
      await moveVerified(from, to);
    }
    say(`moved ${from} -> ${to}`);
  }
  if (!dryRun) await removeIfEmpty(source);
}
async function listFiles(directory) {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") { await rm(join(directory, entry.name)); continue; }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(path)); else if (entry.isFile()) out.push(path); else fail(`Unexpected entry type: ${path}`);
  }
  return out;
}
async function removeIfEmpty(directory) {
  const left = (await readdir(directory)).filter(e => e !== ".DS_Store");
  if (left.length > 0) fail(`Directory not empty after relocation: ${directory} (${left.join(", ")})`);
  await rm(join(directory, ".DS_Store"), { force: true });
  await rmdir(directory);
  say(`removed empty ${directory}`);
}
async function removeSuperseded(path) {
  if (!(await exists(path))) return;
  const fp = await fingerprint(path);
  removals.push({ path, byteLength: fp.byteLength, sha256: fp.sha256, reason: "content carried by story manifests; regenerated under the stories directory" });
  if (dryRun) { say(`would remove ${path}`); return; }
  await rm(path);
  say(`removed ${path}`);
}

async function relocateBook(bookId) {
  const bookDir = join(booksRoot, bookId);
  const inventoryPath = join(bookDir, "split", "inventory.json");
  if (!(await exists(inventoryPath))) { say(`skip ${bookId}: no split/inventory.json`); return; }
  const inventoryBytes = await readFile(inventoryPath);
  const inventory = JSON.parse(inventoryBytes.toString("utf8"));
  if (inventory.kind !== "verified-story-inventory" || inventory.status !== "complete") fail(`Inventory is not a complete verified inventory: ${inventoryPath}`);
  const inventorySha256 = createHash("sha256").update(inventoryBytes).digest("hex");
  const synopsisPath = join(bookDir, "synopses.json");
  const synopses = (await exists(synopsisPath)) ? await readJson(synopsisPath) : null;
  const synopsisOf = id => {
    if (synopses === null) return null;
    const hit = synopses.stories.find(s => s.storyId === id);
    return hit ? hit : fail(`No synopsis for ${id} in ${synopsisPath}`);
  };
  for (const entry of inventory.stories) {
    if (entry.kind !== "story" || !ID.test(entry.id)) fail(`Unexpected story entry ${JSON.stringify(entry.id)} in ${inventoryPath}`);
    const segment = join(bookDir, "split", "segments", entry.id);
    const target = join(storiesRoot, entry.id);
    const manifestPath = join(target, "story.json");
    if (entry.durationDisplay !== durationDisplay(entry.sampleCount, entry.sampleRateHz)) fail(`durationDisplay disagrees with samples for ${entry.id}`);
    if (await exists(manifestPath)) {
      const existing = await readJson(manifestPath);
      if (existing.book?.id !== bookId || existing.transcriptSha256 !== entry.transcriptSha256 || existing.audioSha256 !== entry.audioSha256) fail(`A different story already occupies ${target}`);
      for (const file of pairFiles(segment, target)) {
        const fp = await fingerprint(file.to);
        const expected = { "audio/audio.flac": entry.audioSha256, "audio/manifest.json": entry.audioManifestSha256, "transcript.json": entry.transcriptSha256, "transcript.txt": entry.textSha256 }[file.name];
        if (fp.sha256 !== expected) fail(`Relocated file does not match the inventory hash: ${file.to}`);
      }
      say(`verified ${entry.id}: already relocated`);
    } else {
      if (await exists(target)) fail(`Story directory exists without a manifest: ${target}`);
      const files = pairFiles(segment, target);
      for (const file of files) if (!(await exists(file.from))) fail(`Missing source file: ${file.from}`);
      const expected = { "audio/audio.flac": entry.audioSha256, "audio/manifest.json": entry.audioManifestSha256, "transcript.json": entry.transcriptSha256, "transcript.txt": entry.textSha256 };
      for (const file of files) {
        const fp = await fingerprint(file.from);
        if (fp.sha256 !== expected[file.name]) fail(`Source file does not match the inventory hash: ${file.from}`);
      }
      const synopsis = synopsisOf(entry.id);
      if (synopsis === null) fail(`No synopses.json for ${bookId}; every story needs a synopsis in its manifest.`);
      if (synopsis.title !== entry.title || synopsis.transcriptSha256 !== entry.transcriptSha256) fail(`Synopsis title or transcript hash does not match ${entry.id}`);
      const manifest = manifestFor({ bookId, inventory, inventoryPath, inventorySha256, entry, synopsis: synopsis.synopsis, target, segment });
      if (dryRun) { say(`would relocate ${entry.id} -> ${target}`); for (const file of files) moves.push({ from: file.from, to: file.to, sha256: expected[file.name], verified: "dry-run" }); }
      else {
        await mkdir(join(target, "audio"), { recursive: true });
        for (const file of files) await moveVerified(file.from, file.to);
        await writeFile(manifestPath, encode(manifest), { flag: "wx" });
        await removeIfEmpty(join(segment, "audio"));
        await removeIfEmpty(segment);
        say(`relocated ${entry.id} -> ${target}`);
      }
    }
    const planning = join(bookDir, "planning", entry.id);
    if (await exists(planning)) { await mergeDirectory(planning, target); say(`merged planning for ${entry.id}`); }
  }
  const planningRoot = join(bookDir, "planning");
  if (await exists(planningRoot) && !dryRun) {
    const left = (await readdir(planningRoot)).filter(e => e !== ".DS_Store");
    if (left.length === 0) await removeIfEmpty(planningRoot); else say(`kept ${planningRoot}: still holds ${left.join(", ")}`);
  }
  await removeSuperseded(synopsisPath);
}

const started = new Date().toISOString();
await mkdir(storiesRoot, { recursive: true });
const books = (await readdir(booksRoot, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
const seen = new Map();
for (const bookId of books) {
  const inventoryPath = join(booksRoot, bookId, "split", "inventory.json");
  if (!(await exists(inventoryPath))) continue;
  for (const entry of (await readJson(inventoryPath)).stories) {
    if (seen.has(entry.id)) fail(`Story id ${entry.id} appears in both ${seen.get(entry.id)} and ${bookId}; story ids must be unique across books.`);
    seen.set(entry.id, bookId);
  }
}
for (const bookId of books) await relocateBook(bookId);
await removeSuperseded(join(booksRoot, "inventory.md"));
await removeSuperseded(join(booksRoot, "inventory.json"));

const run = { ranAt: started, finishedAt: new Date().toISOString(), dryRun, booksRoot, storiesRoot, moves, removals, log };
if (!dryRun) {
  const previous = (await exists(evidencePath)) ? await readJson(evidencePath) : { schemaVersion: 1, kind: "story-relocation", runs: [] };
  previous.runs.push(run);
  await writeFile(evidencePath, encode(previous));
  say(`evidence written to ${evidencePath}`);
} else say(`dry run: ${moves.length} moves, ${removals.length} removals; nothing written`);
