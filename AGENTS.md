# Working in animator-v2

- Communicate in plain language. Make implementation decisions visible to the user.
- Only a human may edit `GLOBAL_AGENTS.md`; agents may suggest changes.
- `PIPELINE.md` is the shared working document for the user and lead agent. Keep confirmed decisions, assumptions, open questions, and the implementation backlog distinct.
- The lead agent manages alignment and delegates implementation to agents. Assess ready backlog modules each turn, and continue implementation on settled work while alignment continues elsewhere.
- Prefer explicit configuration. Point out correctness problems and opportunities to simplify the design.
- Store original book audio and raw provider exports under `data/books/<book>/input/`; use `data/inbox/` for unclassified downloads. Keep generated artifacts in their existing book directories.
- When an input moves, verify its content identity and update the current source locator. Preserve completed run evidence and its historical paths.
- Treat `AGENTS.md` as the source of agent instructions. `CLAUDE.md` must be a symlink to it. Keep `README.md` for human-facing project documentation.

## Legacy project

`animator` is a symlink to `/Users/zerongwang/Projects/animator`.
Before working in that repository, read `/Users/zerongwang/Projects/animator/AGENTS.md` if it exists, and any instructions in the relevant subtree. No legacy root `AGENTS.md` existed during initial inspection on 2026-09-05.
For the initial alignment, inspect the legacy project and its source assets without modifying them.

## Secrets

- Keys that directly control more than $100 must be encrypted at rest and must not be committed.
- Do not commit secrets to a public repository. The user permits secrets in a private repository subject to the money-control rule above.
