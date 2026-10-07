import assert from "node:assert/strict";
import test from "node:test";
import type { ChunkElement } from "@animator/domain";
import { Effect } from "effect";
import { codexDrawInstruction, codexReason, draftPrompt, excerpt, placeShots, planPrompt, pngSize, readCodexEvents, readPlanReply, sketchPrompt, StoryboardJobBook } from "./index.js";

const word = (id: string, value: string): ChunkElement => ({ kind: "word", id, value, startSample: 0, endSample: 1 });
const space = (value = " "): ChunkElement => ({ kind: "punctuation", value });
const elements: ReadonlyArray<ChunkElement> = [word("w0", "I"), space(), word("w1", "wake"), space(), word("w2", "up"), space(", "), word("w3", "screaming"), space(". "), word("w4", "My"), space(), word("w5", "heart"), space(".")];

test("an excerpt quotes the narration as written around a word, marking it when asked, and is null for a word the transcript lacks", () => {
  assert.equal(excerpt(elements, "w3", 2, 3, true), "wake up, [[screaming]]. My heart");
  assert.equal(excerpt(elements, "w3", 0, 2, false), "screaming. My");
  assert.equal(excerpt(elements, "w0", 5, 1, true), "[[I]]");
  assert.equal(excerpt(elements, "w5", 1, 9, false), "My heart.");
  assert.equal(excerpt(elements, "gone", 1, 1, true), null);
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
  const first = book.queue("s", "w3", report => Effect.gen(function* () {
    report.onAttempt("codex-chatgpt");
    report.onAttemptFailed("codex-chatgpt", "not logged in");
    report.onAttempt("qwen-image-2.1");
    yield* Effect.promise(() => new Promise<void>(resolve => gate.push(resolve)));
    return { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" };
  }), "01ARZ3NDEKTSV4RRFFQ69G5FAW");
  const second = book.queue("s", "w5", () => Effect.fail({ message: "both failed" }));
  assert.deepEqual([first.job.status, second.job.status, first.job.firstPassId, second.job.firstPassId], ["queued", "queued", "01ARZ3NDEKTSV4RRFFQ69G5FAW", undefined]);
  assert.equal(book.pending("s", "w3"), true);
  assert.equal(book.pending("other", "w3"), false);
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
  assert.equal(book.pending("s", "w3"), false);
  const defect = await Effect.runPromise(book.queue("s", "w7", () => Effect.die("boom")).run);
  assert.match(defect.error ?? "", /^The drawing stopped unexpectedly: boom/);
  assert.deepEqual(book.list("nobody"), []);
});

test("a failed codex turn is reported in its own words, led by the fix when it is a missing login", () => {
  assert.equal(codexReason("  quota\n exceeded "), "quota exceeded");
  assert.equal(codexReason(""), "It gave no reason.");
  assert.match(codexReason("ERROR codex_api: HTTP error: 401 Unauthorized, url: wss://api.openai.com/v1/responses"), /^The Codex CLI is not logged in to ChatGPT; run `codex login`\. ERROR codex_api/);
  assert.match(codexReason("x".repeat(2000)), /^…x{600}$/);
});
