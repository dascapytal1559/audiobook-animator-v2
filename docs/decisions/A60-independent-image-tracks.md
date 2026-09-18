# A60: Image tracks are independent sequences over one story's narration.

**Status.** Standing (2026-09-11).

**Decision.** An immutable shot may name a lowercase `trackId`; an absent id means `main`, so existing records need no rewrite. Candidate selection and hold stitching happen within a track, and every effective shot, group, and gap carries its resolved track id. The editor draws each track separately and previews one at a time. `source-screenshot` identifies a frame extracted from existing footage without claiming it was generated.

**Why.** The user requested independent Claude, Codex, and Grok screenshot drafts over the same narration, plus an immediate random proof. Competing drafts must be browsable side by side without replacing the existing sequence or clearing each other's selections when they use the same sentence. Track membership belongs to the original draft record; timing, word anchors, selections, and notes remain in the existing per-shot decisions overlay.

Browser view links use `?story=<id>&track=<track-id>&at=<clip-seconds>`. They select a preview and position without modifying narration, timing, or saved decisions. Old single-sequence behavior is the `main` track, not a second merge implementation.

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md).
