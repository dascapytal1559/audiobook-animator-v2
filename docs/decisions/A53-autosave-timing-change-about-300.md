# A53: Autosave on every timing change about 300 ms after the last edit, with the same saved/saving indicator as decisions; no commit step.

**Status.** Standing.

**Decision.** Autosave on every timing change about 300 ms after the last edit, with the same saved/saving indicator as decisions; no commit step.

**Why.** The write is a small JSON file.

**Cited by.** `packages/editor/src/App.tsx`, `packages/editor/src/state.test.ts`

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
