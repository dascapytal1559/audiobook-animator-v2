import type { StoryElement, StoryWord } from "../api.js";
import type { SubtitleSentence, SubtitleToken } from "./contracts.js";

const normalize = (text: string) => text.replace(/\s+/gu, " ");
const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
const TITLES = new Set(["mr", "mrs", "ms", "dr", "prof", "rev", "fr", "st", "mt", "capt", "gen", "col", "lt", "sgt", "sr", "jr"]);
type LocatedWord = { id: string; value: string; start: number; end: number };

/**
 * Punctuation-only sentences, independent of word timing and editor chunks (A61). Unicode segmentation handles quotes and ellipses;
 * English titles/initials and lowercase continuations (including dialogue tags) repair its overly eager period/question boundaries.
 * No boundary may cut through one timed token, even when the provider put multiple written words inside it.
 */
export function subtitleSentences(elements: ReadonlyArray<StoryElement>, words: ReadonlyArray<Pick<StoryWord, "id" | "value">>): ReadonlyArray<SubtitleSentence> {
  const byId = new Map(words.map(word => [word.id, word]));
  const located: LocatedWord[] = [];
  let text = "";
  for (const element of elements) {
    if (element.kind === "punctuation") {
      const value = normalize(element.value);
      text += text.endsWith(" ") ? value.replace(/^ /u, "") : value;
      continue;
    }
    const word = byId.get(element.id);
    if (word === undefined) throw new RangeError(`Subtitle transcript references missing word ${element.id}.`);
    const value = normalize(word.value).trim();
    located.push({ id: word.id, value, start: text.length, end: text.length + value.length });
    text += value;
  }
  if (located.length === 0) return [];

  const sentences: SubtitleSentence[] = [];
  let first = 0;
  let next = 0;
  let start = 0;
  // A same-length shadow makes a typographic ellipsis behave like sentence punctuation without changing the displayed text or offsets.
  for (const segment of segmenter.segment(text.replace(/…/gu, "."))) {
    const end = segment.index + segment.segment.length;
    while (next < located.length && located[next]!.end <= end) next++;
    if (next === first) continue;
    // A segment boundary inside a provider token is not a usable subtitle boundary.
    if (next < located.length && located[next]!.start < end) continue;
    const previous = located[next - 1]!;
    const following = located[next];
    if (following !== undefined) {
      const mark = text.slice(previous.end, end).trim();
      const value = previous.value.replace(/\.$/u, "");
      const period = (mark.startsWith(".") && !mark.startsWith("...")) || (previous.value.endsWith(".") && mark === "");
      if (period && (TITLES.has(value.toLowerCase()) || /^[A-Z]$/u.test(value))) continue;
      if (/^\p{Ll}/u.test(following.value)) continue;
    }
    sentences.push({ id: located[first]!.id, tokens: tokensIn(text, located.slice(first, next), start, end) });
    first = next;
    start = end;
  }
  return sentences;
}

/** Opening punctuation travels with the following word when a sentence is split into phrases or lines. */
function tokensIn(text: string, words: ReadonlyArray<LocatedWord>, start: number, end: number): SubtitleToken[] {
  let prefix = text.slice(start, words[0]!.start);
  return words.map((word, index) => {
    const next = words[index + 1];
    const gap = text.slice(word.end, next?.start ?? end);
    // Curly quotes/brackets are unambiguous; a straight quote after whitespace opens a new quoted phrase.
    const opening = next === undefined ? -1 : gap.search(/[“‘([{]|(?<=\s)["']/u);
    const token = { wordId: word.id, prefix, value: word.value, suffix: opening < 0 ? gap : gap.slice(0, opening) };
    prefix = opening < 0 ? "" : gap.slice(opening);
    return token;
  });
}

export const subtitleText = (tokens: ReadonlyArray<SubtitleToken>): string => tokens.map(token => token.prefix + token.value + token.suffix).join("").trim();
