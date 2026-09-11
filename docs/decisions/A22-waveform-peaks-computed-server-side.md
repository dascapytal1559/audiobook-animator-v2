# A22: Waveform peaks are computed server-side once, cached beside the clip, and served with byte-range audio streaming.

**Status.** Standing.

**Decision.** Waveform peaks are computed server-side once, cached beside the clip, and served with byte-range audio streaming.

**Why.** Keeps the browser cheap and works for the multi-hour stories.

**Cited by.** `packages/editor/src/ChunkLane.tsx`, `packages/editor/src/Waveform.tsx`

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
