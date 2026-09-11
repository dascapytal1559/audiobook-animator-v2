# A59: Intake produces stories; everything else consumes them, and the story manifest is the boundary.

**Status.** Standing (2026-09-11).

**Decision.** The book-level modules (source inspection, whole-book transcription, story audio, story split) live under `src/intake/` and are frozen: they get only the mechanical changes whole-repo steps require. Anything that produces a valid `data/stories/<id>/` with a `story.json` is a legitimate intake, bespoke or not. Modules under `src/modules/` verify the manifest and never ask how the story came to exist.

**Why.** Books are massaged into stories once and rarely touched again; future books may need bespoke handling. The story is the unit of all creative work (the user's framing, 2026-09-11).

**Cited by.** `docs/reviews/2026-09-09-agent-ergonomics-review.md`.

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md).
