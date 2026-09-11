# A19: A `visual-timeline` module owns two schemas per story: immutable generation records under `data/stories/<story>/shots/` and a `decisions.json` overlay beside them.

**Status.** Standing.

**Decision.** A `visual-timeline` module owns two schemas per story: immutable generation records under `data/stories/<story>/shots/` and a `decisions.json` overlay beside them. Both pin the clip's audio and transcript hashes. The editor is a client of this module, not the owner of the format.

**Why.** Separates immutable evidence from editable choices, matching A12, and lets any script produce records.

**Cited by.** `packages/domain/src/shots.ts`

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
