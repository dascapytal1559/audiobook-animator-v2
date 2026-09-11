# AGENTS.md

Directives for agents in this repository. Humans read README.md. The human roadmap is HUMAN.md.
Project context, glossary, decisions, and backlog are in CONTEXT.md. Use its terms.
This file has authority over defaults. Only the human edits it.

## Start of session
1. Run `pnpm check`, then `pnpm --silent run cli status`.
2. Read the map in README.md and the backlog in CONTEXT.md.
3. Run `scripts/editor-dev.sh status`. The dev servers are the user's workspace.
4. Run `git status`. Uncommitted work is the user's; do not refactor over it without asking.

## Hard rules
- Defaults live in code. A config is a record of one run, kept beside its output. No settings files exist; `config/` does not come back.
- Every tool names its story: `--story <id>`, the folder name under `data/stories/`. No tool has a default story. Only the browser remembers one.
- Settings go in a `--run` file; request flags such as `--from`, `--to`, or `--mode` stay on the command line. Every file a tool writes carries the parameters that produced it.
- Never write story audio, `audio/manifest.json`, split evidence under `data/books/`, or the identity fields of `story.json`. They are hash-pinned evidence.
- `transcript.json` and `transcript.txt` are written only by `animator transcription promote`. Nothing else edits them.
- Two writers, two files. Scripts write `shots/<ulid>/record.json` and `word-timing.auto.json`. The editor or a CLI verb writes `decisions.json` and `word-timing.json`.
- Never overwrite a shot record. Mint a new ULID.
- Manage the dev servers only through `scripts/editor-dev.sh start|restart|stop|status`. Never signal them by hand. If you change the server's launch arguments, the launcher cannot see the process it started before; stop it through the launcher before the change. Restart after promoting a transcript.
- `data/` is local-only and not in git. Evidence cited in the documents exists only on this machine.
- Intake (`src/intake/`) is frozen: mechanical whole-repo changes only, no new features. A new book may need bespoke handling; see CONTEXT.md.
- Do not commit or push unless asked. One kind of change per commit. `pnpm check` green before each.
- Tell the user every decision you make on their behalf. Silent decisions are your fault later.
- Elegance beats backward compatibility. Delete, do not alias. Say so when you do.

## Conventions the code follows
- One `contracts.ts` per module holds its Effect Schemas and its `defaults`. The schema is the contract; a CLI verb is a convenience.
- Shapes and pure rules shared with the browser live in `packages/domain`. Never hand-copy a type into the client; the client validates every response with the same schema the server wrote it with.
- Shared primitives come from `@animator/domain`; Node-side io comes from `src/core/io.ts`. Never declare a local `Path`, `Positive`, `Sha256`, or similar.
- One error class, `AnimatorError` in `src/core/error.ts`, carrying `module` and `code`. Each story-level module uses its typed constructor and guard (`storyError`, `isStoryError`, and so on). Errors name the file and the rule that failed.
- Cite the decision ID in JSDoc when code implements one, for example `(A51)`. Each ID resolves to a file under `docs/decisions/`. Record a new decision there and in the CONTEXT.md index.
- Reads are bounded; writes go through a temp file and rename.
- Time is integer samples on the clip clock, zero at clip start. Seconds are for display only.
- Every artifact that belongs to a story carries the `ClipIdentity` and is rejected on mismatch.
- Operations take decoded values, never file paths to settings. The command tree (`src/commands/`) resolves `--story` and `--run` into values, once.
- Prefer a pure function with a test over logic inside a route or verb. Tests are colocated `*.test.ts`.
- Evidence and interpretation stay separate. Report facts; never write a "ready" or "percent done" field.

## Commands
- `pnpm check`: domain tests, root build and tests, editor tests and typecheck, in dependency order.
- `pnpm run cli --help`: the whole command tree. Usage and errors on stderr, JSON on stdout.
- `scripts/editor-dev.sh`: the dev servers, launched with code defaults. Logs in `.dev/`.
- Client without the real server: `EDITOR_API_PORT=63621 pnpm --filter editor dev` with `node packages/editor/mock/server.mjs`.
- Story transcription is Python under `scripts/`; `animator transcription --help` lists the steps but does not run them.

## Gotchas
- `redis` is pinned only to satisfy a peer dependency. Nothing uses it.
- The `animator` symlink is the legacy project. Reference only; never build or edit it.
- `skipLibCheck` is on because of an Effect RC declaration bug. Application code stays strict.
- Boolean CLI flags need an explicit default; this CLI version otherwise treats them as required.
- `story.json` may carry per-story facts such as `chunking.minSentenceBreakMs`. Those are facts about the narration, not settings.
- The `/api/events` watcher test is flaky on this machine and fails on alternate runs. It is not a regression signal on its own.
