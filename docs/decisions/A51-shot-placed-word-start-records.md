# A51: A shot placed on a word start records an anchor to that word id in its decision and follows the word's effective start; dragging the shot marker detaches it to a plain sample position; snapping to a word re-anchors.

**Status.** Standing.

**Decision.** A shot placed on a word start records an anchor to that word id in its decision and follows the word's effective start; dragging the shot marker detaches it to a plain sample position; snapping to a word re-anchors. The audio clock remains the only ground truth.

**Why.** Q22: shots follow words by default but move independently.

**Cited by.** `packages/domain/src/shots.ts`, `packages/editor/src/App.tsx`, `packages/editor/src/ShotLane.tsx`, `packages/editor/src/state.test.ts`, `packages/editor/src/state.ts`, `packages/editor/src/timing.ts`

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
