import assert from "node:assert/strict";
import { test } from "node:test";
import { renderTimestampDemo } from "./demo-view.js";

const payload = '</script><img src=x onerror="alert(1)">&\u2028\u2029';
const fixture = () => ({
  schemaVersion: 1,
  provider: { name: "rev-ai", jobId: "synthetic-escaping-test" },
  input: { path: "/synthetic/input.flac", sha256: "a".repeat(64), byteLength: 100,
    durationSeconds: 120, sourceSha256: "b".repeat(64), sourceStartSeconds: 6450,
    sourceClock: "decoded-audio", timingCaveat: payload },
  elements: [{ kind: "word", id: "m0:e0", speaker: 0, value: payload, confidence: null,
    clipStartSeconds: 1.25, clipEndSeconds: 1.75, sourceStartSeconds: 6451.25, sourceEndSeconds: 6451.75 }],
  wordCount: 1,
});

test("external transcript text cannot close its script-data element and survives serialization intact", () => {
  const html = renderTimestampDemo(fixture());
  assert.equal(html.includes('<img src=x onerror="alert(1)">'), false);
  assert.equal((html.match(/<script[ >]/g) ?? []).length, 2);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 2);
  const embedded = /<script id="transcript-data" type="application\/json">(.*?)<\/script>/s.exec(html)?.[1];
  assert.ok(embedded);
  const decoded = JSON.parse(embedded) as ReturnType<typeof fixture>;
  assert.equal(decoded.elements[0]?.value, payload);
  assert.equal(decoded.input.timingCaveat, payload);
  assert.equal(html.includes(".innerHTML"), false);
});

test("renderer rejects inconsistent source offsets, reversed ranges, and ambiguous element identities", () => {
  const wrongClock = fixture();
  wrongClock.elements[0]!.sourceStartSeconds += 1;
  assert.throws(() => renderTimestampDemo(wrongClock), /decoded-audio clock/);
  const reversed = fixture();
  reversed.elements[0]!.clipEndSeconds = 0;
  assert.throws(() => renderTimestampDemo(reversed), /decoded-audio clock/);
  const duplicate = fixture();
  duplicate.elements.push({ ...duplicate.elements[0]! });
  duplicate.wordCount = 2;
  assert.throws(() => renderTimestampDemo(duplicate), /duplicate element IDs/);
});
