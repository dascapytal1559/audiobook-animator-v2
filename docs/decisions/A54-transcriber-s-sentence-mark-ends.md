# A54: A transcriber's sentence mark only ends a sentence chunk when the gap to the next word is at least the story's `chunking.minSentenceBreakMs`, set per story in `story.json` and defaulting to the server config's value of 0 (rule off).

**Status.** Standing.

**Decision.** A transcriber's sentence mark only ends a sentence chunk when the gap to the next word is at least the story's `chunking.minSentenceBreakMs`, set per story in `story.json` and defaulting to the server config's value of 0 (rule off). Measured across the corpus on 2026-09-09, 5–6% of sentence breaks sit under 150 ms with no clean gap, so the rule is enabled story by story after listening; it is on at 150 ms for The Great Silence and Tower of Babylon. Breaks merged by this rule are listed in the story payload for audit. Confirmed on the pilot 2026-09-09: of 95 sentence breaks, three sat on gaps of 0–64 ms and the user verified all three were misplaced periods; the next smallest gap is 180 ms and the median is about 1 s.

**Why.** A period with no audible pause behind it is a transcription error, and the margin on the pilot is wide. Other narrators must be measured before trusting the threshold.

**Cited by.** `packages/domain/src/api.ts`, `src/modules/editor-server/contracts.ts`, `src/modules/editor-server/timing.ts`

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
