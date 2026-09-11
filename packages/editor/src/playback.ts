/** One playback tick's decision: keep advancing, wrap a loop, or stop at a boundary. Pure so it can be tested without an audio element. */
import type { StitchedEntry } from "./api.js";
import { entryAt } from "@animator/domain";

export type TickInput = {
  readonly sample: number; readonly sampleCount: number; readonly toleranceSamples: number;
  readonly stitched: ReadonlyArray<StitchedEntry>; readonly loop: boolean;
  /** Start sample of the entry being looped, fixed when the loop began; null re-anchors at the playhead. */
  readonly loopAnchorStart: number | null;
  readonly region: { readonly start: number; readonly end: number } | null;
};
export type TickPlan =
  | { readonly kind: "advance"; readonly loopAnchorStart: number | null }
  | { readonly kind: "wrap"; readonly target: number; readonly loopAnchorStart: number | null }
  | { readonly kind: "stop"; readonly target: number };

export function planTick(input: TickInput): TickPlan {
  const { sample, sampleCount, region } = input;
  let anchorStart: number | null = null;
  let loopEntry: StitchedEntry | null = null;
  if (input.loop) {
    const anchored = input.loopAnchorStart === null ? undefined : input.stitched.find(e => e.startSample === input.loopAnchorStart);
    loopEntry = anchored ?? entryAt(input.stitched, sample, input.toleranceSamples);
    anchorStart = loopEntry?.startSample ?? null;
  }
  const stopAt = Math.min(region?.end ?? sampleCount, loopEntry?.endSample ?? sampleCount);
  if (sample < stopAt) return { kind: "advance", loopAnchorStart: anchorStart };
  if (!input.loop) return { kind: "stop", target: stopAt };
  const loopStart = Math.max(loopEntry?.startSample ?? 0, region?.start ?? 0);
  // A looped shot that lies entirely past the region's out-point cannot be looped; fall back to the region start.
  return loopStart < stopAt ? { kind: "wrap", target: loopStart, loopAnchorStart: anchorStart } : { kind: "wrap", target: region?.start ?? 0, loopAnchorStart: null };
}
