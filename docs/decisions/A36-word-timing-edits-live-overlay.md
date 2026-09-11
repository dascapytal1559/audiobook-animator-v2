# A36: Word timing edits live in overlay files in the story's story directory, keyed by word id, holding `startSample`/`endSample` on the clip clock and pinned to the transcript hash.

**Status.** Standing.

**Decision.** Word timing edits live in overlay files in the story's story directory, keyed by word id, holding `startSample`/`endSample` on the clip clock and pinned to the transcript hash. The paired transcript is never written and is the backup by construction.

**Why.** It is hash-pinned acceptance evidence; a copy would be a second source of truth.

**Cited by.** `packages/domain/src/api.ts`, `packages/editor/src/state.ts`

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
