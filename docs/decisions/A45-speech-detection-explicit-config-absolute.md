# A45: Speech detection is explicit config: absolute -50 dBFS on 10 ms RMS frames, minimum silence 150 ms, minimum speech 50 ms.

**Status.** Standing.

**Decision.** Speech detection is explicit config: absolute -50 dBFS on 10 ms RMS frames, minimum silence 150 ms, minimum speech 50 ms.

**Why.** Measured on the pilot: the energy histogram is bimodal with a trough at -50 dBFS and the source is noise-gated, so a relative threshold is meaningless.

**Cited by.** `src/modules/editor-server/contracts.ts`, `src/modules/word-timing/speech.ts`

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
