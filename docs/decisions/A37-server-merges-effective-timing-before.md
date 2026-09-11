# A37: The server merges effective timing before words, chunks, and snap targets are served.

**Status.** Standing.

**Decision.** The server merges effective timing before words, chunks, and snap targets are served. Chunking reruns on effective times.

**Why.** One place decides what "the timing" is.

**Cited by.** `packages/domain/src/timing.ts`, `src/modules/editor-server/timing.ts`

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
