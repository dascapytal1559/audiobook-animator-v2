/**
 * Drafting and drawing storyboard frames (A66). A draft is one text turn of the Codex CLI under the user's ChatGPT login; a drawing is one
 * Codex turn that calls its image tool, else local Qwen Image 2.1 when that fails. Each runs in a fresh empty directory with a read-only
 * sandbox and without the user's Codex configuration, and is told only the shot's description and a short excerpt of the narration.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { Duration, Effect, FileSystem, Semaphore, Stream } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/unstable/process";
import { type ChunkElement, type StoryboardAttempt, type StoryboardJob, type StoryboardRenderer, STORYBOARD_TRACK } from "@animator/domain";
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

/** The picture a renderer is asked for: a deliberately rough hand-drawn storyboard sketch of the description, with the narration as context only. */
export function sketchPrompt(options: { readonly title: string; readonly description: string; readonly excerpt: string | null }): string {
  return [
    "A single storyboard frame for an animated film, drawn by hand: a rough pencil and ink sketch on off-white paper, greyscale only, loose quick gestural lines, light hatching for shadow.",
    "Wide 16:9 landscape frame. Simple, unfinished figures and props, like a storyboard artist's working thumbnail: it sets staging and composition, not style.",
    "No colour, no text, no captions, no speech bubbles, no panel numbers.",
    "",
    `The frame shows: ${options.description}`,
    ...(options.excerpt === null ? [] : ["", `Narration this shot begins on, from "${options.title}" (context only; do not write it in the picture): ${options.excerpt}`]),
  ].join("\n");
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

/** One draft: a text-only Codex turn whose final message is the proposed description. */
export function codexDraft(settings: StoryboardSettings, prompt: string): Effect.Effect<{ readonly text: string; readonly model: string; readonly seconds: number }, AnimatorError, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.scoped(Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "animator-storyboard-draft-" }).pipe(Effect.mapError(() => storyboardError({ code: "IoFailed", message: "Cannot make a working directory for the draft." })));
    const started = Date.now();
    const result = yield* runProcess({ command: settings.codex.executable, args: codexArgs(settings, directory, ["--disable", "image_generation"]), cwd: directory,
      env: { CODEX_HOME: codexHome(settings) }, stdin: prompt, timeoutMs: settings.codex.draftTimeoutMs, code: "DraftFailed", label: "The draft" });
    const turn = readCodexEvents(result.stdout);
    if (result.exitCode !== 0) return yield* fail("DraftFailed", codexFailure("The draft", result, turn));
    const text = (turn.messages.at(-1) ?? "").replace(/^["“]|["”]$/g, "").trim();
    if (text === "") return yield* fail("DraftFailed", `The draft came back empty. ${tail(turn.errors.join(" "))}`.trim());
    return { text, model: `openai/${settings.codex.model}`, seconds: (Date.now() - started) / 1000 };
  }));
}

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
  readonly onAttempt: (renderer: StoryboardRenderer) => void;
  readonly onAttemptFailed: (renderer: StoryboardRenderer, message: string) => void;
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
      request.onAttempt(renderer);
      const started = Date.now();
      const drawn = yield* draw(request.settings, request.sketch, directory).pipe(Effect.result);
      if (drawn._tag === "Failure") {
        const message = drawn.failure.message;
        failures.push(message);
        request.onAttemptFailed(renderer, message);
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

/**
 * The drawings in the background, per story, for the server's lifetime: a restart forgets them, and a drawing running then is lost. Mutated
 * only from the job's own fiber and the route that starts it.
 */
type MutableAttempt = { -readonly [K in keyof StoryboardAttempt]: StoryboardAttempt[K] };
type MutableJob = { -readonly [K in keyof Omit<StoryboardJob, "attempts">]: StoryboardJob[K] } & { readonly attempts: Array<MutableAttempt> };
export class StoryboardJobBook {
  private readonly jobs = new Map<string, Array<MutableJob>>();
  list(storyId: string): ReadonlyArray<StoryboardJob> {
    return (this.jobs.get(storyId) ?? []).map(job => ({ ...job, attempts: job.attempts.map(a => ({ ...a })) }));
  }
  running(storyId: string, anchorWordId: string): boolean {
    return (this.jobs.get(storyId) ?? []).some(job => job.anchorWordId === anchorWordId && job.status === "running");
  }
  /** A new running job; the caller has checked that none is running for the same frame. */
  begin(storyId: string, anchorWordId: string): StoryboardJob {
    const job: MutableJob = { id: mintUlid(), anchorWordId, status: "running", startedAt: new Date().toISOString(), attempts: [] };
    const list = this.jobs.get(storyId) ?? [];
    list.push(job);
    this.jobs.set(storyId, list);
    return job;
  }
  private find(storyId: string, id: string) { return (this.jobs.get(storyId) ?? []).find(job => job.id === id); }
  attempt(storyId: string, id: string, renderer: StoryboardRenderer): void {
    this.find(storyId, id)?.attempts.push({ renderer, startedAt: new Date().toISOString() });
  }
  attemptFailed(storyId: string, id: string, message: string): void {
    const attempt = this.find(storyId, id)?.attempts.at(-1);
    if (attempt !== undefined) { attempt.finishedAt = new Date().toISOString(); attempt.error = message; }
  }
  finish(storyId: string, id: string, outcome: { readonly recordId: string } | { readonly error: string }): void {
    const job = this.find(storyId, id);
    if (job === undefined) return;
    const now = new Date().toISOString();
    const last = job.attempts.at(-1);
    if (last !== undefined && last.finishedAt === undefined) last.finishedAt = now;
    job.finishedAt = now;
    if ("recordId" in outcome) { job.status = "done"; job.recordId = outcome.recordId; }
    else { job.status = "failed"; job.error = outcome.error; }
  }
}
