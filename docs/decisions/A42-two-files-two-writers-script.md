# A42: Two files, two writers: the script owns `word-timing.auto.json`; the editor owns `word-timing.json`.

**Status.** Standing.

**Decision.** Two files, two writers: the script owns `word-timing.auto.json`; the editor owns `word-timing.json`. Effective timing is manual, else auto, else original. Re-running the script replaces auto entries for its range and never touches manual ones.

**Why.** Same two-layer rule as shot records and decisions (Q17).

**Cited by.** `packages/domain/src/api.ts`, `packages/domain/src/timing.ts`, `packages/editor/src/state.ts`, `packages/editor/src/timing.ts`, `src/modules/word-timing/index.ts`

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
