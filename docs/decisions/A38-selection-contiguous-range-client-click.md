# A38: Selection is a contiguous range and client-only: click selects, shift-click extends, Escape clears.

**Status.** Standing.

**Decision.** Selection is a contiguous range and client-only: click selects, shift-click extends, Escape clears. Sentence mode selects whole sentences and moves all their words.

**Why.** Covers the alignment use without a discontiguous-selection model.

**Cited by.** `packages/editor/src/App.tsx`, `packages/editor/src/Timeline.tsx`, `packages/editor/src/selection.ts`, `packages/editor/src/state.test.ts`, `packages/editor/src/state.ts`

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
