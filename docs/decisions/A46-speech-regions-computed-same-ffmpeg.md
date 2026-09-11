# A46: Speech regions are computed in the same FFmpeg decode as peaks and cached beside them under `<story>/cache/`, pinned to the audio hash.

**Status.** Standing.

**Decision.** Speech regions are computed in the same FFmpeg decode as peaks and cached beside them under `<story>/cache/`, pinned to the audio hash.

**Why.** One pass, two artifacts.

**Cited by.** `packages/domain/src/audio.ts`, `src/modules/editor-server/peaks.ts`, `src/modules/editor-server/timing.ts`

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
