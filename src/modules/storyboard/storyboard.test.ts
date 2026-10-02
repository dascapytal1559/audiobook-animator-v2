import assert from "node:assert/strict";
import test from "node:test";
import type { ChunkElement } from "@animator/domain";
import { codexDrawInstruction, codexReason, draftPrompt, excerpt, pngSize, readCodexEvents, sketchPrompt, StoryboardJobBook } from "./index.js";

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

test("the prompts carry the story, the description, and the excerpt, ask for a rough greyscale 16:9 hand-drawn sketch, and forbid commands and text in the picture", () => {
  const draft = draftPrompt({ title: "Understand", excerpt: "wake up, [[screaming]]." });
  assert.match(draft, /Story: Understand\nPassage:\nwake up, \[\[screaming\]\]\.$/);
  assert.match(draft, /Reply with only the description\. Do not run commands or read files\./);
  const sketch = sketchPrompt({ title: "Understand", description: "A man sits on the edge of a bed.", excerpt: "I pull off my blankets" });
  for (const phrase of [/hand/, /pencil and ink/, /greyscale only/, /loose/, /16:9/, /No colour, no text/, /The frame shows: A man sits on the edge of a bed\./, /from "Understand" \(context only; do not write it in the picture\): I pull off my blankets/]) assert.match(sketch, phrase);
  assert.doesNotMatch(sketchPrompt({ title: "U", description: "d", excerpt: null }), /Narration/);
  assert.match(codexDrawInstruction(sketch), /^Use your image generation tool to create exactly one image .* Do not run commands, read files, or write files\./);
  assert.ok(codexDrawInstruction(sketch).endsWith(sketch));
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

test("the job book records each renderer's try, then the record or the reason, per story", () => {
  const book = new StoryboardJobBook();
  const job = book.begin("s", "w3");
  assert.equal(book.running("s", "w3"), true);
  assert.equal(book.running("other", "w3"), false);
  book.attempt("s", job.id, "codex-chatgpt");
  book.attemptFailed("s", job.id, "not logged in");
  book.attempt("s", job.id, "qwen-image-2.1");
  book.finish("s", job.id, { recordId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
  const [done] = book.list("s");
  assert.equal(done?.status, "done");
  assert.equal(done?.recordId, "01ARZ3NDEKTSV4RRFFQ69G5FAV");
  assert.deepEqual(done?.attempts.map(a => [a.renderer, a.error ?? null, a.finishedAt !== undefined]), [["codex-chatgpt", "not logged in", true], ["qwen-image-2.1", null, true]]);
  assert.equal(book.running("s", "w3"), false);
  const second = book.begin("s", "w3");
  book.finish("s", second.id, { error: "both failed" });
  assert.deepEqual(book.list("s").map(j => [j.status, j.error ?? null]), [["done", null], ["failed", "both failed"]]);
  assert.deepEqual(book.list("nobody"), []);
});

test("a failed codex turn is reported in its own words, led by the fix when it is a missing login", () => {
  assert.equal(codexReason("  quota\n exceeded "), "quota exceeded");
  assert.equal(codexReason(""), "It gave no reason.");
  assert.match(codexReason("ERROR codex_api: HTTP error: 401 Unauthorized, url: wss://api.openai.com/v1/responses"), /^The Codex CLI is not logged in to ChatGPT; run `codex login`\. ERROR codex_api/);
  assert.match(codexReason("x".repeat(2000)), /^…x{600}$/);
});
