/** Promote prepared GPT text to the working story identity. Restart the editor after promotion. */
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { Schema } from 'effect';
import { StoryTranscript, validateStoryTranscript } from '../dist/modules/story-transcription/contracts.js';
import { StoryManifest } from '../dist/modules/story/contracts.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const { values } = parseArgs({ options: { story: { type: 'string' }, input: { type: 'string' } } });
if (!values.story || !values.input) throw new Error('Required: --story DIRECTORY --input PREPARED_JSON');
const directory = resolve(values.story);
const manifestPath = join(directory, 'story.json');
const originalManifest = await readFile(manifestPath);
const manifest = Schema.decodeUnknownSync(StoryManifest, { onExcessProperty: 'error' })(JSON.parse(originalManifest));
const input = await readFile(values.input);
const transcript = Schema.decodeUnknownSync(StoryTranscript, { onExcessProperty: 'error' })(JSON.parse(input));
validateStoryTranscript(transcript, 1_000_000);
if (transcript.storyId !== manifest.id || transcript.audio.sha256 !== manifest.audioSha256 || transcript.audio.sampleRateHz !== manifest.sampleRateHz
  || transcript.audio.sampleCount !== manifest.sampleCount || transcript.provenance.bookSourceSha256 !== manifest.origin.sourceSha256) throw new Error('Prepared transcript does not belong to this story.');
const runPath = resolve(directory, transcript.provenance.runPath);
if (!runPath.startsWith(directory+'/') || hash(await readFile(runPath)) !== transcript.provenance.runSha256) throw new Error('Transcription run evidence is missing or changed.');
const exists = async path => { try { await stat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const transcriptBytes = Buffer.from(JSON.stringify(transcript, null, 2)+'\n');
const textBytes = Buffer.from(transcript.text);
const next = { ...manifest, transcriptProvider: 'openai', transcriptPath: 'transcript.json', transcriptSha256: hash(transcriptBytes),
  textPath: 'transcript.txt', textSha256: hash(textBytes), wordCount: transcript.wordCount };
if (manifest.transcriptProvider === 'openai' && manifest.transcriptSha256 === next.transcriptSha256) {
  if (!(await readFile(join(directory, manifest.transcriptPath))).equals(transcriptBytes) || !(await readFile(join(directory, manifest.textPath))).equals(textBytes)) throw new Error('Working files differ from the promoted identity.');
  console.log('Already promoted; existing timing preserved.');
  process.exit(0);
}
const shots = join(directory, 'shots');
if (await exists(shots) && (await readdir(shots)).length > 0) throw new Error('This story has visual shots. Migrate their transcript identities and word anchors before promotion.');
const manualPath = join(directory, 'word-timing.json');
if (await exists(manualPath) && Object.keys(JSON.parse(await readFile(manualPath)).words).length > 0) throw new Error('This story has manual word timing. Map those edits to GPT words before promotion.');
const decisionsPath = join(directory, 'decisions.json');
if (await exists(decisionsPath) && Object.keys(JSON.parse(await readFile(decisionsPath)).shots).length > 0) throw new Error('This story has shot decisions. Migrate their word anchors before promotion.');
if (hash(await readFile(join(directory, manifest.transcriptPath))) !== manifest.transcriptSha256
    || hash(await readFile(join(directory, manifest.textPath))) !== manifest.textSha256) throw new Error('Current transcript files differ from their manifest.');
const archive = join(directory, 'archive', `before-gpt-${manifest.transcriptSha256.slice(0,16)}`);
await mkdir(archive, { recursive: true });
const saveOnce = async (name, bytes) => {
  const path = join(archive, name);
  if (await exists(path)) { if (!bytes.equals(await readFile(path))) throw new Error(`Archive conflict: ${path}`); }
  else await writeFile(path, bytes, { flag: 'wx' });
};
await saveOnce('story.json', originalManifest);
for (const [name, path] of [['transcript.json', manifest.transcriptPath], ['transcript.txt', manifest.textPath]]) await saveOnce(name, await readFile(join(directory, path)));
for (const name of ['word-timing.auto.json','word-timing.json','decisions.json']) {
  const path = join(directory, name);
  if (await exists(path)) { await saveOnce(name, await readFile(path)); }
}
if (!(await readFile(manifestPath)).equals(originalManifest)) throw new Error('Story changed during promotion. Nothing published.');
const atomic = async (path, bytes) => { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.tmp`; await writeFile(temp, bytes, { flag: 'wx' }); await rename(temp, path); };
await atomic(join(directory, 'transcript.json'), transcriptBytes);
await atomic(join(directory, 'transcript.txt'), textBytes);
// Old overlays are already archived. They must never be applied to new GPT IDs.
for (const name of ['word-timing.auto.json','word-timing.json','decisions.json']) {
  const path = join(directory, name);
  if (await exists(path)) await rename(path, join(archive, `${name}.previous`));
}
await atomic(manifestPath, Buffer.from(JSON.stringify(next, null, 2)+'\n'));
console.log(`Promoted ${manifest.id}: ${transcript.wordCount} ${transcript.provider.model} words. Prior identity archived at ${archive}.`);
