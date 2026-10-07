/**
 * Drafting and drawing storyboard frames (A66). A draft is one text turn of the Codex CLI under the user's ChatGPT login; a drawing is one
 * Codex turn that calls its image tool, else local Qwen Image 2.1 when that fails. Each runs in a fresh empty directory with a read-only
 * sandbox and without the user's Codex configuration, and is told only the shot's description and a short excerpt of the narration.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { Duration, Effect, FileSystem, Semaphore, Stream } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/unstable/process";
import { type ChunkElement, jobPending, type StoryboardAttempt, type StoryboardJob, type StoryboardRenderer, STORYBOARD_TRACK } from "@animator/domain";
import { AnimatorError } from "../../core/error.js";
import { readBounded } from "../../core/io.js";
import { type StoryContext } from "../story/index.js";
import { addShot, mintUlid, type ShotRecord, type VisualTimelineSettings } from "../visual-timeline/index.js";
import { storyboardError, type StoryboardCode, type StoryboardSettings } from "./contracts.js";
export * from "./contracts.js";

const fail = (code: StoryboardCode, message: string) => Effect.fail(storyboardError({ code, message }));
const OUTPUT_LIMIT = 1_048_576;
const ERROR_TAIL = 600;
const tail = (text: string) => { const trimmed = text.trim().replace(/\s+/g, " "); return trimmed.length > ERROR_TAIL ? `…${trimmed.slice(-ERROR_TAIL)}` : trimmed; };

/** The narration around a word, as written: words and the punctuation between them, `before` words ahead of it and `after` words from it on. `mark` brackets the word itself as `[[word]]`. Null when the word is not in the transcript. */
export function excerpt(elements: ReadonlyArray<ChunkElement>, anchorWordId: string, before: number, after: number, mark: boolean): string | null {
  const at = elements.findIndex(e => e.kind === "word" && e.id === anchorWordId);
  if (at < 0) return null;
  let from = at;
  for (let words = 0; from > 0 && words < before; ) { from--; if (elements[from]!.kind === "word") words++; }
  while (from < at && elements[from]!.kind === "punctuation") from++;
  let to = at;
  for (let words = 0; to < elements.length && words < after; to++) if (elements[to]!.kind === "word") words++;
  const text = elements.slice(from, to).map(e => e.kind === "word" && e.id === anchorWordId && mark ? `[[${e.value}]]` : e.value).join("");
  return text.replace(/\s+/g, " ").trim();
}

/** What a draft asks for: one shot, beginning at the marked word, described for a storyboard artist. */
export function draftPrompt(options: { readonly title: string; readonly excerpt: string }): string {
  return [
    "You are helping storyboard an animated film made from an audiobook's narration.",
    "Propose one shot: what the camera sees in the frame that begins at the word marked [[like this]] in the passage below, for as long as the narration stays on that moment.",
    "Write 30 to 60 words of plain present-tense description: subject, action, setting, framing, and light. Describe only what can be drawn. Stay faithful to the passage; do not invent names, faces, or events it does not support.",
    "Reply with only the description. Do not run commands or read files.",
    "",
    `Story: ${options.title}`,
    "Passage:",
    options.excerpt,
  ].join("\n");
}

/**
 * The picture a renderer is asked for, the one prompt every storyboard drawing uses (A66, A67): a plain, unstyled black line drawing of the
 * description, with the narration as context only. It sets staging and framing and nothing else, so a coherent style can be chosen later;
 * colours, materials, and lighting the description names are kept out of the picture.
 */
export function sketchPrompt(options: { readonly title: string; readonly description: string; readonly excerpt: string | null }): string {
  return [
    "A single storyboard frame for an animated film, drawn by hand: plain black line art on a solid, opaque white background, simple clean contour lines of even weight.",
    "No colour, no grey tones, no shading or hatching, no texture, no lettering. Simple figures and props drawn as plain outlines, like a storyboard artist's clean thumbnail: it sets staging, framing, and composition, not style.",
    "Wide 16:9 landscape frame. No text, captions, speech bubbles, panel numbers, or borders. Where the description names colours, materials, or lighting, show only the shapes and where they are, not how they are coloured or lit.",
    "",
    `The frame shows: ${options.description}`,
    ...(options.excerpt === null ? [] : ["", `Narration this shot begins on, from "${options.title}" (context only; do not write it in the picture): ${options.excerpt}`]),
  ].join("\n");
}

/** The section a first pass plans, as the prompt names it. */
export type PlanSection = { readonly kind: string; readonly title: string; readonly summary?: string };
/**
 * What a first pass asks for (A67): the shots of one section of the story map, each beginning at a word the model quotes, with a 30 to 60
 * word description in the style of a draft. `sentences` are the section's narration, one sentence each; `before` is the narration just
 * ahead of it, as context; `kept` quotes the opening words of shots already declared in the section, which the model is told to keep.
 */
export function planPrompt(options: { readonly title: string; readonly section: PlanSection; readonly before: string | null; readonly sentences: ReadonlyArray<string>; readonly kept: ReadonlyArray<string> }): string {
  const { kind } = options.section;
  return [
    "You are storyboarding an animated film made from an audiobook's narration.",
    `Below is one ${kind} of the story, one sentence per numbered line. Decide where each shot begins: a shot is one picture that holds while the narration stays on it.`,
    `Give a sentence at most one shot of its own. Merge consecutive sentences that stay on the same picture into one shot, and split a long sentence only where the picture clearly changes within it. The first shot begins at the ${kind}'s first word.`,
    ...(options.kept.length === 0 ? [] : [`Shots already begin at these places; keep each as a shot that starts exactly there: ${options.kept.map(k => `"${k}"`).join("; ")}.`]),
    "For each shot write:",
    `- "opens": the first words of the shot, four to eight of them (fewer if the sentence is shorter), copied exactly from the ${kind}, starting at the word where the shot begins;`,
    "- \"description\": 30 to 60 words of plain present-tense description of what the camera sees: subject, action, setting, framing, and light. Describe only what can be drawn. Stay faithful to the narration; do not invent names, faces, or events it does not support.",
    `Reply with only a JSON object, the shots in narration order: {"shots": [{"opens": "...", "description": "..."}]}. Do not run commands or read files.`,
    "",
    `Story: ${options.title}`,
    `${kind[0]!.toUpperCase()}${kind.slice(1)}: ${options.section.title}${options.section.summary === undefined ? "" : ` (${options.section.summary})`}`,
    ...(options.before === null ? [] : [`Narration just before it (context only; no shots here): ${options.before}`]),
    `The ${kind}:`,
    ...options.sentences.map((sentence, i) => `${i + 1}. ${sentence}`),
  ].join("\n");
}

/** One shot as the model proposed it: its opening words, quoted from the narration, and its description. */
export type ProposedShot = { readonly opens: string; readonly text: string };
/**
 * The shots in a plan's reply: the JSON object it was asked for, found between the reply's first `{` and last `}` so a fence or a stray
 * line around it does no harm. Null when there is no such object or it has no usable shots; entries without both strings are dropped.
 */
export function readPlanReply(reply: string): ReadonlyArray<ProposedShot> | null {
  const from = reply.indexOf("{");
  const to = reply.lastIndexOf("}");
  if (from < 0 || to < from) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(reply.slice(from, to + 1)); } catch { return null; }
  const shots = typeof parsed === "object" && parsed !== null && "shots" in parsed && Array.isArray(parsed.shots) ? parsed.shots as ReadonlyArray<unknown> : null;
  if (shots === null) return null;
  const proposed = shots.flatMap(shot => {
    if (typeof shot !== "object" || shot === null) return [];
    const { opens, description } = shot as { opens?: unknown; description?: unknown };
    return typeof opens === "string" && typeof description === "string" && opens.trim() !== "" && description.trim() !== "" ? [{ opens: opens.trim(), text: description.replace(/\s+/g, " ").trim() }] : [];
  });
  return proposed.length === 0 ? null : proposed;
}

/** A word's comparable tokens: lowercase letters and digits, accents and apostrophes dropped, split at anything else. */
const tokens = (text: string): ReadonlyArray<string> =>
  text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’‘]/g, "").split(/[^\p{L}\p{N}]+/u).filter(t => t !== "");
/** How many opening tokens are enough to place a shot whose full quote does not match, say after the model changed a later word. */
const SHORT_QUOTE = 3;
/**
 * Place proposed shots on words (A67): each quote is looked for as a run of whole words starting after the previous shot's word, so shots
 * stay in narration order and a phrase the narration repeats lands on its next use. The full quote is tried first, then its first three
 * tokens. `words` are the transcript's words in order and `from`..`to` the section's word indexes, inclusive; a quote may run past the
 * section's end but must begin inside it. A quote that cannot be placed is returned as unmatched.
 */
export function placeShots(words: ReadonlyArray<{ readonly id: string; readonly value: string }>, from: number, to: number, proposed: ReadonlyArray<ProposedShot>) {
  const flat: Array<{ token: string; word: number; first: boolean }> = [];
  for (let w = from; w < words.length; w++) tokens(words[w]!.value).forEach((token, i) => flat.push({ token, word: w, first: i === 0 }));
  const find = (quote: ReadonlyArray<string>, after: number): number | null => {
    for (let i = 0; i + quote.length <= flat.length; i++) {
      const start = flat[i]!;
      if (start.word > to) return null;
      if (start.word <= after || !start.first) continue;
      if (quote.every((token, k) => flat[i + k]!.token === token)) return start.word;
    }
    return null;
  };
  const placed: Array<{ readonly anchorWordId: string; readonly index: number; readonly text: string }> = [];
  const unmatched: Array<{ readonly opens: string; readonly text: string; readonly reason: string }> = [];
  let after = from - 1;
  for (const shot of proposed) {
    const quote = tokens(shot.opens);
    const at = quote.length === 0 ? null : find(quote, after) ?? (quote.length > SHORT_QUOTE ? find(quote.slice(0, SHORT_QUOTE), after) : null);
    if (at === null) { unmatched.push({ ...shot, reason: `Its opening words are not in the section after the shot before it.` }); continue; }
    placed.push({ anchorWordId: words[at]!.id, index: at, text: shot.text });
    after = at;
  }
  return { placed, unmatched };
}

/** The whole turn the Codex CLI is given to draw: call the image tool once with the sketch prompt. */
export const codexDrawInstruction = (sketch: string): string => [
  "Use your image generation tool to create exactly one image from the prompt below, in landscape 16:9. Do not run commands, read files, or write files. When the image is generated, reply with only the word done.",
  "",
  "Prompt:",
  sketch,
].join("\n");

/** Width and height from a PNG's header, or null when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { readonly width: number; readonly height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

type ProcessResult = { readonly exitCode: number; readonly stdout: string; readonly stderr: string };
/**
 * Run one command to completion without a shell, the prompt on stdin, collecting bounded output. It is stopped (SIGTERM, then SIGKILL after
 * five seconds) when `timeoutMs` passes. A command that cannot start, such as one that is not installed, fails naming it.
 */
function runProcess(options: { readonly command: string; readonly args: ReadonlyArray<string>; readonly cwd: string; readonly env: Record<string, string>; readonly stdin: string; readonly timeoutMs: number; readonly code: StoryboardCode; readonly label: string }): Effect.Effect<ProcessResult, AnimatorError, ChildProcessSpawner.ChildProcessSpawner> {
  const collect = (stream: Stream.Stream<Uint8Array, unknown>) => stream.pipe(
    Stream.runFold(() => Buffer.alloc(0), (all, chunk) => all.length >= OUTPUT_LIMIT ? all : Buffer.concat([all, chunk]).subarray(0, OUTPUT_LIMIT)),
    Effect.map(b => b.toString("utf8")), Effect.orElseSucceed(() => ""));
  const run = Effect.scoped(Effect.gen(function* () {
    const handle = yield* ChildProcess.make(options.command, [...options.args], {
      cwd: options.cwd, env: options.env, extendEnv: true, stdin: { stream: Stream.make(new TextEncoder().encode(options.stdin)) }, forceKillAfter: Duration.seconds(5),
    }).pipe(Effect.mapError(e => storyboardError({ code: options.code, message: `${options.label} could not start ${options.command}; is it installed? ${e.message}` })));
    const [stdout, stderr, exitCode] = yield* Effect.all([collect(handle.stdout), collect(handle.stderr), handle.exitCode.pipe(Effect.mapError(e => storyboardError({ code: options.code, message: `${options.label} did not report an exit code: ${e.message}` })))], { concurrency: "unbounded" });
    return { exitCode: Number(exitCode), stdout, stderr };
  }));
  return run.pipe(Effect.timeoutOrElse({ duration: Duration.millis(options.timeoutMs), orElse: () => fail(options.code, `${options.label} timed out after ${Math.round(options.timeoutMs / 1000)} s.`) }));
}

type CodexTurn = { readonly threadId: string | null; readonly messages: ReadonlyArray<string>; readonly errors: ReadonlyArray<string> };
/** The events of `codex exec --json`: the thread it opened, what the agent said, and any error it reported. Lines that are not JSON are ignored. */
export function readCodexEvents(stdout: string): CodexTurn {
  let threadId: string | null = null;
  const messages: string[] = [];
  const errors: string[] = [];
  for (const line of stdout.split("\n")) {
    let event: { type?: unknown; thread_id?: unknown; item?: { type?: unknown; text?: unknown }; message?: unknown; error?: { message?: unknown } };
    try { event = JSON.parse(line) as typeof event; } catch { continue; }
    if (event.type === "thread.started" && typeof event.thread_id === "string") threadId = event.thread_id;
    if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") messages.push(event.item.text.trim());
    if (event.type === "error" && typeof event.message === "string") errors.push(event.message);
    if (event.type === "turn.failed" && typeof event.error?.message === "string") errors.push(event.error.message);
  }
  return { threadId, messages, errors };
}

/** Where the Codex CLI keeps its login and generated images. */
export const codexHome = (settings: StoryboardSettings): string => settings.codex.home ?? process.env["CODEX_HOME"] ?? join(homedir(), ".codex");
/** Codex tools a drawing or a draft never needs, switched off so the turn cannot run commands, browse, or reach the user's apps. */
const CODEX_TOOLS_OFF = ["shell_tool", "apps", "plugins", "browser_use", "browser_use_external", "computer_use", "in_app_browser", "hooks"].flatMap(feature => ["--disable", feature]);
/**
 * The fixed part of every Codex turn: no user configuration (so no MCP servers, notifications, or full-access sandbox), nothing persisted,
 * a read-only sandbox in the turn's own empty directory, no shell, web search, browser, or apps, the configured model, and the prompt read
 * from stdin so it never appears in a process listing.
 */
const codexArgs = (settings: StoryboardSettings, workDirectory: string, extra: ReadonlyArray<string>) => [
  "exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--json", "--cd", workDirectory,
  "--model", settings.codex.model, "-c", `model_reasoning_effort="${settings.codex.reasoningEffort}"`, "-c", `web_search="disabled"`, ...CODEX_TOOLS_OFF, ...extra, "-",
];
/** What a failed Codex turn said, led by the likely cause when it is a missing login, so the section can say what to do. */
export function codexReason(output: string): string {
  const said = tail(output) || "It gave no reason.";
  return /401 Unauthorized|not logged in/i.test(output) ? `The Codex CLI is not logged in to ChatGPT; run \`codex login\`. ${said}` : said;
}
const codexFailure = (label: string, result: ProcessResult, turn: CodexTurn) =>
  `${label} failed (codex exited with code ${result.exitCode}). ${codexReason([...turn.errors, result.stderr].join(" "))}`;

/** One text-only Codex turn: its final message, with the model that wrote it and how long it took. A turn that fails or answers nothing fails with `code`. */
function codexText(settings: StoryboardSettings, prompt: string, turn: { readonly timeoutMs: number; readonly code: StoryboardCode; readonly label: string }): Effect.Effect<{ readonly text: string; readonly model: string; readonly seconds: number }, AnimatorError, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.scoped(Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "animator-storyboard-text-" }).pipe(Effect.mapError(() => storyboardError({ code: "IoFailed", message: `Cannot make a working directory for ${turn.label.toLowerCase()}.` })));
    const started = Date.now();
    const result = yield* runProcess({ command: settings.codex.executable, args: codexArgs(settings, directory, ["--disable", "image_generation"]), cwd: directory,
      env: { CODEX_HOME: codexHome(settings) }, stdin: prompt, timeoutMs: turn.timeoutMs, code: turn.code, label: turn.label });
    const events = readCodexEvents(result.stdout);
    if (result.exitCode !== 0) return yield* fail(turn.code, codexFailure(turn.label, result, events));
    const text = (events.messages.at(-1) ?? "").trim();
    if (text === "") return yield* fail(turn.code, `${turn.label} came back empty. ${tail(events.errors.join(" "))}`.trim());
    return { text, model: `openai/${settings.codex.model}`, seconds: (Date.now() - started) / 1000 };
  }));
}

/** One draft: a text-only Codex turn whose final message is the proposed description. */
export const codexDraft = (settings: StoryboardSettings, prompt: string) =>
  codexText(settings, prompt, { timeoutMs: settings.codex.draftTimeoutMs, code: "DraftFailed", label: "The draft" }).pipe(Effect.map(draft => ({ ...draft, text: draft.text.replace(/^["“]|["”]$/g, "").trim() })));

/** A first pass's plan: one text-only Codex turn whose final message is the JSON object `planPrompt` asks for, read into proposed shots. */
export const codexPlan = (settings: StoryboardSettings, prompt: string) => Effect.gen(function* () {
  const answer = yield* codexText(settings, prompt, { timeoutMs: settings.codex.planTimeoutMs, code: "PlanFailed", label: "The first pass's plan" });
  const shots = readPlanReply(answer.text);
  if (shots === null) return yield* fail("PlanFailed", `The first pass's plan did not answer with the JSON object it was asked for: ${tail(answer.text)}`);
  return { shots, model: answer.model, seconds: answer.seconds };
});

type Drawn = { readonly imagePath: string; readonly prompt: string; readonly notes: string };
/** The primary renderer: a Codex turn that calls the image tool. Codex saves the image under `<codex home>/generated_images/<thread id>/`; the newest PNG there is the drawing. */
function codexDraw(settings: StoryboardSettings, sketch: string, directory: string): Effect.Effect<Drawn, AnimatorError, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const prompt = codexDrawInstruction(sketch);
    const home = codexHome(settings);
    const result = yield* runProcess({ command: settings.codex.executable, args: codexArgs(settings, directory, ["--enable", "image_generation"]), cwd: directory,
      env: { CODEX_HOME: home }, stdin: prompt, timeoutMs: settings.codex.drawTimeoutMs, code: "RendererFailed", label: "ChatGPT through the Codex CLI" });
    const turn = readCodexEvents(result.stdout);
    if (result.exitCode !== 0) return yield* fail("RendererFailed", codexFailure("ChatGPT through the Codex CLI", result, turn));
    if (turn.threadId === null) return yield* fail("RendererFailed", "ChatGPT through the Codex CLI reported no thread, so its image cannot be found.");
    const images = join(home, "generated_images", turn.threadId);
    const names = (yield* fs.readDirectory(images).pipe(Effect.orElseSucceed(() => [] as Array<string>))).filter(name => name.toLowerCase().endsWith(".png"));
    const dated = yield* Effect.forEach(names, name => fs.stat(join(images, name)).pipe(Effect.map(info => ({ name, at: info.mtime._tag === "Some" ? info.mtime.value.getTime() : 0 })), Effect.orElseSucceed(() => ({ name, at: 0 }))));
    const newest = dated.sort((a, b) => b.at - a.at)[0];
    if (newest === undefined) return yield* fail("RendererFailed", `ChatGPT through the Codex CLI finished without an image. ${tail(turn.messages.join(" ")) || "It gave no reason."}`);
    return { imagePath: join(images, newest.name), prompt, notes: `Drawn by ChatGPT's image tool through the Codex CLI under the ChatGPT login (model ${settings.codex.model}, thread ${turn.threadId}).` };
  });
}

/** Local Qwen Image 2.1 runs one image at a time: it holds about 9 GB while drawing. */
const fallbackLock = Semaphore.makeUnsafe(1);
/** The fallback renderer: the configured command, with the prompt in a file and the PNG written beside it. */
function fallbackDraw(settings: StoryboardSettings, sketch: string, directory: string): Effect.Effect<Drawn, AnimatorError, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner> {
  return fallbackLock.withPermits(1)(Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const promptFile = join(directory, "prompt.txt");
    const output = join(directory, "fallback.png");
    yield* fs.writeFileString(promptFile, sketch).pipe(Effect.mapError(() => storyboardError({ code: "IoFailed", message: `Cannot write ${promptFile}.` })));
    const [command, ...args] = settings.fallback.argv.map(arg => arg.replaceAll("{promptFile}", promptFile).replaceAll("{output}", output));
    const result = yield* runProcess({ command: command!, args, cwd: directory, env: {}, stdin: "", timeoutMs: settings.fallback.timeoutMs, code: "RendererFailed", label: "Local Qwen Image 2.1" });
    if (result.exitCode !== 0) return yield* fail("RendererFailed", `Local Qwen Image 2.1 failed (${command} exited with code ${result.exitCode}). ${tail(result.stderr) || "It gave no reason."}`);
    if (!(yield* fs.exists(output).pipe(Effect.orElseSucceed(() => false)))) return yield* fail("RendererFailed", `Local Qwen Image 2.1 exited without writing ${output}.`);
    return { imagePath: output, prompt: sketch, notes: `Drawn by local Qwen Image 2.1: ${settings.fallback.argv.join(" ")}.` };
  }));
}

export type DrawFrameRequest = {
  readonly settings: StoryboardSettings; readonly story: StoryContext; readonly timeline: VisualTimelineSettings;
  readonly producer: { readonly name: string; readonly version: string };
  readonly anchorWordId: string; readonly sketch: string;
  /** The word's effective start when the drawing is ready, since timing may change while it is drawn. */
  readonly startSample: Effect.Effect<number, AnimatorError, FileSystem.FileSystem>;
  readonly report: DrawReport;
};
/**
 * Draw one frame: ChatGPT through the Codex CLI first, local Qwen Image 2.1 only when that fails for any reason (not installed, not logged
 * in, refused, timed out, out of quota), then publish the drawing as a new storyboard record anchored to the frame's word and naming its
 * renderer, its exact prompt, and how long it took. Fails with the last renderer's reason when both fail.
 */
export function drawFrame(request: DrawFrameRequest): Effect.Effect<ShotRecord, AnimatorError, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner> {
  const renderers: ReadonlyArray<readonly [StoryboardRenderer, typeof codexDraw]> = [["codex-chatgpt", codexDraw], ["qwen-image-2.1", fallbackDraw]];
  return Effect.scoped(Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "animator-storyboard-draw-" }).pipe(Effect.mapError(() => storyboardError({ code: "IoFailed", message: "Cannot make a working directory for the drawing." })));
    const failures: string[] = [];
    for (const [renderer, draw] of renderers) {
      request.report.onAttempt(renderer);
      const started = Date.now();
      const drawn = yield* draw(request.settings, request.sketch, directory).pipe(Effect.result);
      if (drawn._tag === "Failure") {
        const message = drawn.failure.message;
        failures.push(message);
        request.report.onAttemptFailed(renderer, message);
        continue;
      }
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const size = pngSize(yield* readBounded(drawn.success.imagePath, request.timeline.limits.maxImageBytes).pipe(Effect.mapError(e => storyboardError({ code: "RendererFailed", message: e.message }))));
      const fallbackNote = failures.length > 0 ? ` Drawn after the primary renderer failed: ${failures.join(" ")}` : "";
      return yield* addShot({ story: request.story, settings: request.timeline, producer: request.producer, mode: "graphic-illustration", trackId: STORYBOARD_TRACK,
        startSample: yield* request.startSample, anchorWordId: request.anchorWordId, renderer, label: "Storyboard frame", prompt: drawn.success.prompt,
        notes: `${drawn.success.notes} ${seconds} s${size === null ? "" : `, ${size.width}x${size.height}`}.${fallbackNote}`, imageSourcePath: drawn.success.imagePath });
    }
    return yield* fail("RendererFailed", failures.at(-1) ?? "No renderer is configured.");
  }));
}

/** What a drawing reports while it runs: each renderer's try, and why one failed. */
export type DrawReport = { readonly onAttempt: (renderer: StoryboardRenderer) => void; readonly onAttemptFailed: (renderer: StoryboardRenderer, message: string) => void };
/**
 * The drawings, per story, for the book's lifetime (the server's, or one CLI run's): a restart forgets them, and a drawing running then is
 * lost. A queued drawing waits for one of `concurrentDraws` turns (A67), so a first pass's drawings run a few at a time rather than all at
 * once against the subscription. Each job is changed only by its own run and by `queue`.
 */
type MutableAttempt = { -readonly [K in keyof StoryboardAttempt]: StoryboardAttempt[K] };
type MutableJob = { -readonly [K in keyof Omit<StoryboardJob, "attempts">]: StoryboardJob[K] } & { readonly attempts: Array<MutableAttempt> };
export class StoryboardJobBook {
  private readonly jobs = new Map<string, Array<MutableJob>>();
  private readonly turns: Semaphore.Semaphore;
  constructor(concurrentDraws: number) { this.turns = Semaphore.makeUnsafe(concurrentDraws); }
  list(storyId: string): ReadonlyArray<StoryboardJob> {
    return (this.jobs.get(storyId) ?? []).map(job => ({ ...job, attempts: job.attempts.map(a => ({ ...a })) }));
  }
  /** Whether a drawing of the frame at this word is queued or running. */
  pending(storyId: string, anchorWordId: string): boolean {
    return (this.jobs.get(storyId) ?? []).some(job => job.anchorWordId === anchorWordId && jobPending(job));
  }
  /**
   * A new queued job, and the effect that waits for a turn, runs `draw`, and records how it ended; that effect never fails. The caller has
   * checked that no drawing of the same frame is pending, and forks the effect or waits for it.
   */
  queue<E extends { readonly message: string }, R>(storyId: string, anchorWordId: string, draw: (report: DrawReport) => Effect.Effect<{ readonly id: string }, E, R>, firstPassId?: string): { readonly job: StoryboardJob; readonly run: Effect.Effect<StoryboardJob, never, R> } {
    const job: MutableJob = { id: mintUlid(), anchorWordId, status: "queued", requestedAt: new Date().toISOString(), attempts: [], ...(firstPassId !== undefined ? { firstPassId } : {}) };
    const list = this.jobs.get(storyId) ?? [];
    list.push(job);
    this.jobs.set(storyId, list);
    const now = () => new Date().toISOString();
    const report: DrawReport = {
      onAttempt: renderer => { job.attempts.push({ renderer, startedAt: now() }); },
      onAttemptFailed: (_, message) => { const last = job.attempts.at(-1); if (last !== undefined) { last.finishedAt = now(); last.error = message; } },
    };
    const finish = (outcome: { readonly recordId: string } | { readonly error: string }) => Effect.sync(() => {
      const last = job.attempts.at(-1);
      if (last !== undefined && last.finishedAt === undefined) last.finishedAt = now();
      job.finishedAt = now();
      if ("recordId" in outcome) { job.status = "done"; job.recordId = outcome.recordId; }
      else { job.status = "failed"; job.error = outcome.error; }
      return { ...job, attempts: job.attempts.map(a => ({ ...a })) } satisfies StoryboardJob;
    });
    const run = this.turns.withPermits(1)(Effect.suspend(() => { job.status = "running"; return draw(report); })).pipe(
      Effect.matchEffect({ onSuccess: record => finish({ recordId: record.id }), onFailure: e => finish({ error: e.message }) }),
      Effect.catchDefect(defect => finish({ error: `The drawing stopped unexpectedly: ${String(defect)}` })));
    return { job: { ...job, attempts: [] }, run };
  }
}
