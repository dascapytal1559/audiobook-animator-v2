# A51: A shot placed on a word start records an anchor to that word id in its decision and follows the word's effective start; dragging the shot marker detaches it to a plain sample position; snapping to a word re-anchors.

**Status.** Standing (amended 2026-10-03 under A66: a record may carry its own anchor).

**Decision.** A shot placed on a word start records an anchor to that word id in its decision and follows the word's effective start; dragging the shot marker detaches it to a plain sample position; snapping to a word re-anchors. The audio clock remains the only ground truth.

*Amended by A66:* a writer that places a shot at a word may record the word in the shot record itself (`anchorWordId`), so a shot generated in the background follows its word without anyone writing `decisions.json`. The decision still wins: a decision anchor moves it to another word, and a decision `startSample` without an anchor detaches it.

**Why.** Q22: shots follow words by default but move independently.

**Cited by.** `packages/domain/src/shots.ts`, `packages/editor/src/App.tsx`, `packages/editor/src/ShotLane.tsx`, `packages/editor/src/state.test.ts`, `packages/editor/src/state.ts`, `packages/editor/src/timing.ts`

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
