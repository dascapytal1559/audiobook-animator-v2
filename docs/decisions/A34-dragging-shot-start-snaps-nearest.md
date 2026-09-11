# A34: Dragging a shot start snaps to the nearest word start or measured quiet-gap midpoint within a small pixel radius; a modifier disables snapping.

**Status.** Standing.

**Decision.** Dragging a shot start snaps to the nearest word start or measured quiet-gap midpoint within a small pixel radius; a modifier disables snapping. Snap targets come from the paired transcript.

**Why.** No new audio analysis is needed.

**Cited by.** `packages/editor/src/ShotLane.tsx`, `packages/editor/src/Timeline.tsx`, `packages/editor/src/snap.ts`

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
