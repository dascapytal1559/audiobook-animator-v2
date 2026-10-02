import { test } from "node:test";
import assert from "node:assert/strict";
import type { StoryboardDraft, StoryboardJob, StoryResponse } from "./api.js";
import { jobLine, openingWords, rendererLabel, takeToSave } from "./storyboard-view.js";

test("a shot reads by the words spoken from its anchor on", () => {
  const elements: StoryResponse["elements"] = [{ kind: "word", id: "a" }, { kind: "punctuation", value: " " }, { kind: "word", id: "b" }, { kind: "punctuation", value: ". " }, { kind: "word", id: "c" }];
  const words = new Map([["a", { value: "I" }], ["b", { value: "wake" }], ["c", { value: "Christ" }]]);
  assert.equal(openingWords(elements, words, "b", 6), "wake Christ");
  assert.equal(openingWords(elements, words, "a", 2), "I wake");
  assert.equal(openingWords(elements, words, "zz", 2), "zz");
});

test("the job line says who is drawing and for how long, why a renderer failed, and who drew it", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 3, 0, 0, s)).toISOString();
  const now = Date.parse(at(50));
  const running: StoryboardJob = { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", anchorWordId: "w", status: "running", startedAt: at(0), attempts: [{ renderer: "codex-chatgpt", startedAt: at(2) }] };
  assert.equal(jobLine(running, now), "Drawing with ChatGPT (Codex CLI)… 48 s");
  const fellBack: StoryboardJob = { ...running, attempts: [{ renderer: "codex-chatgpt", startedAt: at(2), finishedAt: at(5), error: "not logged in" }, { renderer: "qwen-image-2.1", startedAt: at(5) }] };
  assert.equal(jobLine(fellBack, now), "Drawing with local Qwen Image 2.1… 45 s. ChatGPT (Codex CLI) failed: not logged in");
  assert.equal(jobLine({ ...fellBack, status: "done", attempts: [fellBack.attempts[0]!, { renderer: "qwen-image-2.1", startedAt: at(5), finishedAt: at(40) }] }, now), "Drawn by local Qwen Image 2.1 in 35 s. ChatGPT (Codex CLI) failed: not logged in");
  assert.equal(jobLine({ ...running, status: "failed", error: "x", attempts: [{ renderer: "codex-chatgpt", startedAt: at(2), finishedAt: at(5), error: "quota" }, { renderer: "qwen-image-2.1", startedAt: at(5), finishedAt: at(6), error: "not installed" }] }, now),
    "Drawing failed. ChatGPT (Codex CLI) failed: quota local Qwen Image 2.1 failed: not installed");
  assert.equal(rendererLabel("something-else"), "something-else");
});

test("a draft saved as drafted is the model's take; an edited or typed one is the user's", () => {
  const draft: StoryboardDraft = { anchorWordId: "w", text: "A man wakes.", model: "openai/gpt-6-astra", prompt: "p", seconds: 3 };
  assert.deepEqual(takeToSave("w", " A man wakes. ", draft), { anchorWordId: "w", model: "openai/gpt-6-astra", text: "A man wakes.", prompt: "p", notes: "Drafted in the Storyboard section and saved unchanged." });
  assert.deepEqual(takeToSave("w", "A man wakes, gasping.", draft), { anchorWordId: "w", model: "user", text: "A man wakes, gasping.", notes: "Edited from a draft by openai/gpt-6-astra." });
  assert.deepEqual(takeToSave("w", "Typed.", null), { anchorWordId: "w", model: "user", text: "Typed." });
  assert.deepEqual(takeToSave("v", "A man wakes.", draft), { anchorWordId: "v", model: "user", text: "A man wakes." }, "a draft for another word is not this take's source");
});
