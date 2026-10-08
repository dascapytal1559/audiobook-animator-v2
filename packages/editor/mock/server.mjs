// Loopback mock of the editor API for smoke-testing the client without the real server; shared timeline rules come from the domain.
// Lists two stories at GET /api/stories that share one synthetic 2-second clip and one in-memory state (enough to exercise the story
// selector); every other route lives under /api/stories/:storyId/. Echoes PUT .../decisions and PUT .../word-timing through the same merge
// rules, answers POST .../word-timing/align with a canned report, and records every PUT at GET /mock/puts.
import { createServer } from "node:http";
import { declaredShots, decodeStrict, ImageTrackId, judgeSpan, mergeTimeline, SHOT_MODES, spanBounds, STORYBOARD_TRACK } from "@animator/domain";

const PORT = Number(process.env["MOCK_PORT"] ?? "63621");
const RATE = 48000;
const COUNT = RATE * 2;
const SAMPLES_PER_BUCKET = 256;
const CHUNKING = { pauseBreakMs: 300, minSentenceBreakMs: 150 };
const sha = (c) => c.repeat(64);
const clip = { bookId: "exhalation", storyId: "the-great-silence", audioSha256: sha("a"), transcriptSha256: sha("b"), sampleRateHz: RATE, sampleCount: COUNT };
const summary = (id, title, bookId, bookTitle) => ({ id, title, bookId, bookTitle, wordCount: 7, sampleRateHz: RATE, sampleCount: COUNT, durationSeconds: 2, durationDisplay: "00:00:02.000" });
const STORIES = [summary("the-great-silence", "The Great Silence (mock)", "exhalation", "Exhalation"), summary("tower-of-babylon", "Tower of Babylon (mock)", "stories-of-your-life-and-others", "Stories of Your Life and Others")];
const ms = (n) => Math.round((n / 1000) * RATE);

// Words with a 400 ms pause between "we" and "would" (850 ms → 1250 ms), so a pause-midpoint snap target exists at 1050 ms.
const wordSpec = [["The", 100, 250], ["humans", 260, 520], ["use", 530, 640], ["we", 650, 850], ["would", 1250, 1450], ["call", 1460, 1600], ["silence", 1620, 1950]];
// Three timing layers (A42): the transcriber's original, the script's auto overlay, and the editor's manual overlay. The mock starts with
// one auto entry ("use", shifted 150 ms later like the pilot's measured lead) and one manual entry ("silence").
const elements = wordSpec.flatMap((_, i) => [{ kind: "word", id: `w${i + 1}` }, { kind: "punctuation", value: i === wordSpec.length - 1 ? "." : " " }]);
const original = wordSpec.map(([value, s, e], i) => ({ id: `w${i + 1}`, value, startSample: ms(s), endSample: ms(e) }));
const autoRuns = [];
let auto = { w3: { startSample: ms(680), endSample: ms(790) } };
let manual = { w7: { startSample: ms(1640), endSample: ms(1970) } };
const effective = () => original.map(w => {
  const layer = manual[w.id] ?? auto[w.id] ?? { startSample: w.startSample, endSample: w.endSample };
  return { id: w.id, value: w.value, startSample: layer.startSample, endSample: layer.endSample, original: { startSample: w.startSample, endSample: w.endSample }, ...(auto[w.id] ? { auto: auto[w.id] } : {}), ...(manual[w.id] ? { manual: manual[w.id] } : {}) };
});
// Chunks as the real server's chunks.ts would produce them for "The humans use we[400 ms pause]would call silence." with a 300 ms pause break
// (shorter than the real config's 600 ms so the two-second clip shows both a pause break and an end break), recomputed on effective times (A37).
function chunksOf(words) {
  const out = [];
  let open = null;
  const pauseBreak = ms(CHUNKING.pauseBreakMs);
  const minSentenceBreak = ms(CHUNKING.minSentenceBreakMs);
  words.forEach((w, i) => {
    if (open === null) open = { startSample: w.startSample, endSample: w.endSample, values: [], wordIds: [] };
    open.values.push(w.value); open.wordIds.push(w.id); open.endSample = w.endSample;
    const next = words[i + 1];
    const gap = next === undefined ? 0 : next.startSample - w.endSample;
    const reason = next === undefined ? "end" : w.id === "w7" && gap >= minSentenceBreak ? "sentence" : gap >= pauseBreak ? "pause" : null;
    if (reason === null) return;
    out.push({ id: `c${out.length}`, startSample: open.startSample, endSample: open.endSample, text: open.values.join(" ") + (w.id === "w7" ? "." : ""), wordIds: open.wordIds, breakReason: reason });
    open = null;
  });
  return out;
}
function story(storyId) {
  const words = effective();
  const inversions = words.filter((w, i) => i > 0 && w.startSample < words[i - 1].startSample).length;
  const listed = STORIES.find(s => s.id === storyId);
  return { clip: { ...clip, bookId: listed.bookId, storyId }, story: { title: listed.title, bookTitle: listed.bookTitle, transcriptProvider: "openai" }, sourceStartSample: 123456789, elements, words, chunks: chunksOf(words), chunking: { ...CHUNKING, mergedSentenceBreaks: [] }, timing: { inversions, autoRuns, manualCount: Object.keys(manual).length, autoCount: Object.keys(auto).length } };
}
// Speech regions (A44): the synthetic tone is silent only during the 850–1250 ms pause, so two regions with a deliberate 150 ms lead on the words.
const speech = { schemaVersion: 1, kind: "speech-regions", audioSha256: clip.audioSha256, sampleRateHz: RATE, sampleCount: COUNT, frameSamples: ms(10), thresholdDbfs: -50, minSilenceMs: 150, minSpeechMs: 50, regions: [{ startSample: ms(250), endSample: ms(850) }, { startSample: ms(1250), endSample: ms(2000) }] };
const wordsById = () => new Map(effective().map(w => [w.id, w]));

const svg = (color, text) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${color}"/><text x="320" y="190" font-size="40" text-anchor="middle" fill="#fff" font-family="sans-serif">${text}</text></svg>`;
const images = new Map();
const ulid = (n) => `01JMCK${"0".repeat(16)}${String(n).padStart(4, "0")}`;
const record = (n, startSample, mode, createdAt, extra = {}) => ({ schemaVersion: 1, kind: "visual-shot-generation", id: ulid(n), clip, startSample, mode, createdAt, producer: { name: "mock", version: "1" }, ...extra });
let counter = 0;
const records = [];
function addRecord(startSample, mode, extra, image) {
  const n = ++counter;
  const r = record(n, startSample, mode, new Date(Date.UTC(2026, 0, n)).toISOString(), extra);
  if (image !== undefined) { images.set(r.id, image); r.imagePath = image.name; }
  records.push(r);
  return r;
}
addRecord(0, "graphic-illustration", { label: "Opening", prompt: "A parrot in a rainforest canopy." }, { name: "image.svg", type: "image/svg+xml", bytes: Buffer.from(svg("#2f5d8a", "Opening")) });
addRecord(ms(700), "poetic-abstraction", { label: "Silence", notes: "Older candidate." }, { name: "image.svg", type: "image/svg+xml", bytes: Buffer.from(svg("#5b3d7a", "Silence A")) });
addRecord(ms(700), "poetic-abstraction", { label: "Silence alt" }, { name: "image.svg", type: "image/svg+xml", bytes: Buffer.from(svg("#7a3d6a", "Silence B")) });
addRecord(ms(1500), "graphic-illustration", { label: "Closing", notes: "No image yet; placeholder card expected." });

// The two "Silence" candidates are anchored to "use" (w3), so the mock has one declared shot (A65) inside beat-2 for its description takes.
let decisions = { schemaVersion: 1, kind: "visual-timeline-decisions", clip, updatedAt: new Date().toISOString(), settings: { frameAspect: { width: 16, height: 9 } }, shots: { [ulid(2)]: { anchorWordId: "w3" }, [ulid(3)]: { anchorWordId: "w3" } } };
const puts = [];
const posts = [];
const sseClients = new Set();

const withUrl = (storyId) => (r) => (r.imagePath === undefined ? r : { ...r, imageUrl: `/api/stories/${storyId}/shots/${r.id}/image` });
function merge(storyId) {
  const wordStarts = new Map(effective().map(word => [word.id, word.startSample]));
  const { candidates, stitched } = mergeTimeline(records.map(withUrl(storyId)), decisions, COUNT, wordStarts);
  return { candidates, stitched };
}
const timeline = (storyId) => ({ clip, storyDirectory: `/mock/stories/${storyId}`, records: records.map(withUrl(storyId)), decisions, ...merge(storyId), unresolvedAnchors: [] });

// Synthetic audio: a 220 Hz tone with a slow amplitude sweep, silent during the 850–1250 ms pause.
const pcm = new Int16Array(COUNT);
for (let i = 0; i < COUNT; i++) {
  const t = i / RATE;
  const inPause = t >= 0.85 && t < 1.25;
  const env = inPause ? 0 : 0.25 + 0.6 * Math.abs(Math.sin(t * 5));
  pcm[i] = Math.round(env * 20000 * Math.sin(2 * Math.PI * 220 * t));
}
const wav = (() => {
  const header = Buffer.alloc(44);
  const data = Buffer.from(pcm.buffer);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
})();
const peaks = (() => {
  const buckets = Math.ceil(COUNT / SAMPLES_PER_BUCKET);
  const min = new Array(buckets).fill(0), max = new Array(buckets).fill(0);
  for (let b = 0; b < buckets; b++) {
    let lo = 32767, hi = -32768;
    for (let i = b * SAMPLES_PER_BUCKET; i < Math.min(COUNT, (b + 1) * SAMPLES_PER_BUCKET); i++) { lo = Math.min(lo, pcm[i]); hi = Math.max(hi, pcm[i]); }
    min[b] = lo; max[b] = hi;
  }
  return { schemaVersion: 1, audioSha256: clip.audioSha256, sampleRateHz: RATE, sampleCount: COUNT, samplesPerBucket: SAMPLES_PER_BUCKET, min, max };
})();

const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const fail = (res, status, code, message) => json(res, status, { code, message });
const broadcast = (event) => { for (const c of sseClients) c.write(`event: ${event}\ndata: {}\n\n`); };
const readBody = (req) => new Promise((resolve) => { const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => resolve(Buffer.concat(chunks))); });

function parseMultipart(body, contentType) {
  const boundary = /boundary=("?)([^";]+)\1/.exec(contentType)?.[2];
  if (!boundary) throw new Error("multipart boundary missing");
  const fields = {}; const files = {};
  const delimiter = Buffer.from(`--${boundary}`);
  let position = body.indexOf(delimiter) + delimiter.length;
  for (;;) {
    if (body.subarray(position, position + 2).toString() === "--") break;
    position += 2; // CRLF
    const headerEnd = body.indexOf("\r\n\r\n", position);
    const headers = body.subarray(position, headerEnd).toString();
    const next = body.indexOf(delimiter, headerEnd);
    const content = body.subarray(headerEnd + 4, next - 2);
    const name = /name="([^"]+)"/.exec(headers)?.[1];
    const filename = /filename="([^"]*)"/.exec(headers)?.[1];
    const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1] ?? "application/octet-stream";
    if (filename !== undefined) files[name] = { name: filename, type, bytes: Buffer.from(content) };
    else fields[name] = content.toString();
    position = next + delimiter.length;
  }
  return { fields, files };
}

// Story map (A62): the second story has none, so the story map sections' empty state is reachable; the first has two acts, three beats, and three subjects.
const mapImages = { "narrator": { type: "image/svg+xml", bytes: Buffer.from(svg("#2f6b3a", "Narrator")) }, "arecibo": { type: "image/svg+xml", bytes: Buffer.from(svg("#3a4d6b", "Arecibo")) } };
const storyMap = {
  schemaVersion: 1, kind: "story-map", clip, createdAt: "2026-09-18T00:00:00.000Z", producer: { name: "mock", version: "1" },
  subjects: [
    { id: "narrator", kind: "character", name: "The narrator", description: "A parrot speaking for its species.", mentions: [{ startWordId: "w2", endWordId: "w2" }, { startWordId: "w4", endWordId: "w4" }], images: [{ path: "refs/narrator.svg", role: "canonical identity" }] },
    { id: "arecibo", kind: "object", name: "Arecibo", description: "The listening instrument.", mentions: [{ startWordId: "w3", endWordId: "w3" }], images: [{ path: "refs/arecibo.svg", role: "intact landscape" }] },
    { id: "silence", kind: "motif", name: "The Great Silence", mentions: [{ startWordId: "w6", endWordId: "w7" }] },
  ],
  sections: [
    { id: "act-1", kind: "act", title: "The listeners", summary: "Humans build an ear.", startWordId: "w1", endWordId: "w4" },
    { id: "beat-1", kind: "beat", title: "Title", startWordId: "w1", endWordId: "w1" },
    { id: "beat-2", kind: "beat", title: "An overlooked neighbour", summary: "The narrator is right here.", startWordId: "w2", endWordId: "w4" },
    { id: "act-2", kind: "act", title: "Silence", startWordId: "w5", endWordId: "w7" },
    { id: "beat-3", kind: "beat", title: "What they would call it", startWordId: "w5", endWordId: "w7" },
  ],
};
// Scene description takes (A63, A65): the first story's declared shot at w3 has two, appended to by POST like the real route; the rest have none.
const takes = [
  { id: ulid(9001), anchorWordId: "w3", model: "openai/gpt-6-astra", text: "A parrot on a branch, seen from below, the Arecibo dish a pale bowl behind the canopy.", createdAt: "2026-09-22T10:00:00.000Z", producer: { name: "mock", version: "1" } },
  { id: ulid(9002), anchorWordId: "w3", model: "anthropic/claude-fable-5.1", text: "Green leaves fill the frame. One grey parrot turns its head toward the listening dish, which glints through a gap in the trees.", createdAt: "2026-09-22T10:01:00.000Z", producer: { name: "mock", version: "1" } },
];
const storyboardJobs = [];
/**
 * A drawing in the mock: queued for a moment, then running. A frame drawing then fails, since the mock draws no frames; a station drawing
 * (A69) succeeds with a card naming its direction, so the shot station can be tried, except a direction titled with "fail", which fails.
 */
function queueDrawing(storyId, target, card) {
  const requestedAt = new Date().toISOString();
  const job = { storyId, id: ulid(8000 + storyboardJobs.length + 1), ...target, status: "queued", requestedAt, attempts: [] };
  storyboardJobs.push(job);
  setTimeout(() => { Object.assign(job, { status: "running" }); job.attempts.push({ renderer: "codex-chatgpt", startedAt: new Date().toISOString() }); }, 700);
  setTimeout(() => {
    const at = new Date().toISOString();
    const failed = target.kind === "frame" || /fail/i.test(card ?? "") ? "The mock server draws nothing here." : null;
    const id = ulid(6000 + storyboardJobs.length + stationImages.length + 1);
    if (target.kind === "station") stationImages.push({ storyId, id, versionId: target.versionId, direction: target.direction, prompt: "mock drawing prompt", createdAt: at,
      ...(failed === null ? { renderer: "codex-chatgpt", notes: "Drawn by the mock.", imagePath: "image.svg", bytes: Buffer.from(svg(["#3b6e8f", "#8f5a3b", "#5a8f3b", "#6e3b8f"][target.direction % 4], card.slice(0, 24))) } : { error: failed }) });
    Object.assign(job.attempts[0], { finishedAt: at, ...(failed === null ? {} : { error: failed }) });
    Object.assign(job, { finishedAt: at }, failed === null ? { status: "done", imageId: id } : { status: "failed", error: failed });
  }, 2200);
  return job;
}
/** The shot station (A69), in memory: versions as written, and image tries with an SVG card or a reason. */
const stationVersions = [];
const stationImages = [];
const servedStationImage = (storyId) => ({ storyId: _, bytes: __, ...image }) => ({ schemaVersion: 1, kind: "shot-station-image", clip: { ...clip, storyId }, ...image, producer: { name: "mock", version: "1" },
  ...(image.imagePath !== undefined ? { imageUrl: `/api/stories/${storyId}/storyboard/station/images/${image.id}/image` } : {}) });
const servedVersion = (storyId) => ({ storyId: _, ...version }) => ({ schemaVersion: 1, kind: "shot-station-version", clip: { ...clip, storyId }, ...version, producer: { name: "mock", version: "1" } });
/** A canned direction: the mock writes the same few ideas whatever it is told, naming what it was asked for. */
const mockDirection = (title, said) => ({ title, description: `${title}: ${said}`.slice(0, 200), prompt: `A mock image prompt for “${title}”, from “${said}”.`, motion: null, motionOptions: ["slow push in", "held still", "pull back to reveal"] });
const MOCK_TITLES = ["Wide from above", "Close on the face", "Low angle", "Through the trees", "Silhouette", "Overhead"];
const servedMap = (storyId) => ({ ...storyMap, clip: { ...clip, storyId }, subjects: storyMap.subjects.map(({ images, ...subject }) => images === undefined ? subject
  : { ...subject, images: images.map((image, index) => ({ ...image, url: `/api/stories/${storyId}/map/subjects/${subject.id}/images/${index}` })) }) });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/mock/puts") return json(res, 200, { puts, posts });
    if (req.method === "GET" && url.pathname === "/api/stories") return json(res, 200, { stories: STORIES });
    // Story-scoped routes: strip the prefix, then dispatch on the remainder as before.
    const scoped = /^\/api\/stories\/([a-z0-9-]+)(\/.+)$/.exec(url.pathname);
    if (!scoped || !STORIES.some(s => s.id === scoped[1])) return fail(res, 404, "NotFound", `No route for ${req.method} ${url.pathname}.`);
    const storyId = scoped[1];
    const path = `/api${scoped[2]}`;
    if (req.method === "GET" && path === "/api/story") return json(res, 200, story(storyId));
    if (req.method === "GET" && path === "/api/speech") return json(res, 200, speech);
    if (req.method === "GET" && path === "/api/timeline") return json(res, 200, timeline(storyId));
    if (req.method === "GET" && path === "/api/peaks") return json(res, 200, peaks);
    if (req.method === "GET" && path === "/api/map") return storyId === STORIES[0].id ? json(res, 200, servedMap(storyId)) : fail(res, 404, "NotFound", `No story map for ${storyId}.`);
    const mapImage = /^\/api\/map\/subjects\/([a-z0-9-]+)\/images\/(\d+)$/.exec(path);
    if (req.method === "GET" && mapImage) {
      const file = storyId === STORIES[0].id && mapImage[2] === "0" ? mapImages[mapImage[1]] : undefined;
      if (!file) return fail(res, 404, "NotFound", "No such story map image.");
      res.writeHead(200, { "content-type": file.type, "content-length": file.bytes.length });
      return res.end(file.bytes);
    }
    if (req.method === "GET" && path === "/api/audio") {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
      if (range) {
        const start = range[1] === "" ? Math.max(0, wav.length - Number(range[2])) : Number(range[1]);
        const end = range[1] !== "" && range[2] !== "" ? Math.min(wav.length - 1, Number(range[2])) : wav.length - 1;
        res.writeHead(206, { "content-type": "audio/wav", "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${wav.length}`, "content-length": end - start + 1 });
        return res.end(wav.subarray(start, end + 1));
      }
      res.writeHead(200, { "content-type": "audio/wav", "accept-ranges": "bytes", "content-length": wav.length });
      return res.end(wav);
    }
    const image = /^\/api\/shots\/([A-Z0-9]{26})\/image$/.exec(path);
    if (req.method === "GET" && image) {
      const file = images.get(image[1]);
      if (!file) return fail(res, 404, "NotFound", `No image for shot ${image[1]}.`);
      res.writeHead(200, { "content-type": file.type, "content-length": file.bytes.length });
      return res.end(file.bytes);
    }
    if (req.method === "GET" && path === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write("event: ready\ndata: {}\n\n");
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }
    if (req.method === "GET" && path === "/api/scene-descriptions") return json(res, 200, { takes: storyId === STORIES[0].id ? takes : [] });
    if (req.method === "POST" && path === "/api/scene-descriptions") {
      const body = JSON.parse((await readBody(req)).toString());
      if (storyId !== STORIES[0].id) return fail(res, 400, "InvalidRequest", "The mock records description takes for its first story only.");
      if (typeof body?.anchorWordId !== "string" || typeof body?.model !== "string" || typeof body?.text !== "string") return fail(res, 400, "InvalidRequest", "Body must be a take with anchorWordId, model, text, and optional prompt and notes.");
      if (!declaredShots(merge(storyId).stitched).some(shot => shot.anchorWordId === body.anchorWordId)) return fail(res, 400, "InvalidRequest", `No declared shot starts at ${body.anchorWordId}: anchor a shot to that word on the visual timeline first.`);
      if (takes.some(t => t.anchorWordId === body.anchorWordId && t.model === body.model && t.text === body.text)) return fail(res, 409, "TakeExists", "That take is already recorded.");
      const take = { id: ulid(9000 + takes.length + 1), anchorWordId: body.anchorWordId, model: body.model, text: body.text, ...(body.prompt !== undefined ? { prompt: body.prompt } : {}), ...(body.notes !== undefined ? { notes: body.notes } : {}), createdAt: new Date().toISOString(), producer: { name: "mock", version: "1" } };
      takes.push(take);
      posts.push({ at: take.createdAt, route: "/api/scene-descriptions", body });
      json(res, 201, take);
      return broadcast("timeline-changed");
    }
    // Storyboard (A66): drawings that run for a moment; frames fail, since the mock draws none.
    if (req.method === "GET" && path === "/api/storyboard/jobs") return json(res, 200, { jobs: storyboardJobs.filter(job => job.storyId === storyId).map(({ storyId: _, ...job }) => job) });
    // The shot station (A69): canned directions, picks and motion carried, mixes and edits written as one, and SVG cards for images.
    if (req.method === "GET" && path === "/api/storyboard/station") {
      return json(res, 200, { versions: stationVersions.filter(v => v.storyId === storyId).map(servedVersion(storyId)), images: stationImages.filter(i => i.storyId === storyId).map(servedStationImage(storyId)) });
    }
    if (req.method === "POST" && path === "/api/storyboard/station/versions") {
      const body = JSON.parse((await readBody(req)).toString());
      const parent = body?.parentId === null ? null : stationVersions.find(v => v.storyId === storyId && v.id === body?.parentId);
      if (parent === undefined) return fail(res, 400, "InvalidRequest", `No shot station version ${body?.parentId}.`);
      const action = body?.action ?? {};
      const carry = (i, extra = {}) => { const d = parent.directions[i]; return { ...d, ...extra, carried: d.carried ?? { versionId: parent.id, direction: i } }; };
      const directions = action.kind === "describe" ? MOCK_TITLES.slice(0, action.count).map(title => mockDirection(title, action.director))
        : action.kind === "pick" ? [carry(action.direction)] : action.kind === "motion" ? [carry(0, { motion: action.motion })]
        : action.kind === "mix" ? [mockDirection(`Mix of ${action.directions.map(i => i + 1).join(" + ")}`, action.instruction || "combined")]
        : action.kind === "edit" ? [{ ...mockDirection(parent.directions[action.direction].title, action.instruction), title: `${parent.directions[action.direction].title}, ${action.instruction}`.slice(0, 60) }] : null;
      if (directions === null || parent === null && action.kind !== "describe") return fail(res, 400, "InvalidRequest", "The mock takes a describe, pick, mix, edit, or motion.");
      if (action.kind !== "pick" && action.kind !== "motion") await new Promise(resolve => setTimeout(resolve, 800));
      const version = { storyId, id: ulid(5000 + stationVersions.length + 1), shotWordId: body.shotWordId, span: { startWordId: body.startWordId, endWordId: body.endWordId }, parentId: body.parentId, action,
        writer: action.kind === "pick" || action.kind === "motion" ? null : { model: "mock/writer", prompt: "mock writer prompt", seconds: 0.8 }, directions, createdAt: new Date().toISOString() };
      stationVersions.push(version);
      const jobs = directions.flatMap((d, i) => (d.carried === undefined ? [queueDrawing(storyId, { kind: "station", anchorWordId: body.shotWordId, versionId: version.id, direction: i }, d.title)] : []));
      posts.push({ at: version.createdAt, route: "/api/storyboard/station/versions", body });
      return json(res, 201, { version: servedVersion(storyId)(version), jobs: jobs.map(({ storyId: _, ...job }) => job) });
    }
    if (req.method === "POST" && path === "/api/storyboard/station/draw") {
      const body = JSON.parse((await readBody(req)).toString());
      const version = stationVersions.find(v => v.storyId === storyId && v.id === body?.versionId);
      if (version?.directions[body.direction] === undefined) return fail(res, 400, "InvalidRequest", "No such direction.");
      const job = queueDrawing(storyId, { kind: "station", anchorWordId: version.shotWordId, versionId: version.id, direction: body.direction }, version.directions[body.direction].title.replace(/fail/gi, ""));
      const { storyId: _, ...served } = job;
      return json(res, 202, { jobs: [served] });
    }
    const stationImage = /^\/api\/storyboard\/station\/images\/([A-Z0-9]{26})\/image$/.exec(path);
    if (req.method === "GET" && stationImage) {
      const image = stationImages.find(i => i.storyId === storyId && i.id === stationImage[1]);
      if (!image?.bytes) return fail(res, 404, "NotFound", "No such station image.");
      res.writeHead(200, { "content-type": "image/svg+xml", "content-length": image.bytes.length });
      return res.end(image.bytes);
    }
    if (req.method === "POST" && path === "/api/storyboard/snapshot") {
      const body = JSON.parse((await readBody(req)).toString());
      if (storyId !== STORIES[0].id) return fail(res, 400, "InvalidRequest", "The mock saves snapshots for its first story only.");
      const words = [...effective()].sort((a, b) => a.startSample - b.startSample);
      const index = new Map(words.map((w, i) => [w.id, i]));
      const start = index.get(body?.startWordId), end = index.get(body?.endWordId);
      if (start === undefined || end === undefined) return fail(res, 400, "InvalidRequest", "startWordId and endWordId must be words of the transcript.");
      const { stitched, candidates } = merge(storyId);
      const shots = stitched.filter(e => e.kind === "shot" && e.trackId === STORYBOARD_TRACK);
      const frame = body.frameWordId === null ? null : shots.find(e => e.anchorWordId === body.frameWordId);
      if (frame === undefined) return fail(res, 400, "InvalidRequest", `No storyboard frame starts at ${body.frameWordId}.`);
      const judged = judgeSpan(spanBounds(words, shots.map(e => e.startSample), frame?.startSample ?? words[start].startSample), frame === null ? null : index.get(frame.anchorWordId), start, end);
      if (!judged.ok) return fail(res, 400, "InvalidRequest", judged.reason);
      const version = body.versionId === null ? null : stationVersions.find(v => v.storyId === storyId && v.id === body.versionId);
      if (version === undefined) return fail(res, 400, "InvalidRequest", `No shot station version ${body.versionId}.`);
      if (version !== null && version.directions.length !== 1) return fail(res, 400, "InvalidRequest", "Pick one direction before saving it as the frame.");
      const origin = version === null ? null : version.directions[0].carried ?? { versionId: version.id, direction: 0 };
      const drawn = origin === null ? null : stationImages.filter(i => i.storyId === storyId && i.versionId === origin.versionId && i.direction === origin.direction && i.bytes).at(-1);
      if (version !== null && drawn === undefined) return fail(res, 400, "InvalidRequest", "That version is not drawn yet.");
      const startWord = words[start];
      const card = drawn != null ? { name: "image.svg", type: "image/svg+xml", bytes: drawn.bytes } : frame?.imagePath !== undefined ? images.get(frame.id) : undefined;
      const added = judged.moved || version !== null ? addRecord(startWord.startSample, "graphic-illustration", { trackId: STORYBOARD_TRACK, anchorWordId: startWord.id, label: "Storyboard frame", notes: "Saved by the mock (A68, A69).",
        ...(version !== null ? { stationVersionId: version.id } : {}) }, card) : null;
      const shown = frame === null ? undefined : takes.filter(t => t.anchorWordId === frame.anchorWordId).at(-1);
      const description = version !== null ? { model: "mock/writer", text: version.directions[0].description, notes: `From shot station version ${version.id} (A69).` }
        : judged.moved && shown !== undefined ? { model: shown.model, text: shown.text, notes: `Carried from ${frame.anchorWordId} (A68).` } : null;
      const take = description === null || takes.some(t => t.anchorWordId === startWord.id && t.model === description.model && t.text === description.text) ? null
        : { id: ulid(9000 + takes.length + 1), anchorWordId: startWord.id, ...description, createdAt: new Date().toISOString(), producer: { name: "mock", version: "1" } };
      if (take !== null) takes.push(take);
      const splitWord = judged.splitAt === null ? null : words[judged.splitAt];
      const keepsOld = frame !== null && judged.moved && splitWord?.id === frame.anchorWordId;
      const split = splitWord === null || keepsOld ? null : addRecord(splitWord.startSample, "graphic-illustration", { trackId: STORYBOARD_TRACK, anchorWordId: splitWord.id, label: "Storyboard frame" });
      const retire = frame === null || !judged.moved || keepsOld ? [] : candidates.filter(g => g.trackId === STORYBOARD_TRACK && g.startSample === frame.startSample).flatMap(g => g.shots.filter(x => x.anchorWordId === frame.anchorWordId && !x.hidden).map(x => x.id));
      posts.push({ at: new Date().toISOString(), route: "/api/storyboard/snapshot", body });
      json(res, 201, { record: added === null ? null : withUrl(storyId)(added), take, split: split === null ? null : withUrl(storyId)(split), retire });
      return broadcast("timeline-changed");
    }
    // First pass (A67): a canned plan of one shot per word of the section, the first word's shot kept as declared when it is; applying
    // declares image-less storyboard records, records the descriptions, and queues drawings that fail like the draw route's.
    if (req.method === "POST" && path === "/api/storyboard/first-pass/plan") {
      const body = JSON.parse((await readBody(req)).toString());
      const section = storyId === STORIES[0].id ? storyMap.sections.find(s => s.id === body?.sectionId) : undefined;
      if (section === undefined) return fail(res, 400, "InvalidRequest", `The story map has no section ${body?.sectionId}.`);
      if (section.kind !== "beat" && section.kind !== "scene") return fail(res, 400, "InvalidRequest", `Section ${section.id} is an act; a first pass plans one beat or scene.`);
      const ids = original.map(w => w.id);
      const inside = ids.slice(ids.indexOf(section.startWordId), ids.indexOf(section.endWordId) + 1);
      const { stitched } = merge(storyId);
      const shots = inside.map(anchorWordId => {
        const frame = stitched.find(e => e.kind === "shot" && e.trackId === STORYBOARD_TRACK && e.anchorWordId === anchorWordId);
        const described = takes.some(t => t.anchorWordId === anchorWordId);
        const busy = storyboardJobs.some(j => j.storyId === storyId && j.kind === "frame" && j.anchorWordId === anchorWordId && (j.status === "queued" || j.status === "running"));
        return { anchorWordId, startSample: wordsById().get(anchorWordId).startSample, text: `A mock shot beginning at ${anchorWordId}, drawn plainly in black line.`, frame: frame === undefined ? "new" : "kept",
          description: described ? "kept" : "new", drawing: frame?.imagePath !== undefined ? "kept" : busy ? "busy" : "new" };
      });
      await new Promise(resolve => setTimeout(resolve, 800));
      return json(res, 200, { sectionId: section.id, model: "mock/planner", prompt: "mock first-pass prompt", seconds: 0.8, shots, unmatched: [{ opens: "Words not in the beat", text: "Left out.", reason: "Its opening words are not in the section after the shot before it." }] });
    }
    if (req.method === "POST" && path === "/api/storyboard/first-pass") {
      const body = JSON.parse((await readBody(req)).toString());
      if (storyId !== STORIES[0].id || !Array.isArray(body?.shots)) return fail(res, 400, "InvalidRequest", "Body must be { sectionId, model, prompt, shots: [{ anchorWordId, text }] }.");
      const firstPassId = ulid(7000 + storyboardJobs.length + 1);
      const shots = [];
      for (const { anchorWordId, text } of body.shots) {
        const word = wordsById().get(anchorWordId);
        if (word === undefined) return fail(res, 400, "InvalidRequest", `Shot ${anchorWordId} does not begin inside section ${body.sectionId}.`);
        const frame = merge(storyId).stitched.find(e => e.kind === "shot" && e.trackId === STORYBOARD_TRACK && e.anchorWordId === anchorWordId);
        if (frame === undefined) addRecord(word.startSample, "graphic-illustration", { trackId: STORYBOARD_TRACK, anchorWordId, label: "Storyboard frame" });
        const described = takes.some(t => t.anchorWordId === anchorWordId);
        if (!described && text !== null) takes.push({ id: ulid(9000 + takes.length + 1), anchorWordId, model: body.model, text, prompt: body.prompt, notes: `First pass ${firstPassId}.`, createdAt: new Date().toISOString(), producer: { name: "mock", version: "1" } });
        shots.push({ anchorWordId, startSample: word.startSample, text, frame: frame === undefined ? "new" : "kept", description: described ? "kept" : text === null ? "none" : "new", drawing: frame?.imagePath !== undefined ? "kept" : "new" });
      }
      const jobs = shots.filter(s => s.drawing === "new").map(s => { const { storyId: _, ...served } = queueDrawing(storyId, { kind: "frame", anchorWordId: s.anchorWordId, firstPassId }); return served; });
      posts.push({ at: new Date().toISOString(), route: "/api/storyboard/first-pass", body });
      json(res, 202, { firstPassId, sectionId: body.sectionId, shots, jobs });
      return broadcast("timeline-changed");
    }
    if (req.method === "PUT" && path === "/api/decisions") {
      const body = JSON.parse((await readBody(req)).toString());
      if (typeof body?.settings?.frameAspect?.width !== "number" || typeof body?.shots !== "object") return fail(res, 400, "InvalidDecisions", "Body must have settings.frameAspect and shots.");
      for (const [id, d] of Object.entries(body.shots)) {
        if (!records.some(r => r.id === id)) return fail(res, 400, "InvalidDecisions", `Decision references a shot with no generation record: ${id}.`);
        if (d.selected === true && d.hidden === true) return fail(res, 400, "InvalidDecisions", `Shot ${id} is both selected and hidden.`);
        if (d.startSample !== undefined && (!Number.isInteger(d.startSample) || d.startSample < 0 || d.startSample >= COUNT)) return fail(res, 400, "InvalidDecisions", `startSample out of range for ${id}.`);
        if (d.anchorWordId !== undefined && !original.some(w => w.id === d.anchorWordId)) return fail(res, 400, "InvalidDecisions", `Unknown anchor word ${d.anchorWordId} for ${id}.`);
      }
      decisions = { ...decisions, updatedAt: new Date().toISOString(), settings: body.settings, shots: body.shots };
      puts.push({ at: new Date().toISOString(), route: "/api/decisions", body });
      console.error(`PUT /api/decisions #${puts.length}: ${JSON.stringify(body)}`);
      const response = timeline(storyId);
      json(res, 200, response);
      return broadcast("timeline-changed");
    }
    if (req.method === "PUT" && path === "/api/word-timing") {
      const body = JSON.parse((await readBody(req)).toString());
      if (typeof body?.words !== "object" || body.words === null) return fail(res, 400, "InvalidWordTiming", "Body must have words.");
      for (const [id, span] of Object.entries(body.words)) {
        if (!original.some(w => w.id === id)) return fail(res, 400, "InvalidWordTiming", `Unknown word ${id}.`);
        if (!Number.isInteger(span?.startSample) || !Number.isInteger(span?.endSample) || span.startSample < 0 || span.endSample > COUNT || span.endSample <= span.startSample) return fail(res, 400, "InvalidWordTiming", `Bad span for ${id}.`);
      }
      manual = { ...body.words };
      puts.push({ at: new Date().toISOString(), route: "/api/word-timing", body });
      console.error(`PUT /api/word-timing #${puts.length}: ${JSON.stringify(body)}`);
      json(res, 200, story(storyId));
      return broadcast("timeline-changed");
    }
    if (req.method === "POST" && path === "/api/word-timing/align") {
      const body = JSON.parse((await readBody(req)).toString());
      if (!Number.isInteger(body?.startSample) || !Number.isInteger(body?.endSample) || body.endSample <= body.startSample) return fail(res, 400, "InvalidRequest", "startSample and endSample required.");
      // Canned pass: every original word in the range gets an auto value 150 ms later (the pilot's measured lead).
      const inRange = original.filter(w => w.startSample < body.endSample && w.endSample > body.startSample);
      for (const w of inRange) auto[w.id] = { startSample: w.startSample + ms(150), endSample: w.endSample + ms(150) };
      const measure = (median, fraction) => ({ wordCount: inRange.length, boundaryCount: Math.min(2, inRange.length), onsetErrorMs: { median, p10: median / 3, p90: median * 1.8 }, insideSpeechCount: Math.round(inRange.length * fraction), insideSpeechFraction: fraction });
      const report = { range: { startSample: body.startSample, endSample: body.endSample }, wordCount: inRange.length, regionCount: 2, leadMs: 150, boundaryPauseMs: 300, before: measure(152, 0.86), after: measure(38, 0.94) };
      autoRuns.push({ startSample: body.startSample, endSample: body.endSample, ranAt: new Date().toISOString(), report });
      posts.push({ at: new Date().toISOString(), route: "/api/word-timing/align", body });
      console.error(`POST /api/word-timing/align: ${JSON.stringify(body)} → ${inRange.length} words`);
      json(res, 200, { report, story: story(storyId) });
      return broadcast("timeline-changed");
    }
    if (req.method === "POST" && path === "/api/shots") {
      const { fields, files } = parseMultipart(await readBody(req), req.headers["content-type"] ?? "");
      // A shot placed at a word (A66) records the anchor and starts at the word's effective start.
      const anchor = fields.anchorWordId === undefined ? undefined : effective().find(w => w.id === fields.anchorWordId);
      if (fields.anchorWordId !== undefined && anchor === undefined) return fail(res, 400, "InvalidRequest", `anchorWordId ${fields.anchorWordId} is not a word of the transcript.`);
      const startSample = fields.startSample === undefined && anchor !== undefined ? anchor.startSample : Number(fields.startSample);
      if (!Number.isInteger(startSample) || startSample < 0 || startSample >= COUNT) return fail(res, 400, "InvalidRequest", "startSample out of range.");
      if (!SHOT_MODES.includes(fields.mode)) return fail(res, 400, "InvalidRequest", "mode invalid.");
      const extra = {};
      if (fields.trackId !== undefined) {
        try { extra.trackId = decodeStrict(ImageTrackId, fields.trackId); }
        catch { return fail(res, 400, "InvalidRequest", "trackId invalid."); }
      }
      for (const key of ["label", "prompt", "notes", "anchorWordId", "renderer"]) if (fields[key] !== undefined && fields[key].trim() !== "") extra[key] = fields[key];
      const created = addRecord(startSample, fields.mode, extra, files.image);
      posts.push({ at: new Date().toISOString(), fields, image: files.image ? { name: files.image.name, bytes: files.image.bytes.length } : null });
      console.error(`POST /api/shots #${posts.length}: ${JSON.stringify(posts[posts.length - 1])}`);
      json(res, 200, withUrl(storyId)(created));
      return broadcast("timeline-changed");
    }
    return fail(res, 404, "NotFound", `No route for ${req.method} ${path}.`);
  } catch (e) {
    return fail(res, 500, "MockFailure", e instanceof Error ? e.message : String(e));
  }
});
server.listen(PORT, "127.0.0.1", () => console.error(`mock editor API on http://127.0.0.1:${PORT}`));
