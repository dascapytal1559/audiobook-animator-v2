import { test } from "node:test";
import assert from "node:assert/strict";
import type { ResolvedSection, StoryboardDraft, StoryboardFirstPassShot, StoryboardJob, StoryResponse } from "./api.js";
import { judgeSpan } from "@animator/domain";
import { EMPTY_DRAFT, firstPassLine, firstPassProgress, firstPassSection, isEmptyDraft, jobLine, openingWords, parseShotDrafts, rendererLabel, spanLines, spanText, takeToSave } from "./storyboard-view.js";

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
  const running: StoryboardJob = { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", kind: "frame", anchorWordId: "w", status: "running", requestedAt: at(0), attempts: [{ renderer: "codex-chatgpt", startedAt: at(2) }] };
  assert.equal(jobLine(running, now), "Drawing with ChatGPT (Codex CLI)… 48 s");
  const fellBack: StoryboardJob = { ...running, attempts: [{ renderer: "codex-chatgpt", startedAt: at(2), finishedAt: at(5), error: "not logged in" }, { renderer: "qwen-image-2.1", startedAt: at(5) }] };
  assert.equal(jobLine(fellBack, now), "Drawing with local Qwen Image 2.1… 45 s. ChatGPT (Codex CLI) failed: not logged in");
  assert.equal(jobLine({ ...fellBack, status: "done", attempts: [fellBack.attempts[0]!, { renderer: "qwen-image-2.1", startedAt: at(5), finishedAt: at(40) }] }, now), "Drawn by local Qwen Image 2.1 in 35 s. ChatGPT (Codex CLI) failed: not logged in");
  assert.equal(jobLine({ ...running, status: "failed", error: "x", attempts: [{ renderer: "codex-chatgpt", startedAt: at(2), finishedAt: at(5), error: "quota" }, { renderer: "qwen-image-2.1", startedAt: at(5), finishedAt: at(6), error: "not installed" }] }, now),
    "Drawing failed. ChatGPT (Codex CLI) failed: quota local Qwen Image 2.1 failed: not installed");
  assert.equal(jobLine({ ...running, status: "queued", attempts: [] }, now), "Waiting for a free renderer… 50 s");
  assert.equal(rendererLabel("something-else"), "something-else");
});

test("a draft saved as drafted is the model's take; an edited or typed one is the user's", () => {
  const draft: StoryboardDraft = { anchorWordId: "w", text: "A man wakes.", model: "openai/gpt-6-astra", prompt: "p", seconds: 3 };
  assert.deepEqual(takeToSave(" A man wakes. ", draft), { model: "openai/gpt-6-astra", text: "A man wakes.", prompt: "p", notes: "Drafted in the Storyboard section and saved unchanged." });
  assert.deepEqual(takeToSave("A man wakes, gasping.", draft), { model: "user", text: "A man wakes, gasping.", notes: "Edited from a draft by openai/gpt-6-astra." });
  assert.deepEqual(takeToSave("Typed.", null), { model: "user", text: "Typed." });
});

test("a span reads as written, punctuation and all, from its first word through its last", () => {
  const elements: StoryResponse["elements"] = [{ kind: "word", id: "a" }, { kind: "punctuation", value: " " }, { kind: "word", id: "b" }, { kind: "punctuation", value: ", " }, { kind: "word", id: "c" }, { kind: "punctuation", value: "." }];
  const words = new Map([["a", { value: "I" }], ["b", { value: "wake" }], ["c", { value: "screaming" }]]);
  assert.equal(spanText(elements, words, "a", "c"), "I wake, screaming.");
  assert.equal(spanText(elements, words, "b", "b"), "wake,");
  assert.equal(spanText(elements, words, "c", "a"), "", "an end before the start reads as nothing");
});

test("the drafts a browser kept are read back part by part; anything malformed is dropped, and an empty draft is no draft", () => {
  const source: StoryboardDraft = { anchorWordId: "w1", text: "A man wakes.", model: "openai/gpt-6-astra", prompt: "p", seconds: 3 };
  const kept = parseShotDrafts({
    w1: { request: "closer", text: "A man wakes.", source, span: { startWordId: "w1", endWordId: "w4" } },
    w2: { request: 3, text: "Typed.", source: { text: "not a draft" }, span: { startWordId: "w2" } },
    w3: { request: "", text: null, source, span: null },
    w4: "junk",
  });
  assert.deepEqual(kept, { w1: { request: "closer", text: "A man wakes.", source, span: { startWordId: "w1", endWordId: "w4" } }, w2: { request: "", text: "Typed.", source: null, span: null } });
  assert.deepEqual([parseShotDrafts(null), parseShotDrafts([1]), parseShotDrafts("x")], [{}, {}, {}]);
  assert.equal(isEmptyDraft(EMPTY_DRAFT), true);
  assert.equal(isEmptyDraft({ ...EMPTY_DRAFT, request: "x" }), false);
});

test("the span lines say which words a drafted span gives or takes, that a moved shot is saved anew, and where a drawn-in end starts an empty frame", () => {
  const bounds = { first: 2, last: 9 };
  const opening = (index: number) => `word ${index}`;
  const lines = (current: { start: number; end: number } | null, start: number, end: number, hasBefore = true) => spanLines({ current, start, end, judged: judgeSpan(bounds, current?.start ?? null, start, end), hasBefore, opening });
  assert.deepEqual(lines({ start: 4, end: 9 }, 4, 9), []);
  assert.deepEqual(lines({ start: 4, end: 9 }, 6, 9), ["Its first 2 words go to the shot before.", "Its start moves to “word 6…”: it is saved as a frame there, and the frame at its old start is hidden, kept in history."]);
  assert.deepEqual(lines({ start: 4, end: 9 }, 3, 9, false), ["It takes 1 word from the opening, before any frame.", "Its start moves to “word 3…”: it is saved as a frame there, and the frame at its old start is hidden, kept in history."]);
  assert.equal(lines({ start: 4, end: 9 }, 5, 9)[0], "Its first word goes to the shot before.");
  assert.deepEqual(lines({ start: 4, end: 9 }, 4, 7), ["Its end is drawn in: a new, empty frame will begin at “word 8…”."]);
  assert.deepEqual(lines({ start: 4, end: 9 }, 2, 3), ["It takes 2 words from the shot before.", "Its start moves to “word 2…”: it is saved as a frame there.", "It ends just before its old start, so the frame there stays, as the shot after it."]);
  assert.deepEqual(lines(null, 5, 9), ["A new shot inside the one before: that shot ends where this one starts."]);
  assert.deepEqual(lines(null, 5, 9, false), []);
  assert.deepEqual(lines({ start: 4, end: 9 }, 1, 9), ["The shot would start at or before the shot before it and swallow it; start it later."]);
});

test("a first pass plans the innermost beat or scene at the cursor, never an act", () => {
  const section = (id: string, kind: ResolvedSection["kind"]) => ({ id, kind }) as ResolvedSection;
  assert.equal(firstPassSection([section("act-1", "act"), section("beat-01", "beat")])?.id, "beat-01");
  assert.equal(firstPassSection([section("act-1", "act"), section("scene-2", "scene")])?.id, "scene-2");
  assert.equal(firstPassSection([section("act-1", "act")]), null);
  assert.equal(firstPassSection([]), null);
});

test("a first pass reads as counts of what is new and what is kept", () => {
  const shot = (frame: StoryboardFirstPassShot["frame"], description: StoryboardFirstPassShot["description"], drawing: StoryboardFirstPassShot["drawing"]): StoryboardFirstPassShot => ({ anchorWordId: "w", startSample: 0, text: null, frame, description, drawing });
  assert.equal(firstPassLine([shot("new", "new", "new"), shot("new", "new", "new"), shot("new", "kept", "new")]), "3 shots: 3 new frames, 2 new descriptions, 3 drawings to make; keeps 1 description.");
  assert.equal(firstPassLine([shot("kept", "kept", "kept"), shot("kept", "kept", "busy"), shot("new", "none", "none")]), "3 shots: 1 new frame, 0 new descriptions, 0 drawings to make; keeps 2 frames, 2 descriptions, 1 drawing; 1 frame already being drawn; 1 frame with nothing to draw from.");
});

test("the first pass progress line counts the newest pass's drawings by where they stand", () => {
  const job = (id: string, status: StoryboardJob["status"], firstPassId?: string, requestedAt = "2026-10-07T00:00:00.000Z"): StoryboardJob => ({ id, kind: "frame", anchorWordId: id, status, requestedAt, attempts: [], ...(firstPassId ? { firstPassId } : {}) });
  assert.equal(firstPassProgress([job("01ARZ3NDEKTSV4RRFFQ69G5FA1", "running")]), null);
  const older = "01ARZ3NDEKTSV4RRFFQ69G5FB0";
  const newer = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
  assert.equal(firstPassProgress([job("01ARZ3NDEKTSV4RRFFQ69G5FA1", "failed", older), job("01ARZ3NDEKTSV4RRFFQ69G5FA2", "done", newer, "2026-10-07T00:01:00.000Z"),
    job("01ARZ3NDEKTSV4RRFFQ69G5FA3", "running", newer, "2026-10-07T00:01:00.000Z"), job("01ARZ3NDEKTSV4RRFFQ69G5FA4", "queued", newer, "2026-10-07T00:01:00.000Z"), job("01ARZ3NDEKTSV4RRFFQ69G5FA5", "queued", newer, "2026-10-07T00:01:00.000Z")]),
    "First pass drawings, 4 in all: 1 drawn, 1 drawing, 2 waiting.");
});
