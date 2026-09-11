# A47: The align algorithm is a pure function in a `word-timing` module: shift the range's words by the configured lead (default 150 ms), assign each word to the speech region it overlaps most, snap each region's first start and last end to the region edges, scale interior words linearly.

**Status.** Standing.

**Decision.** The align algorithm is a pure function in a `word-timing` module: shift the range's words by the configured lead (default 150 ms), assign each word to the speech region it overlaps most, snap each region's first start and last end to the region edges, scale interior words linearly. Regions with no words are ignored. A word wholly in silence follows its sentence: it joins the region of its nearest overlapping neighbour in transcript order without crossing a sentence start, and only falls back to the nearest region by distance when it has such a neighbour on both sides or on neither (amended 2026-09-09 after a Tower of Babylon sentence start was pulled back into the previous phrase by a 17 ms distance margin; the rerun moved 1,035 of 187,067 words across the corpus, 0.55%, nearly all sentence starts moved later, and none on the pilot).

**Why.** Measured on the pilot: a constant ~150 ms lead with ~140 ms jitter and no drift; this correction takes words fully inside speech from 86% to 94%.

**Cited by.** `packages/domain/src/timing.ts`, `src/modules/editor-server/contracts.ts`, `src/modules/editor-server/timing.ts`

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
