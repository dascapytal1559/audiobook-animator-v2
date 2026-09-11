# A56: The editor server opens every story directory under the stories directory (`data/stories/` unless a run file overrides it) and lists them at `GET /api/stories`; each story's routes live under `/api/stories/<story-id>/`.

**Status.** Amended 2026-09-11. The stories directory is a run setting (`data/stories/` by default), the server has no default story, and every story is verified on its first open.

**Decision.** The editor server opens every story directory under the stories directory (`data/stories/` unless a run file overrides it) and lists them at `GET /api/stories`; each story's routes live under `/api/stories/<story-id>/`. The story config's story stays the default (A18) and is verified before the server listens; other stories are verified on first open and kept for the process lifetime. The client shows a story selector in the header, keeps the open story in the URL as `?story=<id>`, and remounts the editor on a switch so no state leaks between clips.

**Why.** Switching stories no longer needs a config edit and a restart (A18 still holds: one story open at a time, chosen by id). Explicit directory configuration over inference from the default story's parent. Lazy verification keeps start-up as fast as one story while the listing needs only the manifests.

**Cited by.** not cited in code.

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
