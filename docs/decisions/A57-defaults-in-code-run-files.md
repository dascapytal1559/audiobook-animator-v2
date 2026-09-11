# A57: Defaults live in code; a config is a record of one run, kept beside its output.

**Status.** Standing (2026-09-11).

**Decision.** Every module declares its defaults in its `contracts.ts` (`storyDefaults`, `visualTimelineDefaults`, `editorDefaults`, `storyInventoryDefaults`, `transcriptionDefaults`). A tool takes `--story <id>` and an optional `--run <file>`; flags never carry parameters. The run file is a JSON object with any subset of the settings sections, laid over the defaults and then checked strictly. Every writer records the complete effective parameters beside its output; nothing about parameters is tracked in git. There is no settings folder and no default story. The whole command surface is one tree, `animator <module> <verb>`, and `animator status` reports the facts of every story.

**Why.** The user changes what they work on at will and wants provenance tied to outputs, so standing settings and ambient defaults were the wrong shape. This overrides the earlier explicit-config rule for this project (agreed 2026-09-11).

**Cited by.** `docs/reviews/2026-09-09-agent-ergonomics-review.md`.

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md).
