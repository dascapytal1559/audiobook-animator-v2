import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { NodeRuntime } from "@effect/platform-node";
import { Console, Effect, Schema } from "effect";
import { Punctuation, TimedWord, TranscriptionInput } from "./modules/transcription/index.js";

const ViewerDocument = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  provider: Schema.Struct({ name: Schema.Literal("rev-ai"), jobId: Schema.String }),
  input: TranscriptionInput,
  elements: Schema.Array(Schema.Union([TimedWord, Punctuation])),
  wordCount: Schema.Int.check(Schema.isGreaterThan(0)),
});
type ViewerDocument = typeof ViewerDocument.Type;

/** Script-data escaping is separate from DOM rendering, which only uses textContent/text nodes. */
function scriptData(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function decodeViewerDocument(raw: unknown): ViewerDocument {
  const data = Schema.decodeUnknownSync(ViewerDocument)(raw);
  const words = data.elements.filter((element) => element.kind === "word");
  if (words.length !== data.wordCount || new Set(data.elements.map((element) => element.id)).size !== data.elements.length) {
    throw new Error("The transcript has inconsistent word counts or duplicate element IDs.");
  }
  for (const word of words) {
    if (word.clipEndSeconds < word.clipStartSeconds
      || Math.abs(word.sourceStartSeconds - data.input.sourceStartSeconds - word.clipStartSeconds) > 1e-6
      || Math.abs(word.sourceEndSeconds - data.input.sourceStartSeconds - word.clipEndSeconds) > 1e-6) {
      throw new Error("Transcript word times do not match the declared decoded-audio clock.");
    }
  }
  return data;
}

/** This function is embedded as plain JavaScript after TypeScript compilation. */
function startViewer(): void {
  const data = JSON.parse(document.getElementById("transcript-data")!.textContent!) as ViewerDocument;
  const audio = document.getElementById("audio") as HTMLAudioElement;
  const transcript = document.getElementById("transcript")!;
  const clipClock = document.getElementById("clip-clock")!;
  const bookClock = document.getElementById("book-clock")!;
  const selection = document.getElementById("selection")!;
  const status = document.getElementById("status")!;
  const follow = document.getElementById("follow") as HTMLInputElement;
  const buttons: Array<{ button: HTMLButtonElement; word: TimedWord }> = [];
  let frame: number | undefined;
  let lastScrolled = -1;

  const format = (seconds: number, hours = false) => {
    const milliseconds = Math.max(0, Math.round(seconds * 1000));
    const wholeSeconds = Math.floor(milliseconds / 1000);
    const h = Math.floor(wholeSeconds / 3600);
    const m = Math.floor(wholeSeconds / 60) % 60;
    const s = wholeSeconds % 60;
    return (hours ? `${String(h).padStart(2, "0")}:` : "")
      + `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
  };
  const range = (start: number, end: number, hours = false) => `${format(start, hours)} – ${format(end, hours)}`;
  document.getElementById("word-count")!.textContent = `${data.wordCount} timed words`;
  document.getElementById("clip-duration")!.textContent = `of ${format(data.input.durationSeconds)}`;
  document.getElementById("origin")!.textContent = `Clip starts at ${format(data.input.sourceStartSeconds, true)} in the book’s decoded audio.`;
  document.getElementById("timing-caveat")!.textContent = data.input.timingCaveat;
  document.getElementById("job-id")!.textContent = data.provider.jobId;

  let currentSpeaker: number | undefined;
  let paragraph: HTMLParagraphElement | undefined;
  for (const element of data.elements) {
    if (!paragraph || element.speaker !== currentSpeaker) {
      paragraph = document.createElement("p");
      paragraph.className = "speech";
      paragraph.setAttribute("aria-label", `Speaker ${element.speaker + 1}`);
      transcript.append(paragraph);
      currentSpeaker = element.speaker;
    }
    if (element.kind === "punctuation") {
      paragraph.append(document.createTextNode(element.value));
      continue;
    }
    const word = element;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "word";
    button.textContent = word.value;
    button.title = `Clip ${range(word.clipStartSeconds, word.clipEndSeconds)} · Book ${range(word.sourceStartSeconds, word.sourceEndSeconds, true)}`;
    button.setAttribute("aria-label", `${word.value}. Seek to clip ${format(word.clipStartSeconds)}, book ${format(word.sourceStartSeconds, true)}.`);
    const position = buttons.length;
    button.addEventListener("click", () => {
      audio.currentTime = word.clipStartSeconds;
      selection.textContent = `“${word.value}” · Clip ${range(word.clipStartSeconds, word.clipEndSeconds)} · Book ${range(word.sourceStartSeconds, word.sourceEndSeconds, true)}`;
      status.textContent = "";
      update();
      void audio.play().catch(() => { status.textContent = "Position set. Use the audio player’s Play button to listen."; });
    });
    button.addEventListener("keydown", (event) => {
      const next = event.key === "ArrowRight" ? position + 1 : event.key === "ArrowLeft" ? position - 1
        : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null;
      if (next !== null) { event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, next))]!.button.focus(); }
    });
    buttons.push({ button, word });
    paragraph.append(button);
  }

  function update(): void {
    const time = audio.currentTime;
    clipClock.textContent = format(time);
    bookClock.textContent = format(data.input.sourceStartSeconds + time, true);
    let active = -1;
    for (const [index, item] of buttons.entries()) {
      const isActive = time >= item.word.clipStartSeconds && time < item.word.clipEndSeconds;
      item.button.classList.toggle("is-playing", isActive);
      if (isActive) { item.button.setAttribute("aria-current", "true"); if (active === -1) active = index; }
      else item.button.removeAttribute("aria-current");
    }
    if (follow.checked && active >= 0 && active !== lastScrolled) {
      const button = buttons[active]!.button;
      const rectangle = button.getBoundingClientRect();
      const playerBottom = document.getElementById("player")!.getBoundingClientRect().bottom;
      if (rectangle.top < playerBottom + 20 || rectangle.bottom > window.innerHeight - 30) {
        button.scrollIntoView({ block: "center", behavior: "auto" });
      }
      lastScrolled = active;
    }
  }
  const animate = () => { update(); if (!audio.paused && !audio.ended) frame = requestAnimationFrame(animate); };
  audio.addEventListener("play", () => { if (frame !== undefined) cancelAnimationFrame(frame); animate(); });
  audio.addEventListener("pause", () => { if (frame !== undefined) cancelAnimationFrame(frame); update(); });
  audio.addEventListener("timeupdate", update);
  audio.addEventListener("seeked", update);
  audio.addEventListener("loadedmetadata", update);
  audio.addEventListener("ended", update);
  audio.addEventListener("error", () => { status.textContent = "The local audio could not be loaded. Keep demo.html beside input.flac and open it in a browser with FLAC playback."; });
  update();
}

export function renderTimestampDemo(raw: unknown): string {
  const data = decodeViewerDocument(raw);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Animator · timestamp demo</title>
<style>
  :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #242435; background: #f5f5f8; }
  * { box-sizing: border-box; }
  body { margin: 0; }
  main { width: min(100% - 40px, 980px); margin: 48px auto 72px; }
  header { margin-bottom: 26px; }
  .eyebrow { display: flex; gap: 10px; align-items: center; font-size: 12px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; color: #655c8a; }
  .dot { width: 8px; height: 8px; background: #7757d6; border-radius: 50%; }
  h1 { font-size: clamp(32px, 5vw, 48px); line-height: 1.1; letter-spacing: -.04em; font-weight: 700; margin: 15px 0 12px; }
  .subtitle { color: #646474; font-size: 16px; line-height: 1.6; max-width: 760px; margin: 0; }
  .location { display: inline-block; margin-top: 17px; padding: 7px 11px; border-radius: 7px; font-size: 12px; color: #5a5570; background: #ece9f3; }
  .player { position: sticky; top: 12px; z-index: 2; padding: 23px 26px 18px; background: #fff; border: 1px solid #dddde7; border-radius: 18px; box-shadow: 0 7px 22px #28233b08; }
  .clocks { display: grid; grid-template-columns: 1fr 1.3fr; gap: 24px; padding-bottom: 19px; }
  .clock-label { margin: 0 0 7px; font-size: 11px; font-weight: 700; color: #686879; text-transform: uppercase; letter-spacing: .09em; }
  .clock { font: 500 clamp(23px, 4vw, 33px)/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; font-variant-numeric: tabular-nums; letter-spacing: -.05em; }
  #book-clock { color: #6746ba; }
  #clip-duration { font-size: 12px; color: #7b7b88; padding-left: 10px; white-space: nowrap; }
  audio { display: block; width: 100%; height: 42px; }
  .selection { min-height: 20px; font: 12px/1.7 ui-monospace, SFMono-Regular, Consolas, monospace; color: #6b657d; margin: 13px 0 0; overflow-wrap: anywhere; }
  .status { color: #884b20; font-size: 13px; line-height: 1.5; margin: 4px 0 0; }
  .status:empty { display: none; }
  .transcript-card { background: white; margin-top: 22px; border: 1px solid #e2e2eb; border-radius: 18px; padding: 26px; }
  .transcript-head { display: flex; justify-content: space-between; align-items: center; gap: 20px; border-bottom: 1px solid #ededf2; padding-bottom: 17px; }
  h2 { margin: 0; font-size: 17px; letter-spacing: -.02em; }
  .count { display: block; font-size: 12px; color: #7c7c89; margin-top: 5px; }
  .follow { display: flex; align-items: center; gap: 7px; font-size: 12px; color: #676575; white-space: nowrap; cursor: pointer; }
  input { accent-color: #7352cc; }
  .hint { font-size: 12px; color: #85828e; margin: 14px 0 22px; line-height: 1.6; }
  .speech { font-size: clamp(17px, 2.4vw, 20px); line-height: 2.1; white-space: pre-wrap; margin: 0 0 22px; overflow-wrap: anywhere; }
  .speech:last-child { margin-bottom: 0; }
  .word { font: inherit; line-height: inherit; display: inline; color: inherit; background: transparent; border: 0; border-radius: 4px; padding: 0 1px; cursor: pointer; white-space: pre-wrap; transition: background-color 80ms linear; }
  .word:hover { background: #eee9fc; }
  .word.is-playing { color: #fff; background: #7250c8; box-shadow: 0 0 0 2px #7250c8; }
  .word:focus-visible, summary:focus-visible, input:focus-visible { outline: 2px solid #7250c8; outline-offset: 3px; }
  footer { font-size: 12px; line-height: 1.7; color: #777482; padding: 19px 4px 0; }
  footer p { margin: 0 0 8px; }
  details { margin-top: 10px; }
  summary { color: #696274; cursor: pointer; width: fit-content; }
  .evidence { padding-top: 8px; overflow-wrap: anywhere; }
  .job { color: #92909a; font-size: 11px; }
  @media (max-width: 560px) { main { width: min(100% - 24px, 980px); margin-top: 26px; } .player { top: 6px; padding: 17px 15px 13px; } .clocks { gap: 14px; } #clip-duration { padding: 0; display: block; margin-top: 4px; } .clock-label { font-size: 9px; letter-spacing: .05em; } .transcript-card { padding: 19px 16px; } .selection { font-size: 10px; } .location { font-size: 11px; } }
  @media (prefers-reduced-motion: reduce) { .word { transition: none; } }
</style>
</head>
<body>
<main>
  <header>
    <div class="eyebrow"><span class="dot" aria-hidden="true"></span>Animator · Rev AI timestamp demo</div>
    <h1>Listen. Follow the words.</h1>
    <p class="subtitle">A real two-minute audiobook sample with the transcript returned by Rev AI. Select any word to seek to its timestamp and start playback.</p>
    <div class="location">Sample location: Exhalation · near “What’s Expected of Us”</div>
  </header>
  <section id="player" class="player" aria-label="Sample audio and playback clocks">
    <div class="clocks">
      <div><p class="clock-label">Clip clock</p><span id="clip-clock" class="clock">00:00.000</span><span id="clip-duration"></span></div>
      <div><p class="clock-label">Book clock · decoded audio</p><span id="book-clock" class="clock"></span></div>
    </div>
    <audio id="audio" controls preload="metadata" src="./input.flac" aria-label="Two-minute audiobook sample">Your browser does not support audio playback.</audio>
    <p id="selection" class="selection" aria-live="polite">Select a word to inspect its clip and book times.</p>
    <p id="status" class="status" role="status"></p>
  </section>
  <section class="transcript-card" aria-labelledby="transcript-title">
    <div class="transcript-head"><div><h2 id="transcript-title">Timed transcript</h2><span id="word-count" class="count"></span></div><label class="follow"><input id="follow" type="checkbox" checked>Follow playback</label></div>
    <p class="hint">Click or press Enter on a word to listen. Arrow keys move between words. Highlighting follows returned word intervals, including pauses.</p>
    <div id="transcript"></div>
  </section>
  <footer>
    <p id="origin"></p>
    <p>This location is a sample for testing timestamps, not an approved story cut. Recognition and timing accuracy still need review.</p>
    <details><summary>Clock mapping and source evidence</summary><div class="evidence"><p id="timing-caveat"></p><p class="job">Rev job: <span id="job-id"></span></p></div></details>
  </footer>
  <noscript>This local viewer needs JavaScript to display and follow the transcript. The native audio player remains available.</noscript>
</main>
<script id="transcript-data" type="application/json">${scriptData(data)}</script>
<script>(${startViewer.toString()})();</script>
</body>
</html>
`;
}

const main = Effect.gen(function* () {
  const { values } = yield* Effect.try(() => parseArgs({ options: {
    transcript: { type: "string" }, output: { type: "string" }, help: { type: "boolean" },
  }, strict: true, allowPositionals: false }));
  if (values.help) {
    yield* Console.log("Usage: node dist/demo-view.js --transcript data/demo/rev-ai/artifacts/transcript.json --output data/demo/rev-ai/demo.html\nRenders only a real normalized transcript. The output must sit beside its input.flac. No network requests are made.");
    return;
  }
  if (!values.transcript || !values.output) return yield* Effect.fail(new Error("Supply explicit --transcript and --output paths."));
  const transcriptPath = resolve(values.transcript);
  const outputPath = resolve(values.output);
  const result = yield* Effect.tryPromise(async () => {
    const info = await stat(transcriptPath);
    if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error("The transcript must be a local JSON file no larger than 16 MiB.");
    const raw: unknown = JSON.parse(await readFile(transcriptPath, "utf8"));
    const data = decodeViewerDocument(raw);
    const audioPath = join(dirname(outputPath), "input.flac");
    const audioInfo = await stat(audioPath);
    if (!audioInfo.isFile() || audioInfo.size !== data.input.byteLength || audioInfo.size > 32 * 1024 * 1024) throw new Error("The adjacent input.flac does not match the transcript’s declared input size.");
    const bytes = await readFile(audioPath);
    if (createHash("sha256").update(bytes).digest("hex") !== data.input.sha256) throw new Error("The adjacent input.flac does not match the transcript’s input hash.");
    if (outputPath === transcriptPath || outputPath === audioPath) throw new Error("The HTML output must not overwrite the transcript or audio.");
    await writeFile(outputPath, renderTimestampDemo(raw), "utf8");
    return { outputPath, wordCount: data.wordCount, durationSeconds: data.input.durationSeconds };
  });
  yield* Console.log(JSON.stringify(result));
});

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main.pipe(Effect.catch((error) => Console.error(String(error)).pipe(
    Effect.andThen(Effect.sync(() => { process.exitCode = 1; })),
  )), NodeRuntime.runMain({ disableErrorReporting: true }));
}
