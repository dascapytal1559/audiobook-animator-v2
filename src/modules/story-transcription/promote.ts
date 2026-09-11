/** Promote prepared GPT text to the story's working transcript identity. Plain Node I/O, run once per story; restart the editor afterwards. */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Schema } from "effect";
import { StoryManifest } from "../story/contracts.js";
import { StoryTranscript, validateStoryTranscript } from "./contracts.js";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const exists = async (path: string) => { try { await stat(path); return true; } catch (e) { if ((e as { code?: string }).code === "ENOENT") return false; throw e; } };
const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, value: unknown) => Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(value);

export type PromoteResult = { readonly promoted: boolean; readonly message: string };

/**
 * Check the prepared transcript belongs to this story and its run evidence is intact, refuse while shots, manual timing, or decisions still
 * reference the old word ids, archive the prior identity and overlays, then replace transcript.json, transcript.txt, and the manifest's
 * transcript fields atomically. Promoting the same prepared text again is a no-op that keeps existing timing.
 */
export async function promoteStoryTranscript(options: { readonly storyDirectory: string; readonly inputPath: string; readonly maxElements: number }): Promise<PromoteResult> {
  const directory = resolve(options.storyDirectory);
  const manifestPath = join(directory, "story.json");
  const originalManifest = await readFile(manifestPath);
  const manifest = decode(StoryManifest, JSON.parse(originalManifest.toString("utf8")));
  const transcript = decode(StoryTranscript, JSON.parse(await readFile(options.inputPath, "utf8")));
  validateStoryTranscript(transcript, options.maxElements);
  if (transcript.storyId !== manifest.id || transcript.audio.sha256 !== manifest.audioSha256 || transcript.audio.sampleRateHz !== manifest.sampleRateHz
    || transcript.audio.sampleCount !== manifest.sampleCount || transcript.provenance.bookSourceSha256 !== manifest.origin.sourceSha256) throw new Error("Prepared transcript does not belong to this story.");
  const runPath = resolve(directory, transcript.provenance.runPath);
  if (!runPath.startsWith(`${directory}/`) || hash(await readFile(runPath)) !== transcript.provenance.runSha256) throw new Error("Transcription run evidence is missing or changed.");
  const transcriptBytes = Buffer.from(`${JSON.stringify(transcript, null, 2)}\n`);
  const textBytes = Buffer.from(transcript.text);
  const next = { ...manifest, transcriptProvider: "openai" as const, transcriptPath: "transcript.json", transcriptSha256: hash(transcriptBytes), textPath: "transcript.txt", textSha256: hash(textBytes), wordCount: transcript.wordCount };
  if (manifest.transcriptProvider === "openai" && manifest.transcriptSha256 === next.transcriptSha256) {
    if (!(await readFile(join(directory, manifest.transcriptPath))).equals(transcriptBytes) || !(await readFile(join(directory, manifest.textPath))).equals(textBytes)) throw new Error("Working files differ from the promoted identity.");
    return { promoted: false, message: "Already promoted; existing timing preserved." };
  }
  const shots = join(directory, "shots");
  if (await exists(shots) && (await readdir(shots)).length > 0) throw new Error("This story has visual shots. Migrate their transcript identities and word anchors before promotion.");
  const manualPath = join(directory, "word-timing.json");
  if (await exists(manualPath) && Object.keys((JSON.parse(await readFile(manualPath, "utf8")) as { words: object }).words).length > 0) throw new Error("This story has manual word timing. Map those edits to GPT words before promotion.");
  const decisionsPath = join(directory, "decisions.json");
  if (await exists(decisionsPath) && Object.keys((JSON.parse(await readFile(decisionsPath, "utf8")) as { shots: object }).shots).length > 0) throw new Error("This story has shot decisions. Migrate their word anchors before promotion.");
  if (hash(await readFile(join(directory, manifest.transcriptPath))) !== manifest.transcriptSha256 || hash(await readFile(join(directory, manifest.textPath))) !== manifest.textSha256) throw new Error("Current transcript files differ from their manifest.");
  const archive = join(directory, "archive", `before-gpt-${manifest.transcriptSha256.slice(0, 16)}`);
  await mkdir(archive, { recursive: true });
  const saveOnce = async (name: string, bytes: Buffer) => {
    const path = join(archive, name);
    if (await exists(path)) { if (!bytes.equals(await readFile(path))) throw new Error(`Archive conflict: ${path}`); }
    else await writeFile(path, bytes, { flag: "wx" });
  };
  await saveOnce("story.json", originalManifest);
  for (const [name, path] of [["transcript.json", manifest.transcriptPath], ["transcript.txt", manifest.textPath]] as const) await saveOnce(name, await readFile(join(directory, path)));
  for (const name of ["word-timing.auto.json", "word-timing.json", "decisions.json"]) {
    const path = join(directory, name);
    if (await exists(path)) await saveOnce(name, await readFile(path));
  }
  if (!(await readFile(manifestPath)).equals(originalManifest)) throw new Error("Story changed during promotion. Nothing published.");
  const atomic = async (path: string, bytes: Buffer) => { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.tmp`; await writeFile(temp, bytes, { flag: "wx" }); await rename(temp, path); };
  await atomic(join(directory, "transcript.json"), transcriptBytes);
  await atomic(join(directory, "transcript.txt"), textBytes);
  // Old overlays are already archived. They must never be applied to new GPT ids.
  for (const name of ["word-timing.auto.json", "word-timing.json", "decisions.json"]) {
    const path = join(directory, name);
    if (await exists(path)) await rename(path, join(archive, `${name}.previous`));
  }
  await atomic(manifestPath, Buffer.from(`${JSON.stringify(next, null, 2)}\n`));
  return { promoted: true, message: `Promoted ${manifest.id}: ${transcript.wordCount} ${transcript.provider.model} words. Prior identity archived at ${archive}.` };
}
