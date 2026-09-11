# A18: The editor opens exactly one verified story segment at a time, chosen by book and story ID, with The Great Silence as the default.

**Status.** Amended 2026-09-11. There is no default story any more: every tool takes `--story <id>` and the browser remembers the last story it showed. The part that stands: the editor opens exactly one verified story at a time and never an arbitrary audio file.

**Decision.** The editor opens exactly one verified story segment at a time, chosen by book and story ID, with The Great Silence as the default. It never opens arbitrary audio files.

**Why.** Every timeline stays tied to a verified clip identity.

**Cited by.** `packages/editor/src/api.ts`

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
