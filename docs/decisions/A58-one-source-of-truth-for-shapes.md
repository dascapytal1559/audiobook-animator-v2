# A58: Shapes and pure rules shared by server and client live once, in `packages/domain`.

**Status.** Standing (2026-09-11).

**Decision.** The Effect schemas for clip identity, records, decisions, overlays, caches, and every wire shape, plus the pure rules (timeline merge, chunking over elements, effective timing, align and measure, time conversions, ULID encoding) are in `packages/domain`. The server types its payloads against those schemas and the client decodes every response with them strictly, reporting a `SchemaMismatch` instead of rendering a shape it did not expect. The merge returns its problems rather than failing, so the server can refuse and the client can ignore. `src/core/` keeps only the Node-side io.

**Why.** The client had hand-copied types and two re-implemented rules, and had drifted from the server in the align report and in chunking. One source removes the class of bug (agreed 2026-09-11).

**Cited by.** `docs/reviews/2026-09-09-agent-ergonomics-review.md`.

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md).
