import { createHash } from "node:crypto";
import { Schema } from "effect";
import { Positive, Sha256, Text } from "@animator/domain";
import { type ShotMode } from "./contracts.js";
import { encodeUlid } from "./ulid.js";

/**
 * Pure helpers for the one-time seed import of The Great Silence pilot material (PIPELINE A33 / B17):
 * the 14 treatment spans and the 15 prototype panels become labeled generation records with deterministic ids.
 */

export type Producer = { readonly name: string; readonly version: string };
export const TREATMENT_PRODUCER: Producer = { name: "seed-treatment", version: "2026-09-07" };
export const PROTOTYPE_PRODUCER: Producer = { name: "seed-prototype", version: "2026-09-08" };
export const TREATMENT_CREATED_AT = "2026-09-07T00:00:00.000Z";
/** assets.json records no generation date, so every prototype record shares this instant. */
export const PROTOTYPE_CREATED_AT = "2026-09-08T00:00:00.000Z";
export const TREATMENT_ROW_COUNT = 14;

/** Deterministic ULID: timestamp from createdAt, randomness from the first 80 bits of sha256("seed:<producer>:<key>"). */
export function deriveSeedId(producerName: string, key: string, createdAt: string): string {
  const timestamp = Date.parse(createdAt);
  if (Number.isNaN(timestamp)) throw new Error(`Seed createdAt is not a real instant: ${createdAt}.`);
  const digest = createHash("sha256").update(`seed:${producerName}:${key}`).digest();
  return encodeUlid(timestamp, BigInt(`0x${digest.subarray(0, 10).toString("hex")}`));
}

// ---------------------------------------------------------------------------------------------------------------------
// Treatment table

export type TreatmentRow = {
  readonly number: string; readonly title: string; readonly startSeconds: number; readonly endSeconds: number; readonly mode: ShotMode;
  readonly intent: string; readonly references: string; readonly evidence: string; readonly transition: string;
};
export const TREATMENT_HEADING = "## Proposed sequences";
const TREATMENT_COLUMNS = ["Sequence and draft span in seconds", "Mode", "Visual intent and reason for this mode", "Recurring references", "Narrative evidence", "Transition purpose"];
const SPAN_CELL = /^(\d{2}) — (.+?) · `\[(\d+(?:\.\d+)?), (\d+(?:\.\d+)?)\)`$/u;
const cells = (line: string) => {
  if (!line.startsWith("|") || !line.endsWith("|")) throw new Error(`Treatment table row must start and end with a pipe: ${line.slice(0, 60)}`);
  return line.slice(1, -1).split("|").map(c => c.trim());
};

/** Parse exactly the fixed six-column table under "## Proposed sequences". Structure only; use checkTreatmentRows for the pilot's invariants. */
export function parseTreatmentTable(markdown: string): ReadonlyArray<TreatmentRow> {
  const lines = markdown.split(/\r?\n/);
  const heading = lines.findIndex(l => l.trim() === TREATMENT_HEADING);
  if (heading < 0) throw new Error(`Treatment is missing the "${TREATMENT_HEADING}" heading.`);
  let i = heading + 1;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  const header = cells(lines[i++] ?? "");
  if (header.length !== TREATMENT_COLUMNS.length || header.some((c, k) => c !== TREATMENT_COLUMNS[k])) throw new Error(`Treatment table header is not the expected six columns: ${header.join(" | ")}`);
  const separator = cells(lines[i++] ?? "");
  if (separator.length !== TREATMENT_COLUMNS.length || separator.some(c => c !== "---")) throw new Error("Treatment table separator row is not six '---' cells.");
  const rows: TreatmentRow[] = [];
  for (; i < lines.length && lines[i]!.trim() !== ""; i++) {
    const c = cells(lines[i]!.trim());
    if (c.length !== TREATMENT_COLUMNS.length) throw new Error(`Treatment row ${rows.length + 1} has ${c.length} cells, expected ${TREATMENT_COLUMNS.length}.`);
    const span = SPAN_CELL.exec(c[0]!);
    if (!span) throw new Error(`Treatment row ${rows.length + 1} does not read "NN — title · \`[a, b)\`": ${c[0]}`);
    const mode = c[1]!;
    if (mode !== "graphic-illustration" && mode !== "poetic-abstraction") throw new Error(`Treatment row ${span[1]} has an unknown mode: ${mode}`);
    if (c.slice(2).some(t => t === "")) throw new Error(`Treatment row ${span[1]} has an empty cell.`);
    rows.push({ number: span[1]!, title: span[2]!, startSeconds: Number(span[3]), endSeconds: Number(span[4]), mode, intent: c[2]!, references: c[3]!, evidence: c[4]!, transition: c[5]! });
  }
  return rows;
}

/** The pilot's invariants: 14 rows numbered in order, adjacent spans starting at 0, the last ending exactly at the clip end. */
export function checkTreatmentRows(rows: ReadonlyArray<TreatmentRow>, clip: { readonly sampleRateHz: number; readonly sampleCount: number }): void {
  if (rows.length !== TREATMENT_ROW_COUNT) throw new Error(`Treatment table has ${rows.length} rows, expected ${TREATMENT_ROW_COUNT}.`);
  if (rows[0]!.startSeconds !== 0) throw new Error(`Treatment row 01 starts at ${rows[0]!.startSeconds}, expected 0.`);
  rows.forEach((row, k) => {
    if (row.number !== String(k + 1).padStart(2, "0")) throw new Error(`Treatment row ${k + 1} is numbered ${row.number}.`);
    if (!(row.endSeconds > row.startSeconds)) throw new Error(`Treatment row ${row.number} span is empty or reversed.`);
    const next = rows[k + 1];
    if (next && next.startSeconds !== row.endSeconds) throw new Error(`Treatment rows ${row.number} and ${next.number} are not adjacent (${row.endSeconds} vs ${next.startSeconds}).`);
  });
  const end = Math.round(rows[rows.length - 1]!.endSeconds * clip.sampleRateHz);
  if (end !== clip.sampleCount) throw new Error(`Treatment table ends at sample ${end}, but the clip has ${clip.sampleCount} samples.`);
}

export type SeedShot = {
  readonly key: string; readonly id: string; readonly startSample: number; readonly mode: ShotMode; readonly label: string;
  readonly prompt?: string; readonly notes: string; readonly createdAt: string; readonly producer: Producer;
  /** Present for prototype panels: which board to crop and how. */
  readonly image?: { readonly boardId: string; readonly boardPath: string; readonly boardSha256: string; readonly crop: PanelCrop };
};

export function treatmentSeeds(rows: ReadonlyArray<TreatmentRow>, sampleRateHz: number): ReadonlyArray<SeedShot> {
  return rows.map(row => {
    const key = `treatment:${row.number}`;
    return { key, id: deriveSeedId(TREATMENT_PRODUCER.name, key, TREATMENT_CREATED_AT), startSample: Math.round(row.startSeconds * sampleRateHz), mode: row.mode,
      label: `${row.number} — ${row.title}`, notes: `${row.intent}\nReferences: ${row.references}\nEvidence: ${row.evidence}\nTransition: ${row.transition}`,
      createdAt: TREATMENT_CREATED_AT, producer: TREATMENT_PRODUCER };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Prototype boards

export const PrototypeAsset = Schema.Struct({ id: Text, path: Text, sha256: Sha256, byteLength: Positive, width: Positive, height: Positive, stackedPanels: Positive });
export type PrototypeAsset = typeof PrototypeAsset.Type;
export const PrototypeAssets = Schema.Struct({ kind: Schema.Literal("visual-prototype-assets"), assets: Schema.Array(PrototypeAsset) });
export const PrototypePrompts = Schema.Struct({ kind: Schema.Literal("great-silence-visual-prototype-prompts"), panelsPerAsset: Positive, prompts: Schema.Array(Schema.Struct({ id: Text, prompt: Text })) });

/** The three opening scenes every board depicts, top to bottom, at their approximate story-relative starts. */
export const PANELS = [
  { name: "telescope", seconds: 4.9503968254 },
  { name: "neighboring parrots", seconds: 17.0103968254 },
  { name: "listening", seconds: 20.3203968254 },
] as const;
export const SELECTED_LOOKS: ReadonlyArray<string> = ["graphic-literal", "painterly-abstract"];
/** The prototype player's suggested scene mix: which board's panel to select at each of the three scenes. */
export const SUGGESTED_MIX: ReadonlyArray<string> = ["graphic-literal", "graphic-literal", "painterly-abstract"];
export const SUGGESTION_NOTE = "Suggested by prototype; user may override";
const BOARD_MODES: Readonly<Record<string, ShotMode>> = {
  "graphic-literal": "graphic-illustration", "painterly-literal": "graphic-illustration", "photoreal-literal": "graphic-illustration",
  "painterly-abstract": "poetic-abstraction", "painterly-metaphor": "poetic-abstraction",
};
export function modeForBoard(boardId: string): ShotMode {
  const mode = BOARD_MODES[boardId];
  if (mode === undefined) throw new Error(`No mode mapping for prototype board: ${boardId}.`);
  return mode;
}

export type PanelCrop = { readonly panel: number; readonly x: number; readonly y: number; readonly width: number; readonly height: number };
/** Split a board into `stackedPanels` horizontal bands. Boundaries are round(i * height / n), so a 1024-tall board yields 341/342/341. */
export function cropPlan(board: { readonly width: number; readonly height: number; readonly stackedPanels: number }): ReadonlyArray<PanelCrop> {
  const n = board.stackedPanels;
  if (!Number.isInteger(n) || n < 1 || board.height < n) throw new Error(`Cannot split a ${board.width}x${board.height} board into ${n} panels.`);
  const edge = (i: number) => Math.round(i * board.height / n);
  return Array.from({ length: n }, (_, i) => ({ panel: i + 1, x: 0, y: edge(i), width: board.width, height: edge(i + 1) - edge(i) }));
}

export function prototypeSeeds(assets: ReadonlyArray<PrototypeAsset>, prompts: ReadonlyArray<{ readonly id: string; readonly prompt: string }>, sampleRateHz: number): ReadonlyArray<SeedShot> {
  const promptFor = new Map(prompts.map(p => [p.id, p.prompt] as const));
  if (new Set(assets.map(a => a.id)).size !== assets.length) throw new Error("Prototype assets have duplicate ids.");
  return [...assets].sort((a, b) => a.id.localeCompare(b.id)).flatMap(board => {
    if (board.stackedPanels !== PANELS.length) throw new Error(`Board ${board.id} has ${board.stackedPanels} panels, expected ${PANELS.length}.`);
    const prompt = promptFor.get(board.id);
    if (prompt === undefined) throw new Error(`No prompt recorded for prototype board: ${board.id}.`);
    const mode = modeForBoard(board.id);
    const aside = SELECTED_LOOKS.includes(board.id) ? "" : ` Board ${board.id} is not one of the two selected looks (${SELECTED_LOOKS.join(", ")}).`;
    return cropPlan(board).map((crop, i) => {
      const key = `prototype:${board.id}:${crop.panel}`;
      return { key, id: deriveSeedId(PROTOTYPE_PRODUCER.name, key, PROTOTYPE_CREATED_AT), startSample: Math.round(PANELS[i]!.seconds * sampleRateHz), mode,
        label: `${board.id} · ${PANELS[i]!.name}`, prompt,
        notes: `Prototype study frame from board ${board.id} (sha256 ${board.sha256}), panel ${crop.panel} of ${PANELS.length}. Not a final asset.${aside}`,
        createdAt: PROTOTYPE_CREATED_AT, producer: PROTOTYPE_PRODUCER, image: { boardId: board.id, boardPath: board.path, boardSha256: board.sha256, crop } };
    });
  });
}

/** Decision overlay selecting the prototype's suggested mix, one selected panel per scene. */
export function suggestedDecisions(seeds: ReadonlyArray<SeedShot>): Record<string, { selected: true; notes: string }> {
  const shots: Record<string, { selected: true; notes: string }> = {};
  for (const seed of seeds) {
    if (seed.image && SUGGESTED_MIX[seed.image.crop.panel - 1] === seed.image.boardId) shots[seed.id] = { selected: true, notes: SUGGESTION_NOTE };
  }
  if (Object.keys(shots).length !== SUGGESTED_MIX.length) throw new Error(`Suggested mix selects ${Object.keys(shots).length} panels, expected ${SUGGESTED_MIX.length}.`);
  return shots;
}
