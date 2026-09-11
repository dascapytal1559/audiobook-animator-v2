# A39: A group move is a horizontal drag of any selected box; every selected word's start shifts by the same amount and ends ride along, so durations are preserved.

**Status.** Standing.

**Decision.** A group move is a horizontal drag of any selected box; every selected word's start shifts by the same amount and ends ride along, so durations are preserved. The leading edge snaps to speech onsets, Alt disables, comma and period nudge by 10 ms.

**Why.** Q21: translate only; start time is what matters.

**Cited by.** `packages/editor/src/App.tsx`, `packages/editor/src/Timeline.tsx`, `packages/editor/src/snap.ts`, `packages/editor/src/timing.ts`

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
