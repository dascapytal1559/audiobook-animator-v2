# A30: Each generation record is a directory `shots/<shot-id>/` with `record.json` and its image beside it.

**Status.** Standing.

**Decision.** Each generation record is a directory `shots/<shot-id>/` with `record.json` and its image beside it. The record holds `startSample`, `mode`, `prompt`, relative `imagePath`, `createdAt`, `producer`, and `notes`. Shot IDs are ULIDs.

**Why.** Any script can mint an ID and write a record without coordination.

**Cited by.** `packages/domain/src/shots.ts`

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
