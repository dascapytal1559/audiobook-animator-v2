# A26: Files are the only channel between scripts and the frontend.

**Status.** Standing.

**Decision.** Files are the only channel between scripts and the frontend. The editor server watches the story folder and pushes changes to the browser over server-sent events. No queue, database, or socket protocol.

**Why.** A script that finishes writing a file is immediately visible without coordination.

**Cited by.** not cited in code.

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
