import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChunkElement, ClipIdentity } from "@animator/domain";
import { NodeServices } from "@effect/platform-node";
import { Effect, type FileSystem } from "effect";
import { codexDrawInstruction, codexReason, describePrompt, editPrompt, excerpt, framePrompt, listStationImages, listStationVersions, mixPrompt, placeShots, planPrompt, pngSize, readCodexEvents, readDirectionReply, readDirectionsReply, readPlanReply,
  sketchPrompt, stationImagePath, StoryboardJobBook, writeStationImage, writeStationVersion } from "./index.js";

const word = (id: string, value: string): ChunkElement => ({ kind: "word", id, value, startSample: 0, endSample: 1 });
const space = (value = " "): ChunkElement => ({ kind: "punctuation", value });
const elements: ReadonlyArray<ChunkElement> = [word("w0", "I"), space(), word("w1", "wake"), space(), word("w2", "up"), space(", "), word("w3", "screaming"), space(". "), word("w4", "My"), space(), word("w5", "heart"), space(".")];

test("an excerpt quotes the narration as written around a word, marking it or a span from it when asked, and is null for a word the transcript lacks", () => {
  assert.equal(excerpt(elements, "w3", 2, 3, "w3"), "wake up, [[screaming]]. My heart");
  assert.equal(excerpt(elements, "w3", 0, 2, null), "screaming. My");
  assert.equal(excerpt(elements, "w0", 5, 1, "w0"), "[[I]]");
  assert.equal(excerpt(elements, "w5", 1, 9, null), "My heart.");
  assert.equal(excerpt(elements, "w1", 1, 4, "w3"), "I [[wake up, screaming]]. My", "a span is marked from its first word through its last");
  assert.equal(excerpt(elements, "w3", 0, 2, "w1"), "screaming. My", "an end before the word marks nothing");
  assert.equal(excerpt(elements, "gone", 1, 1, "gone"), null);
});

test("a first pass's drawing prompt carries the story, the description, and the excerpt, asks for a plain black line drawing in 16:9 with no colour, shading, or lettering, and forbids commands and text in the picture", () => {
  const sketch = sketchPrompt({ title: "Understand", description: "A man sits on the edge of a bed.", excerpt: "I pull off my blankets" });
  for (const phrase of [/drawn by hand/, /plain black line art on a solid, opaque white background/, /clean contour lines/, /No colour, no grey tones, no shading or hatching, no texture, no lettering/, /staging, framing, and composition, not style/, /16:9/,
    /not how they are coloured or lit/, /The frame shows: A man sits on the edge of a bed\./, /from "Understand" \(context only; do not write it in the picture\): I pull off my blankets/]) assert.match(sketch, phrase);
  assert.doesNotMatch(sketch, /pencil|greyscale|off-white|gestural/);
  assert.doesNotMatch(sketchPrompt({ title: "U", description: "d", excerpt: null }), /Narration/);
  assert.match(codexDrawInstruction(sketch), /^Use your image generation tool to create exactly one image .* Do not run commands, read files, or write files\./);
  assert.ok(codexDrawInstruction(sketch).endsWith(sketch));
});

test("a first pass's plan prompt numbers the section's sentences, gives the context before it, names the shots to keep, and asks for JSON of opening words and 30 to 60 word descriptions", () => {
  const prompt = planPrompt({ title: "Understand", section: { kind: "beat", title: "The drowning nightmare", summary: "Leon dreams." }, before: null, sentences: ["A layer of ice.", "I wake up, screaming."], kept: ["I wake up, screaming."] });
  assert.match(prompt, /one beat of the story, one sentence per numbered line/);
  assert.match(prompt, /Give a sentence at most one shot of its own\. Merge consecutive sentences .* split a long sentence only where the picture clearly changes/);
  assert.match(prompt, /The first shot begins at the beat's first word\./);
  assert.match(prompt, /keep each as a shot that starts exactly there: "I wake up, screaming\."\./);
  assert.match(prompt, /30 to 60 words of plain present-tense description .* subject, action, setting, framing, and light/);
  assert.match(prompt, /\{"shots": \[\{"opens": "\.\.\.", "description": "\.\.\."\}\]\}\. Do not run commands or read files\./);
  assert.match(prompt, /Story: Understand\nBeat: The drowning nightmare \(Leon dreams\.\)\nThe beat:\n1\. A layer of ice\.\n2\. I wake up, screaming\.$/);
  const withContext = planPrompt({ title: "U", section: { kind: "scene", title: "S" }, before: "It was dark.", sentences: ["Then light."], kept: [] });
  assert.match(withContext, /Scene: S\nNarration just before it \(context only; no shots here\): It was dark\.\nThe scene:\n1\. Then light\.$/);
  assert.doesNotMatch(withContext, /already begin/);
});

test("a plan's reply is the JSON object inside it, fenced or not; entries without both strings are dropped, and a reply with no usable shot is null", () => {
  const shots = { shots: [{ opens: " A layer of ice ", description: "Ice  fills\nthe frame." }, { opens: "x" }, { opens: "I wake up", description: "A man sits up." }] };
  assert.deepEqual(readPlanReply("```json\n" + JSON.stringify(shots) + "\n```"), [{ opens: "A layer of ice", text: "Ice fills the frame." }, { opens: "I wake up", text: "A man sits up." }]);
  assert.equal(readPlanReply("no json here"), null);
  assert.equal(readPlanReply("{ not json }"), null);
  assert.equal(readPlanReply(JSON.stringify({ shots: [] })), null);
  assert.equal(readPlanReply(JSON.stringify({ frames: [{ opens: "a", description: "b" }] })), null);
});

test("proposed shots are placed on the word their quote begins at, in order after the shot before, ignoring case, punctuation, and apostrophes; a quote not found in the section is unmatched", () => {
  const words = ["Understand", "A", "layer", "of", "ice.", "I've", "got", "nothing.", "I", "wake", "up,", "screaming.", "The", "same", "nightmare,", "again.", "The", "same", "nightmare.", "Next", "beat"].map((value, i) => ({ id: `w${i}`, value }));
  const { placed, unmatched } = placeShots(words, 0, 18, [
    { opens: "Understand. A layer", text: "title" },
    { opens: "i’VE GOT nothing", text: "nothing" },
    { opens: "I wake up, screaming. My heart", text: "waking, the quote runs on past what was said" },
    { opens: "The same nightmare", text: "first" },
    { opens: "The same nightmare", text: "second use of the phrase" },
    { opens: "Next beat", text: "outside the section" },
    { opens: "A layer of ice", text: "before the shot before it" },
  ]);
  assert.deepEqual(placed.map(p => [p.anchorWordId, p.text]), [["w0", "title"], ["w5", "nothing"], ["w8", "waking, the quote runs on past what was said"], ["w12", "first"], ["w16", "second use of the phrase"]]);
  assert.deepEqual(unmatched.map(u => u.opens), ["Next beat", "A layer of ice"]);
  assert.deepEqual(placeShots(words, 8, 18, [{ opens: "layer of ice", text: "before the section" }]).placed, []);
});

test("codex exec events give the thread, the agent's messages, and its errors; other lines are ignored", () => {
  const stdout = [
    "Reading additional input from stdin...",
    JSON.stringify({ type: "thread.started", thread_id: "01a0-thread" }),
    JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: " done \n" } }),
    JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "reasoning", text: "hidden" } }),
    JSON.stringify({ type: "error", message: "usage limit reached" }),
    JSON.stringify({ type: "turn.failed", error: { message: "stream closed" } }),
  ].join("\n");
  assert.deepEqual(readCodexEvents(stdout), { threadId: "01a0-thread", messages: ["done"], errors: ["usage limit reached", "stream closed"] });
  assert.deepEqual(readCodexEvents(""), { threadId: null, messages: [], errors: [] });
});

test("pngSize reads the header and refuses anything else", () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  assert.deepEqual(pngSize(png), { width: 1, height: 1 });
  assert.equal(pngSize(Buffer.from("not a png at all, no header here")), null);
});

test("the job book queues each drawing, runs a few at a time, and records each renderer's try, then the record, image, or reason, per story", async () => {
  const book = new StoryboardJobBook(1);
  const gate: Array<() => void> = [];
  const first = book.queue("s", { kind: "frame", anchorWordId: "w3", firstPassId: "01ARZ3NDEKTSV4RRFFQ69G5FAW" }, report => Effect.gen(function* () {
    report.onAttempt("codex-chatgpt");
    report.onAttemptFailed("codex-chatgpt", "not logged in");
    report.onAttempt("qwen-image-2.1");
    yield* Effect.promise(() => new Promise<void>(resolve => gate.push(resolve)));
    return { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" };
  }));
  const second = book.queue("s", { kind: "station", anchorWordId: "w5", versionId: "01ARZ3NDEKTSV4RRFFQ69G5FB0", direction: 2 }, () => Effect.fail({ message: "both failed" }));
  assert.deepEqual([first.job.status, second.job.status, first.job.firstPassId, second.job.firstPassId, second.job.versionId, second.job.direction], ["queued", "queued", "01ARZ3NDEKTSV4RRFFQ69G5FAW", undefined, "01ARZ3NDEKTSV4RRFFQ69G5FB0", 2]);
  assert.equal(book.pending("s", job => job.kind === "frame" && job.anchorWordId === "w3"), true);
  assert.equal(book.pending("s", job => job.kind === "station" && job.anchorWordId === "w3"), false, "a frame drawing and a station drawing of one shot are pending apart");
  assert.equal(book.pending("other", () => true), false);
  const runs = Effect.runPromise(Effect.all([first.run, second.run], { concurrency: "unbounded" }));
  while (gate.length === 0) await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(book.list("s").map(j => j.status), ["running", "queued"], "one turn: the second waits while the first draws");
  gate[0]!();
  const [done, failed] = await runs;
  assert.equal(done.status, "done");
  assert.equal(done.recordId, "01ARZ3NDEKTSV4RRFFQ69G5FAV");
  assert.deepEqual(done.attempts.map(a => [a.renderer, a.error ?? null, a.finishedAt !== undefined]), [["codex-chatgpt", "not logged in", true], ["qwen-image-2.1", null, true]]);
  assert.deepEqual([failed.status, failed.error], ["failed", "both failed"]);
  assert.deepEqual(book.list("s").map(j => j.status), ["done", "failed"]);
  assert.equal(book.pending("s", () => true), false);
  const station = await Effect.runPromise(book.queue("s", { kind: "station", anchorWordId: "w9", versionId: "01ARZ3NDEKTSV4RRFFQ69G5FB1", direction: 0 }, () => Effect.succeed({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAX" })).run);
  assert.deepEqual([station.kind, station.imageId, station.recordId], ["station", "01ARZ3NDEKTSV4RRFFQ69G5FAX", undefined], "a station drawing names the image it wrote, not a record");
  const defect = await Effect.runPromise(book.queue("s", { kind: "frame", anchorWordId: "w7" }, () => Effect.die("boom")).run);
  assert.match(defect.error ?? "", /^The drawing stopped unexpectedly: boom/);
  assert.deepEqual(book.list("nobody"), []);
});

test("a failed codex turn is reported in its own words, led by the fix when it is a missing login", () => {
  assert.equal(codexReason("  quota\n exceeded "), "quota exceeded");
  assert.equal(codexReason(""), "It gave no reason.");
  assert.match(codexReason("ERROR codex_api: HTTP error: 401 Unauthorized, url: wss://api.openai.com/v1/responses"), /^The Codex CLI is not logged in to ChatGPT; run `codex login`\. ERROR codex_api/);
  assert.match(codexReason("x".repeat(2000)), /^…x{600}$/);
});

const clip: ClipIdentity = { bookId: "b", storyId: "s", audioSha256: "a".repeat(64), transcriptSha256: "b".repeat(64), sampleRateHz: 48000, sampleCount: 96000 };
const direction = { title: "Gallery at dusk", description: "A keeper stands on the lighthouse gallery as the lamp turns.", prompt: "A lighthouse keeper on the iron gallery at dusk, seen from below, the beam sweeping across a violet sky.", motion: null, motionOptions: ["slow push in"] };
test("station prompts quote the director's words as given, mark the span in the passage, and ask for directions as JSON with a title, a description, a prompt, motion, and motion options", () => {
  const describe = describePrompt({ title: "Understand", excerpt: "wake up, [[screaming]].", director: "  a keeper on the lighthouse gallery, um, the camera low  ", count: 4 });
  assert.match(describe, /described the shot they imagine, in their own words\. It was typed or dictated/);
  assert.match(describe, /"""\na keeper on the lighthouse gallery, um, the camera low\n"""/);
  assert.match(describe, /Propose 4 different directions for this shot, each one still frame of a wide 16:9 film\. Every direction keeps everything the director asked for/);
  for (const field of ["title", "description", "prompt", "motion", "motionOptions"]) assert.match(describe, new RegExp(`- "${field}": `));
  assert.match(describe, /describing anyone it shows by how they look rather than by name; no text, captions, or lettering in the picture/);
  assert.match(describe, /\{"directions": \[\{"title": "\.\.\.", "description": "\.\.\.", "prompt": "\.\.\.", "motion": "\.\.\.", "motionOptions": \["\.\.\.", "\.\.\.", "\.\.\."\]\}\]\}\. Do not run commands or read files\./);
  assert.match(describe, /\nStory: Understand\nPassage:\nwake up, \[\[screaming\]\]\.$/);
  const mix = mixPrompt({ title: "U", excerpt: "x", director: "a keeper on the gallery", instruction: " the light of 1, the framing of 3 ", chosen: [{ number: 1, direction }, { number: 3, direction: { ...direction, title: "Wide", motion: "crane up" } }] });
  assert.match(mix, /They chose these directions for the shot and want one that combines them:\nDirection 1: Gallery at dusk\n  Description: A keeper stands[^\n]*\n  Image prompt: A lighthouse keeper[^\n]*\n  Motion: none, a still frame\nDirection 3: Wide\n[\s\S]*  Motion: crane up\n/);
  assert.match(mix, /How to combine them, in the director's words \(typed or dictated\): """\nthe light of 1, the framing of 3\n"""/);
  assert.match(mix, /^You are helping[^\n]*\nThe director described the shot covering the narration marked \[\[like this\]\] in the passage below as:\n"""\na keeper on the gallery\n"""/);
  assert.match(mixPrompt({ title: "U", excerpt: "x", director: null, instruction: "", chosen: [{ number: 1, direction }, { number: 2, direction }] }), /Combine what is strongest in each into one coherent frame\./);
  const edit = editPrompt({ title: "U", excerpt: "x", director: null, direction, instruction: "make the sky red" });
  assert.match(edit, /This is the shot's direction now:\nDirection: Gallery at dusk\n/);
  assert.match(edit, /The director asks for this change, in their own words \(typed or dictated\): """\nmake the sky red\n"""/);
  assert.match(edit, /change what the director asks for, and keep everything else as it is, including the prompt's wording wherever the change does not touch it/);
  assert.doesNotMatch(edit, /The director described the shot/);
  assert.match(edit, /Reply with only a JSON object: \{"title": /);
});

test("a station frame is drawn from its image prompt as written, in 16:9 with no lettering, keeping the colour and style the prompt names", () => {
  const frame = framePrompt("  A red sky over the lighthouse. ");
  assert.match(frame, /^One still frame from an animated film, wide 16:9 landscape, drawn exactly as the prompt describes\. No text, captions, speech bubbles, borders, or watermarks\.\n\nPrompt: A red sky over the lighthouse\.$/);
  assert.doesNotMatch(frame, /black line|no colour/i);
});

test("a station reply's directions are read from the JSON inside it; entries missing a field are dropped, motion of none is a still, and motion options are trimmed to three distinct ones", () => {
  const reply = "```json\n" + JSON.stringify({ directions: [
    { title: " Gallery  at dusk ", description: "A face.", prompt: "A pale face.", motion: "slow push in", motionOptions: ["a", "a", "b", "c", "d", ""] },
    { title: "No prompt", description: "x" },
    { title: "Still", description: "Ice.", prompt: "Ice.", motion: "None", motionOptions: "not a list" },
  ] }) + "\n```";
  assert.deepEqual(readDirectionsReply(reply), [
    { title: "Gallery at dusk", description: "A face.", prompt: "A pale face.", motion: "slow push in", motionOptions: ["a", "b", "c"] },
    { title: "Still", description: "Ice.", prompt: "Ice.", motion: null, motionOptions: [] },
  ]);
  assert.equal(readDirectionsReply("no json"), null);
  assert.equal(readDirectionsReply(JSON.stringify({ directions: [{ title: "x" }] })), null);
  assert.deepEqual(readDirectionReply(`Here: ${JSON.stringify({ title: "T", description: "D", prompt: "P", motion: "" })}`), { title: "T", description: "D", prompt: "P", motion: null, motionOptions: [] });
  assert.equal(readDirectionReply("{ broken"), null);
});

test("station versions and image tries are each published once in their own directory and listed oldest first; a try keeps its image or why it failed; a record of another clip fails the listing", async () => {
  const story = await mkdtemp(join(tmpdir(), "shot-station-"));
  const image = join(story, "..", `${story.split("/").at(-1)}-drawn.png`);
  await writeFile(image, Buffer.from("png bytes"));
  const target = { storyDirectory: story, clip, maxImageBytes: 1024 };
  const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
  const producer = { name: "t", version: "1" };
  assert.deepEqual([await run(listStationVersions(target)), await run(listStationImages(target))], [[], []]);
  const first = await run(writeStationVersion(target, { shotWordId: "w3", span: { startWordId: "w3", endWordId: "w9" }, parentId: null, action: { kind: "describe", director: "a keeper on the gallery", count: 2 },
    writer: { model: "openai/gpt-6-astra", prompt: "p", seconds: 9 }, directions: [direction, { ...direction, title: "Wide" }], producer }));
  const picked = await run(writeStationVersion(target, { shotWordId: "w3", span: first.span, parentId: first.id, action: { kind: "pick", direction: 1 }, writer: null, directions: [{ ...direction, title: "Wide", carried: { versionId: first.id, direction: 1 } }], producer }));
  assert.deepEqual((await run(listStationVersions(target))).map(v => [v.id, v.action.kind, v.parentId]), [[first.id, "describe", null], [picked.id, "pick", first.id]]);
  const failed = await run(writeStationImage(target, { versionId: first.id, direction: 1, prompt: "frame", producer, drawn: { error: "not logged in" } }));
  const drawn = await run(writeStationImage(target, { versionId: first.id, direction: 1, prompt: "frame", producer, drawn: { renderer: "codex-chatgpt", notes: "n", imageSourcePath: image } }));
  assert.deepEqual([failed.error, failed.imagePath, stationImagePath(target, failed)], ["not logged in", undefined, null]);
  assert.deepEqual([drawn.renderer, drawn.imagePath, drawn.error], ["codex-chatgpt", "image.png", undefined]);
  assert.equal(stationImagePath(target, drawn), join(story, "shot-station", "images", drawn.id, "image.png"));
  assert.deepEqual((await readdir(join(story, "shot-station", "images", drawn.id))).sort(), ["image.json", "image.png"]);
  assert.deepEqual((await run(listStationImages(target))).map(i => i.id), [failed.id, drawn.id]);
  await mkdir(join(story, "shot-station", "versions", "01ARZ3NDEKTSV4RRFFQ69G5FAZ"));
  await writeFile(join(story, "shot-station", "versions", "01ARZ3NDEKTSV4RRFFQ69G5FAZ", "version.json"), JSON.stringify({ ...first, id: "01ARZ3NDEKTSV4RRFFQ69G5FAZ", clip: { ...clip, storyId: "elsewhere" } }));
  await assert.rejects(run(listStationVersions(target)), /version\.json belongs to another clip than s's/);
});
