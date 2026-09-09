import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ULID_PATTERN } from "./ulid.js";
import { checkTreatmentRows, cropPlan, deriveSeedId, modeForBoard, PANELS, parseTreatmentTable, PROTOTYPE_CREATED_AT, prototypeSeeds, suggestedDecisions, TREATMENT_CREATED_AT, treatmentSeeds } from "./seed.js";

/** Verbatim excerpt of the real table: heading, header, separator, and rows 01–03. */
const EXCERPT = `
## Proposed sequences

| Sequence and draft span in seconds | Mode | Visual intent and reason for this mode | Recurring references | Narrative evidence | Transition purpose |
| --- | --- | --- | --- | --- | --- |
| 01 — The listener nearby · \`[0, 20)\` | graphic-illustration | Begin with an intelligible forest/telescope world through the spoken title. | Narrator bird; Rio Abajo forest; operational Arecibo; curved dish shape. | Beat 01 and opening beat 02; \`m412:e0\`–\`m412:e85\`. | Carry the dish's curve or a patch of dark sky into a field of listening marks for the question beginning around 20.320 seconds. |
| 02 — The unanswered universe · \`[20, 98)\` | poetic-abstraction | Begin with separated voice and listening marks for the question of why humans overlook nearby parrots. | Blue darkness; warm-gold voice marks; curved listening motif. | Later beat 02, beat 03, and early beat 04; \`m412:e88\`–\`m413:e115\`. | Let the distribution of marks find an equivalent in forest foliage when the narration returns to the local past. |
| 03 — A forest losing its chorus · \`[98, 113)\` | graphic-illustration | Return to a recognizable forest composition. | Same forest design and narrator species; branch patterns related to the prior marks. | Later beat 04; \`m413:e118\`–\`m413:e189\`. | Make a clear setting break for the reported Alex example, so a different bird cannot be mistaken for the narrator. |

## Compact mode sequence
`;
const CLIP = { sampleRateHz: 44100, sampleCount: 21608368 };
/** Fourteen synthetic adjacent rows that satisfy the pilot invariants, ending exactly at the clip end. */
const fourteen = () => Array.from({ length: 14 }, (_, k) => ({ number: String(k + 1).padStart(2, "0"), title: `Row ${k + 1}`, startSeconds: k * 10, endSeconds: k === 13 ? 489.9856689342404 : (k + 1) * 10,
  mode: "graphic-illustration" as const, intent: "i", references: "r", evidence: "e", transition: "t" }));

test("the treatment parser reads the fixed six-column table under its heading", () => {
  const rows = parseTreatmentTable(EXCERPT);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => [r.number, r.title, r.startSeconds, r.endSeconds, r.mode]),
    [["01", "The listener nearby", 0, 20, "graphic-illustration"], ["02", "The unanswered universe", 20, 98, "poetic-abstraction"], ["03", "A forest losing its chorus", 98, 113, "graphic-illustration"]]);
  assert.equal(rows[2]!.intent, "Return to a recognizable forest composition.");
  assert.equal(rows[0]!.references, "Narrator bird; Rio Abajo forest; operational Arecibo; curved dish shape.");
  assert.equal(rows[1]!.evidence, "Later beat 02, beat 03, and early beat 04; `m412:e88`–`m413:e115`.");
  assert.match(rows[0]!.transition, /^Carry the dish's curve/);
});

test("the treatment parser fails loudly on structural drift", () => {
  assert.throws(() => parseTreatmentTable(EXCERPT.replace("## Proposed sequences", "## Sequences")), /missing the "## Proposed sequences" heading/);
  assert.throws(() => parseTreatmentTable(EXCERPT.replace("| Mode |", "| Look |")), /header is not the expected six columns/);
  assert.throws(() => parseTreatmentTable(EXCERPT.replace("`[20, 98)`", "20–98")), /does not read "NN — title/);
  assert.throws(() => parseTreatmentTable(EXCERPT.replace("poetic-abstraction", "abstract")), /unknown mode: abstract/);
  assert.throws(() => parseTreatmentTable(EXCERPT.replace("| Beat 01 and opening beat 02; `m412:e0`–`m412:e85`. ", "")), /has 5 cells, expected 6/);
});

test("the pilot invariants require 14 adjacent rows from 0 to the clip end", () => {
  assert.throws(() => checkTreatmentRows(parseTreatmentTable(EXCERPT), CLIP), /has 3 rows, expected 14/);
  checkTreatmentRows(fourteen(), CLIP);
  const shifted = fourteen().map((r, k) => k === 0 ? { ...r, startSeconds: 1 } : r);
  assert.throws(() => checkTreatmentRows(shifted, CLIP), /row 01 starts at 1/);
  const gap = fourteen().map((r, k) => k === 5 ? { ...r, startSeconds: 51 } : r);
  assert.throws(() => checkTreatmentRows(gap, CLIP), /rows 05 and 06 are not adjacent/);
  const short = fourteen().map((r, k) => k === 13 ? { ...r, endSeconds: 480 } : r);
  assert.throws(() => checkTreatmentRows(short, CLIP), /ends at sample 21168000, but the clip has 21608368/);
  const misnumbered = fourteen().map((r, k) => k === 2 ? { ...r, number: "04" } : r);
  assert.throws(() => checkTreatmentRows(misnumbered, CLIP), /row 3 is numbered 04/);
});

test("the real treatment table parses to 14 rows satisfying the pilot invariants", async t => {
  const path = fileURLToPath(new URL("../../../data/stories/the-great-silence/visual-treatment.md", import.meta.url));
  if (!(await access(path).then(() => true, () => false))) return t.skip("local planning data is not present");
  const rows = parseTreatmentTable(await readFile(path, "utf8"));
  checkTreatmentRows(rows, CLIP);
  assert.equal(rows.map(r => r.mode[0]).join(""), "gpggggpggpppgg");
});

test("treatment seeds carry samples, labels, layered notes, and the fixed producer", () => {
  const seeds = treatmentSeeds(parseTreatmentTable(EXCERPT), 44100);
  assert.deepEqual(seeds.map(s => [s.startSample, s.label, s.mode]), [[0, "01 — The listener nearby", "graphic-illustration"], [882000, "02 — The unanswered universe", "poetic-abstraction"], [4321800, "03 — A forest losing its chorus", "graphic-illustration"]]);
  assert.equal(seeds[2]!.notes, "Return to a recognizable forest composition.\nReferences: Same forest design and narrator species; branch patterns related to the prior marks.\nEvidence: Later beat 04; `m413:e118`–`m413:e189`.\nTransition: Make a clear setting break for the reported Alex example, so a different bird cannot be mistaken for the narrator.");
  for (const s of seeds) { assert.equal(s.prompt, undefined); assert.equal(s.image, undefined); assert.equal(s.createdAt, TREATMENT_CREATED_AT); assert.deepEqual(s.producer, { name: "seed-treatment", version: "2026-09-07" }); assert.equal(s.key, `treatment:${s.label.slice(0, 2)}`); }
});

test("seed ids are deterministic ULIDs keyed by producer, key, and createdAt", () => {
  const id = deriveSeedId("seed-treatment", "treatment:03", TREATMENT_CREATED_AT);
  assert.match(id, ULID_PATTERN);
  assert.equal(id, deriveSeedId("seed-treatment", "treatment:03", TREATMENT_CREATED_AT));
  assert.notEqual(id, deriveSeedId("seed-treatment", "treatment:04", TREATMENT_CREATED_AT));
  assert.notEqual(id, deriveSeedId("seed-prototype", "treatment:03", TREATMENT_CREATED_AT));
  assert.notEqual(id.slice(0, 10), deriveSeedId("seed-treatment", "treatment:03", PROTOTYPE_CREATED_AT).slice(0, 10));
  assert.equal(id.slice(10), deriveSeedId("seed-treatment", "treatment:03", PROTOTYPE_CREATED_AT).slice(10));
  assert.throws(() => deriveSeedId("x", "y", "not a date"), /not a real instant/);
});

test("board looks map onto the two timeline modes; unknown boards are rejected", () => {
  assert.deepEqual(["graphic-literal", "painterly-literal", "photoreal-literal"].map(modeForBoard), ["graphic-illustration", "graphic-illustration", "graphic-illustration"]);
  assert.deepEqual(["painterly-abstract", "painterly-metaphor"].map(modeForBoard), ["poetic-abstraction", "poetic-abstraction"]);
  assert.throws(() => modeForBoard("watercolor"), /No mode mapping for prototype board: watercolor/);
});

test("crop geometry covers a board exactly in both orientations", () => {
  assert.deepEqual(cropPlan({ width: 1024, height: 1536, stackedPanels: 3 }), [
    { panel: 1, x: 0, y: 0, width: 1024, height: 512 }, { panel: 2, x: 0, y: 512, width: 1024, height: 512 }, { panel: 3, x: 0, y: 1024, width: 1024, height: 512 }]);
  assert.deepEqual(cropPlan({ width: 1536, height: 1024, stackedPanels: 3 }), [
    { panel: 1, x: 0, y: 0, width: 1536, height: 341 }, { panel: 2, x: 0, y: 341, width: 1536, height: 342 }, { panel: 3, x: 0, y: 683, width: 1536, height: 341 }]);
  for (const height of [1536, 1024]) assert.equal(cropPlan({ width: 1, height, stackedPanels: 3 }).reduce((sum, c) => sum + c.height, 0), height);
  assert.throws(() => cropPlan({ width: 10, height: 2, stackedPanels: 3 }), /Cannot split/);
});

test("prototype seeds produce three labeled, prompted panels per board and the suggested decision mix", () => {
  const board = (id: string, width: number, height: number) => ({ id, path: `assets/${id}.png`, sha256: "ab".repeat(32), byteLength: 1, width, height, stackedPanels: 3 });
  const assets = [board("painterly-metaphor", 1536, 1024), board("graphic-literal", 1024, 1536), board("painterly-abstract", 1024, 1536)];
  const prompts = assets.map(a => ({ id: a.id, prompt: `prompt for ${a.id}` }));
  const seeds = prototypeSeeds(assets, prompts, 44100);
  assert.equal(seeds.length, 9);
  assert.deepEqual(seeds.slice(0, 3).map(s => [s.label, s.startSample, s.mode, s.image!.crop.panel]),
    [["graphic-literal · telescope", 218313, "graphic-illustration", 1], ["graphic-literal · neighboring parrots", 750159, "graphic-illustration", 2], ["graphic-literal · listening", 896130, "graphic-illustration", 3]]);
  assert.deepEqual(PANELS.map(p => Math.round(p.seconds * 44100)), [218313, 750159, 896130]);
  const metaphor = seeds.filter(s => s.image!.boardId === "painterly-metaphor");
  assert.equal(metaphor[1]!.notes, `Prototype study frame from board painterly-metaphor (sha256 ${"ab".repeat(32)}), panel 2 of 3. Not a final asset. Board painterly-metaphor is not one of the two selected looks (graphic-literal, painterly-abstract).`);
  assert.equal(metaphor[1]!.prompt, "prompt for painterly-metaphor");
  assert.deepEqual(metaphor[2]!.image!.crop, { panel: 3, x: 0, y: 683, width: 1536, height: 341 });
  assert.ok(seeds.filter(s => s.image!.boardId === "graphic-literal").every(s => s.notes.endsWith("Not a final asset.")));
  for (const s of seeds) { assert.equal(s.createdAt, PROTOTYPE_CREATED_AT); assert.deepEqual(s.producer, { name: "seed-prototype", version: "2026-09-08" }); assert.equal(s.key, `prototype:${s.image!.boardId}:${s.image!.crop.panel}`); }
  assert.equal(new Set(seeds.map(s => s.id)).size, 9);
  const decisions = suggestedDecisions(seeds);
  const chosen = Object.keys(decisions).map(id => seeds.find(s => s.id === id)!.label);
  assert.deepEqual(chosen, ["graphic-literal · telescope", "graphic-literal · neighboring parrots", "painterly-abstract · listening"]);
  assert.deepEqual(Object.values(decisions)[0], { selected: true, notes: "Suggested by prototype; user may override" });
  assert.throws(() => prototypeSeeds(assets, prompts.slice(1), 44100), /No prompt recorded for prototype board: painterly-metaphor/);
  assert.throws(() => prototypeSeeds([{ ...assets[0]!, stackedPanels: 2 }], prompts, 44100), /has 2 panels, expected 3/);
  assert.throws(() => suggestedDecisions(seeds.slice(3)), /selects 1 panels, expected 3/);
});
