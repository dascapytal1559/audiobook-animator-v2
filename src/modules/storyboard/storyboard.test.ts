import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChunkElement, ClipIdentity } from "@animator/domain";
import { NodeServices } from "@effect/platform-node";
import { Effect, type FileSystem } from "effect";
import { codexDrawInstruction, codexReason, draftPrompt, excerpt, listDraftDrawings, placeShots, planPrompt, pngSize, readCodexEvents, readDraftDrawing, readPlanReply, removeDraftDrawings, sketchPrompt, StoryboardJobBook, writeDraftDrawing } from "./index.js";

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

test("a draft in the drafting space revises the current description and follows the director's request, quoting the shot's narration", () => {
  const plain = draftPrompt({ title: "Understand", excerpt: "I [[wake up]]." });
  assert.match(plain, /the frame that covers the narration marked \[\[like this\]\]/);
  assert.doesNotMatch(plain, /described now|director/);
  const revised = draftPrompt({ title: "Understand", excerpt: "I [[wake up]].", current: "A man in bed.", request: " make it a close-up on his hands " });
  assert.match(revised, /The shot is described now as: "A man in bed\."\nThe director asks for this: "make it a close-up on his hands"\. Follow it, and keep what it does not change from the description now\./);
  assert.match(draftPrompt({ title: "U", excerpt: "x", request: "she's older" }), /The director asks for this: "she's older"\. Follow it\.\n/);
  assert.match(draftPrompt({ title: "U", excerpt: "x", current: "  ", request: "" }), /marked \[\[like this\]\] in the passage below, for as long as the narration stays on that moment\.\nWrite 30 to 60 words/);
});

test("the prompts carry the story, the description, and the excerpt, ask for a plain black line drawing in 16:9 with no colour, shading, or lettering, and forbid commands and text in the picture", () => {
  const draft = draftPrompt({ title: "Understand", excerpt: "wake up, [[screaming]]." });
  assert.match(draft, /Story: Understand\nPassage:\nwake up, \[\[screaming\]\]\.$/);
  assert.match(draft, /Reply with only the description\. Do not run commands or read files\./);
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

test("the job book queues each drawing, runs a few at a time, and records each renderer's try, then the record or the reason, per story", async () => {
  const book = new StoryboardJobBook(1);
  const gate: Array<() => void> = [];
  const first = book.queue("s", "frame", "w3", report => Effect.gen(function* () {
    report.onAttempt("codex-chatgpt");
    report.onAttemptFailed("codex-chatgpt", "not logged in");
    report.onAttempt("qwen-image-2.1");
    yield* Effect.promise(() => new Promise<void>(resolve => gate.push(resolve)));
    return { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" };
  }), "01ARZ3NDEKTSV4RRFFQ69G5FAW");
  const second = book.queue("s", "draft", "w5", () => Effect.fail({ message: "both failed" }));
  assert.deepEqual([first.job.status, second.job.status, first.job.firstPassId, second.job.firstPassId], ["queued", "queued", "01ARZ3NDEKTSV4RRFFQ69G5FAW", undefined]);
  assert.equal(book.pending("s", "w3", "frame"), true);
  assert.equal(book.pending("s", "w3", "draft"), false, "a frame drawing and a draft drawing of one shot are pending apart");
  assert.equal(book.pending("other", "w3", "frame"), false);
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
  assert.equal(book.pending("s", "w3", "frame"), false);
  const draft = await Effect.runPromise(book.queue("s", "draft", "w9", () => Effect.succeed({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAX" })).run);
  assert.deepEqual([draft.kind, draft.draftId, draft.recordId], ["draft", "01ARZ3NDEKTSV4RRFFQ69G5FAX", undefined], "a draft drawing names the draft it wrote, not a record");
  const defect = await Effect.runPromise(book.queue("s", "frame", "w7", () => Effect.die("boom")).run);
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
test("a draft drawing is published with a copy of its image, replaces the shot's earlier one, is read back by id, and is removed on discard; a draft of another clip fails the listing", async () => {
  const story = await mkdtemp(join(tmpdir(), "storyboard-drafts-"));
  const image = join(story, "..", `${story.split("/").at(-1)}-drawn.png`);
  await writeFile(image, Buffer.from("png bytes"));
  const target = { storyDirectory: story, clip, maxImageBytes: 1024 };
  const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
  const fields = { startWordId: "w3", description: "A man in bed.", renderer: "codex-chatgpt" as const, prompt: "p", notes: "n", imageSourcePath: image, producer: { name: "t", version: "1" } };
  assert.deepEqual(await run(listDraftDrawings(target)), []);
  const first = await run(writeDraftDrawing(target, { ...fields, anchorWordId: "w3" }));
  const other = await run(writeDraftDrawing(target, { ...fields, anchorWordId: "w9" }));
  const second = await run(writeDraftDrawing(target, { ...fields, anchorWordId: "w3", description: "Closer." }));
  assert.deepEqual((await run(listDraftDrawings(target))).map(d => [d.anchorWordId, d.description]), [["w9", "A man in bed."], ["w3", "Closer."]], "the newer drawing replaced the shot's earlier one");
  assert.deepEqual([second.kind, second.imagePath, second.clip.storyId], ["storyboard-draft-drawing", "image.png", "s"]);
  assert.deepEqual((await readdir(join(story, "storyboard-drafts"))).sort(), [other.id, second.id].sort());
  assert.equal((await run(readDraftDrawing(target, second.id))).id, second.id);
  await assert.rejects(run(readDraftDrawing(target, first.id)), /No draft drawing .* saved or discarded already/);
  assert.deepEqual(await run(removeDraftDrawings(target, "w3")), [second.id]);
  assert.deepEqual((await run(listDraftDrawings(target))).map(d => d.anchorWordId), ["w9"]);
  await mkdir(join(story, "storyboard-drafts", "01ARZ3NDEKTSV4RRFFQ69G5FAZ"));
  await writeFile(join(story, "storyboard-drafts", "01ARZ3NDEKTSV4RRFFQ69G5FAZ", "draft.json"), JSON.stringify({ ...other, id: "01ARZ3NDEKTSV4RRFFQ69G5FAZ", clip: { ...clip, storyId: "elsewhere" } }));
  await assert.rejects(run(listDraftDrawings(target)), /draft\.json belongs to another clip than s's/);
});
