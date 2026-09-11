# A28: The React client is a new `packages/editor` workspace package with exactly pinned Vite and React.

**Status.** Standing.

**Decision.** The React client is a new `packages/editor` workspace package with exactly pinned Vite and React. Vite serves the client in development and proxies to the Effect server; the production build is static files served by the same Effect server.

**Why.** Keeps pipeline modules framework-free.

**Cited by.** not cited in code.

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
