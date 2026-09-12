import type { ClipIdentity } from "../identity.js";
import type { StoryWord } from "../api.js";
import { millisecondsToSamples } from "../time.js";
import { subtitleDefaults, type SubtitleCue, type TimedSubtitleCue } from "./contracts.js";

/** Effective word spans time the derived cues; gaps within a cue never make its text disappear (A61). */
export function timeSubtitles(cues: ReadonlyArray<SubtitleCue>, words: ReadonlyArray<Pick<StoryWord, "id" | "startSample" | "endSample">>, clip: Pick<ClipIdentity, "sampleRateHz" | "sampleCount">): ReadonlyArray<TimedSubtitleCue> {
  const byId = new Map(words.map(word => [word.id, word]));
  const tail = millisecondsToSamples(subtitleDefaults.endHoldMs, clip.sampleRateHz);
  const timed = cues.map(cue => {
    const members = cue.lines.flat().map(token => {
      const word = byId.get(token.wordId);
      if (word === undefined) throw new RangeError(`Subtitle ${cue.id} references missing timed word ${token.wordId}.`);
      return word;
    });
    // Enclose every member when the input has a timing inversion. Text order and membership stay untouched.
    return { ...cue, startSample: Math.min(...members.map(word => word.startSample)), endSample: Math.min(clip.sampleCount, Math.max(...members.map(word => word.endSample)) + tail) };
  }).sort((a, b) => a.startSample - b.startSample);
  return timed.map((cue, index) => ({ ...cue, endSample: Math.min(cue.endSample, timed[index + 1]?.startSample ?? clip.sampleCount) }))
    .filter(cue => cue.endSample > cue.startSample);
}

/** Half-open cue spans on the clip clock; equally timed cues resolve to the later one in transcript order (A61). */
export function subtitleAt(cues: ReadonlyArray<TimedSubtitleCue>, sample: number): TimedSubtitleCue | null {
  let lo = 0;
  let hi = cues.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cues[mid]!.startSample <= sample) lo = mid + 1;
    else hi = mid;
  }
  const cue = cues[lo - 1];
  return cue !== undefined && sample < cue.endSample ? cue : null;
}
