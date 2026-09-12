import assert from "node:assert/strict";
import test from "node:test";
import type { StoryElement } from "../api.js";
import { layoutSubtitles } from "./layout.js";
import { subtitleSentences, subtitleText } from "./sentences.js";
import { subtitleAt, timeSubtitles } from "./timing.js";

/** A fixture shaped like the GPT stream, with explicit provider-token fixtures below where that distinction matters. */
function transcript(text: string) {
  const elements: StoryElement[] = [];
  const words: { id: string; value: string; startSample: number; endSample: number }[] = [];
  for (const value of text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*|[^\p{L}\p{N}]+/gu) ?? []) {
    if (!/^[\p{L}\p{N}]/u.test(value)) elements.push({ kind: "punctuation", value });
    else {
      const id = `w${words.length}`;
      words.push({ id, value, startSample: words.length * 500, endSample: words.length * 500 + 300 });
      elements.push({ kind: "word", id });
    }
  }
  return { elements, words };
}
const sentences = (text: string) => { const source = transcript(text); return subtitleSentences(source.elements, source.words); };
const texts = (text: string) => sentences(text).map(sentence => subtitleText(sentence.tokens));
const cueText = (cue: ReturnType<typeof layoutSubtitles>[number]) => cue.lines.map(subtitleText).join(" ");
const measure = (text: string) => text.length;

test("sentences preserve opening/closing quotes, abbreviations, initials, and lowercase dialogue continuations", () => {
  assert.deepEqual(texts('Dr. Hooper met Mr. Smith. “Why?” she asked. “Because.”'), ["Dr. Hooper met Mr. Smith.", "“Why?” she asked.", "“Because.”"]);
  assert.deepEqual(texts('A. B. Smith arrived. "Hello," he said.'), ["A. B. Smith arrived.", '"Hello," he said.']);
  assert.deepEqual(texts("They paid 3.14 dollars. It wasn't cheap."), ["They paid 3.14 dollars.", "It wasn't cheap."]);
});

test("ellipses within a thought stay inside the sentence; a capitalized new thought may start another", () => {
  assert.deepEqual(texts("He waited... then left. She waited… Then she left."), ["He waited... then left.", "She waited…", "Then she left."]);
  assert.deepEqual(texts("He thought—perhaps too late—that it was over."), ["He thought—perhaps too late—that it was over."]);
});

test("empty text produces no sentences and punctuation-only input is harmless", () => {
  assert.deepEqual(sentences(""), []);
  assert.deepEqual(sentences("… \n"), []);
  assert.deepEqual(texts("\n“Hello.”\n\n"), ["“Hello.”"]);
  assert.throws(() => subtitleSentences([{ kind: "word", id: "missing" }], []), /missing word missing/);
  const splitWhitespace: StoryElement[] = [{ kind: "word", id: "a" }, { kind: "punctuation", value: "\n" }, { kind: "punctuation", value: "  \t" }, { kind: "word", id: "b" }];
  assert.equal(subtitleText(subtitleSentences(splitWhitespace, [{ id: "a", value: "Hello" }, { id: "b", value: "there" }])[0]!.tokens), "Hello there");
});

test("pause lengths and timing corrections cannot change sentence or phrase membership", () => {
  const source = transcript("A sentence with a very long pause still stays a sentence. Next.");
  const shifted = source.words.map((word, index) => ({ ...word, startSample: word.startSample + index * 10000, endSample: word.endSample + index * 10000 }));
  const original = subtitleSentences(source.elements, source.words);
  assert.deepEqual(subtitleSentences(source.elements, shifted), original);
  assert.equal(original.length, 2);
  assert.deepEqual(layoutSubtitles(original, measure, 32), layoutSubtitles(subtitleSentences(source.elements, shifted), measure, 32));
});

test("one- and two-line sentences remain single cues; lines never exceed the measured width", () => {
  const short = layoutSubtitles(sentences("The great silence."), measure, 30);
  assert.equal(short.length, 1);
  assert.equal(short[0]!.lines.length, 1);
  const two = layoutSubtitles(sentences("The humans listened, but the sky was quiet."), measure, 25);
  assert.equal(two.length, 1);
  assert.equal(two[0]!.lines.length, 2);
  assert.deepEqual(two[0]!.lines.map(subtitleText), ["The humans listened,", "but the sky was quiet."]);
});

test("long sentences split into readable phrases with every word and punctuation preserved once", () => {
  const text = '“The people listened for a voice, but nobody could hear a reply; when morning came, they quietly returned to their homes.”';
  const input = sentences(text);
  const cues = layoutSubtitles(input, measure, 32);
  assert.ok(cues.length >= 2);
  assert.ok(cues.every(cue => cue.lines.length <= 2 && cue.lines.flat().length > 2));
  assert.ok(cues.every(cue => cue.lines.every(line => measure(subtitleText(line)) <= 32)));
  assert.deepEqual(cues.flatMap(cue => cue.lines.flat().map(token => token.wordId)), input.flatMap(sentence => sentence.tokens.map(token => token.wordId)));
  assert.equal(cues.map(cueText).join(" "), text);
});

test("opening quotes follow the next phrase instead of appearing at the end of the previous line", () => {
  const input = sentences('He said, “the world is quiet,” and everyone listened.');
  const cues = layoutSubtitles(input, measure, 22);
  assert.equal(cues.map(cueText).join(" "), 'He said, “the world is quiet,” and everyone listened.');
  assert.ok(cues.every(cue => cue.lines.every(line => !subtitleText(line).endsWith("“"))));
  const the = input[0]!.tokens.find(token => token.value === "the")!;
  assert.equal(the.prefix, "“");
});

test("multiword provider tokens remain indivisible, including a sentence mark inside a timed token", () => {
  const elements: StoryElement[] = [{ kind: "word", id: "a" }, { kind: "punctuation", value: " " }, { kind: "word", id: "b" }, { kind: "punctuation", value: "." }];
  const input = subtitleSentences(elements, [{ id: "a", value: "14 billion" }, { id: "b", value: "years" }]);
  const cues = layoutSubtitles(input, measure, 8);
  assert.equal(cues[0]!.lines[0]![0]!.value, "14 billion");
  assert.ok(cues[0]!.fontScale < 1);
  assert.equal(cues.map(cueText).join(" "), "14 billion years.");
  assert.deepEqual(subtitleSentences([{ kind: "word", id: "a" }], [{ id: "a", value: "Stop. Go." }]).map(sentence => subtitleText(sentence.tokens)), ["Stop. Go."]);
});

test("an unusually long token scales to fit without truncation or invented sub-token timing", () => {
  const text = "W".repeat(200);
  const cues = layoutSubtitles(sentences(text), measure, 30);
  assert.equal(cues.length, 1);
  assert.equal(cueText(cues[0]!), text);
  assert.equal(cues[0]!.fontScale, 30 / 200);
  assert.throws(() => layoutSubtitles(sentences("Hi."), measure, 0), /positive and finite/);
  assert.throws(() => layoutSubtitles(sentences("Hi."), () => NaN), /measurement/);
});

test("subtitles persist through internal gaps and clear exactly at the 250 ms tail", () => {
  const source = transcript("Hello there. Next.");
  const cues = layoutSubtitles(subtitleSentences(source.elements, source.words), measure, 40);
  const words = source.words.map((word, index) => ({ ...word, startSample: [100, 1000, 2000][index]!, endSample: [300, 1300, 2200][index]! }));
  const timed = timeSubtitles(cues, words, { sampleRateHz: 1000, sampleCount: 3000 });
  assert.equal(subtitleAt(timed, 99), null);
  assert.equal(subtitleAt(timed, 100)?.id, "w0");
  assert.equal(subtitleAt(timed, 800)?.id, "w0");
  assert.equal(subtitleAt(timed, 1549)?.id, "w0");
  assert.equal(subtitleAt(timed, 1550), null);
  assert.equal(subtitleAt(timed, 2000)?.id, "w2");
  assert.equal(subtitleAt(timed, 2450), null);
  // Backward seeking is a fresh lookup, independent of playback history.
  assert.equal(subtitleAt(timed, 100)?.id, "w0");
});

test("next-cue onset cuts the previous tail and the final tail cannot extend beyond the clip", () => {
  const source = transcript("Hello. Next.");
  const cues = layoutSubtitles(subtitleSentences(source.elements, source.words), measure, 40);
  const timed = timeSubtitles(cues, source.words, { sampleRateHz: 1000, sampleCount: 900 });
  assert.equal(timed[0]!.endSample, 500);
  assert.equal(subtitleAt(timed, 499)?.id, "w0");
  assert.equal(subtitleAt(timed, 500)?.id, "w1");
  assert.equal(timed[1]!.endSample, 900);
  assert.equal(subtitleAt(timed, 900), null);
});

test("effective timing changes retime cues without changing their text, and overlapping spans have one visible cue", () => {
  const source = transcript("Hello. Next.");
  const cues = layoutSubtitles(subtitleSentences(source.elements, source.words), measure, 40);
  const moved = source.words.map(word => ({ ...word, startSample: word.startSample + 1000, endSample: word.endSample + 1000 }));
  const timed = timeSubtitles(cues, moved, { sampleRateHz: 1000, sampleCount: 3000 });
  assert.equal(subtitleAt(timed, 500), null);
  assert.equal(subtitleAt(timed, 1000)?.id, "w0");
  assert.deepEqual(timed.map(cueText), ["Hello.", "Next."]);
  const overlap = timeSubtitles(cues, [source.words[0]!, { ...source.words[1]!, startSample: 200 }], { sampleRateHz: 1000, sampleCount: 3000 });
  assert.equal(subtitleAt(overlap, 199)?.id, "w0");
  assert.equal(subtitleAt(overlap, 200)?.id, "w1");
  assert.throws(() => timeSubtitles(cues, [], { sampleRateHz: 1000, sampleCount: 3000 }), /missing timed word/);
});

test("timing inversions enclose all members, and identical onsets resolve without a zero-length visible cue", () => {
  const source = transcript("Hello there. Next.");
  const cues = layoutSubtitles(subtitleSentences(source.elements, source.words), measure, 40);
  const words = source.words.map((word, index) => ({ ...word, startSample: [500, 100, 100][index]!, endSample: [900, 300, 700][index]! }));
  const clip = { sampleRateHz: 1000, sampleCount: 2000 };
  const single = timeSubtitles([cues[0]!], words, clip);
  assert.equal(single[0]!.startSample, 100);
  assert.equal(single[0]!.endSample, 1150);
  const tied = timeSubtitles(cues, words, clip);
  assert.ok(tied.every(cue => cue.startSample < cue.endSample));
  assert.equal(subtitleAt(tied, 100)?.id, "w2");
  assert.equal(subtitleAt([], 100), null);
});
