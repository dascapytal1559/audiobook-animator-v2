# A27: The editor server is a thin Effect HTTP layer in the root package over module operations.

**Status.** Standing, and since 2026-09-11 true for the browser client too: the shapes and pure rules the client needs live in `packages/domain` beside the server's (see A58).

**Decision.** The editor server is a thin Effect HTTP layer in the root package over module operations. Later frontend generation features call the same operations the CLIs use.

**Why.** Nothing is implemented twice.

**Cited by.** not cited in code.

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
