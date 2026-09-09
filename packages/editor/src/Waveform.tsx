import { useEffect, useRef } from "react";
import type { PeaksResponse, Span } from "./api.js";

type Props = { peaks: PeaksResponse | null; regions: ReadonlyArray<Span> | null; viewStartSample: number; pxPerSample: number; width: number; height: number };

const SPEECH_BAND = "rgba(74, 222, 128, 0.16)";

/**
 * Draws only the visible window of the clip: one min/max column per device pixel from the server's peak buckets (A22), over a
 * translucent band for every detected speech region in view (A44) when `regions` is given.
 */
export function Waveform({ peaks, regions, viewStartSample, pxPerSample, width, height }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null || width <= 0 || height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    if (regions !== null) {
      const viewEndSample = viewStartSample + width / pxPerSample;
      ctx.fillStyle = SPEECH_BAND;
      for (const region of regions) {
        if (region.endSample < viewStartSample || region.startSample > viewEndSample) continue;
        const x0 = (region.startSample - viewStartSample) * pxPerSample;
        const x1 = (region.endSample - viewStartSample) * pxPerSample;
        ctx.fillRect(x0, 0, Math.max(1, x1 - x0), height);
      }
    }
    if (peaks === null) return;
    const mid = height / 2;
    const scale = (height / 2 - 1) / 32768;
    ctx.fillStyle = "#7dd3fc";
    const bucketCount = peaks.min.length;
    for (let x = 0; x < width; x++) {
      const s0 = viewStartSample + x / pxPerSample;
      const s1 = viewStartSample + (x + 1) / pxPerSample;
      const b0 = Math.max(0, Math.floor(s0 / peaks.samplesPerBucket));
      const b1 = Math.min(bucketCount, Math.max(b0 + 1, Math.ceil(s1 / peaks.samplesPerBucket)));
      if (b0 >= bucketCount) break;
      let lo = 32767;
      let hi = -32768;
      for (let b = b0; b < b1; b++) {
        const mn = peaks.min[b] ?? 0;
        const mx = peaks.max[b] ?? 0;
        if (mn < lo) lo = mn;
        if (mx > hi) hi = mx;
      }
      const top = mid - hi * scale;
      const bottom = mid - lo * scale;
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
  }, [peaks, regions, viewStartSample, pxPerSample, width, height]);
  return <canvas ref={ref} className="waveform" style={{ width, height }} />;
}
