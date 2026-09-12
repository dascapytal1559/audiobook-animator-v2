import { subtitleDefaults, type SubtitleCue, type SubtitleSentence, type SubtitleToken } from "./contracts.js";
import { subtitleText } from "./sentences.js";

const WEAK_END = /^(?:a|an|the|of|to|in|on|at|for|with|and|or|but|if|that)$/iu;
const PHRASE_START = /^(?:and|but|or|because|although|when|while|where|which|who|if|unless)$/iu;

/** Prefer punctuation/clauses, and avoid separating an article or preposition from what follows it. */
function breakCost(tokens: ReadonlyArray<SubtitleToken>, end: number): number {
  if (end === tokens.length) return 0;
  const last = tokens[end - 1]!;
  if (/[,;:—–]/u.test(last.suffix)) return 0;
  if (WEAK_END.test(last.value)) return 18;
  return PHRASE_START.test(tokens[end]!.value) ? 2 : 8;
}

type Lines = { lines: ReadonlyArray<ReadonlyArray<SubtitleToken>>; cost: number; width: number };

/**
 * Whole sentences stay together if they fit in two measured lines (A61). Otherwise dynamic programming chooses phrase boundaries,
 * balancing cue lengths and preferring punctuation over a cut inside a phrase. Only transcript-token boundaries are candidates.
 * Measurement is supplied by the renderer at the fixed reference size, so grouping is independent of viewport size and timing.
 */
export function layoutSubtitles(sentences: ReadonlyArray<SubtitleSentence>, measureText: (text: string) => number, lineWidth: number = subtitleDefaults.lineWidth): ReadonlyArray<SubtitleCue> {
  if (!Number.isFinite(lineWidth) || lineWidth <= 0) throw new RangeError("Subtitle line width must be positive and finite.");
  return sentences.flatMap(sentence => layoutSentence(sentence.tokens, measureText, lineWidth));
}

function layoutSentence(tokens: ReadonlyArray<SubtitleToken>, measure: (text: string) => number, limit: number): SubtitleCue[] {
  if (tokens.length === 0) return [];
  // Bounded by the number of tokens that can fit on one line, rather than measuring the whole story on every candidate cut.
  const widths = tokens.map((_, start) => {
    const row = new Map<number, number>();
    for (let end = start + 1; end <= tokens.length; end++) {
      const width = measure(subtitleText(tokens.slice(start, end)));
      if (!Number.isFinite(width) || width < 0) throw new RangeError("Subtitle text measurement must be non-negative and finite.");
      if (width > limit && end > start + 1) break;
      row.set(end, width);
      if (width > limit) break;
    }
    return row;
  });
  const fit = (start: number, end: number): Lines | null => {
    const width = widths[start]!.get(end);
    if (width !== undefined) return { lines: [tokens.slice(start, end)], cost: 0, width };
    let best: Lines | null = null;
    for (const [split, firstWidth] of widths[start]!) {
      if (split >= end || firstWidth > limit) break;
      const secondWidth = widths[split]!.get(end);
      if (secondWidth === undefined || secondWidth > limit) continue;
      const cost = 12 * ((firstWidth - secondWidth) / limit) ** 2 + breakCost(tokens, split);
      if (best === null || cost < best.cost) best = { lines: [tokens.slice(start, split), tokens.slice(split, end)], cost, width: Math.max(firstWidth, secondWidth) };
    }
    return best;
  };
  const cue = (start: number, fitted: Lines): SubtitleCue => ({ id: tokens[start]!.wordId, lines: fitted.lines, fontScale: Math.min(1, limit / Math.max(1, fitted.width)) });
  const whole = fit(0, tokens.length);
  if (whole !== null) return [cue(0, whole)];

  const costs = new Array<number>(tokens.length + 1).fill(Infinity);
  const choices = new Map<number, { end: number; fitted: Lines }>();
  costs[tokens.length] = 0;
  for (let start = tokens.length - 1; start >= 0; start--) {
    for (let end = start + 1; end <= tokens.length; end++) {
      const fitted = fit(start, end);
      if (fitted === null) break;
      const count = end - start;
      const length = fitted.lines.reduce((sum, line) => sum + measure(subtitleText(line)), 0) / limit;
      const cost = 100 + 12 * (2 - length) ** 2 + fitted.cost + breakCost(tokens, end) + (count === 1 ? 60 : count === 2 ? 20 : 0) + costs[end]!;
      if (cost < costs[start]!) { costs[start] = cost; choices.set(start, { end, fitted }); }
    }
  }
  const result: SubtitleCue[] = [];
  for (let start = 0; start < tokens.length;) {
    const choice = choices.get(start)!; // Even one overlong token fits alone, scaled down without dropping its text or inventing timing.
    result.push(cue(start, choice.fitted));
    start = choice.end;
  }
  return result;
}
