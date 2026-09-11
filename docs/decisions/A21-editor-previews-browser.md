# A21: The editor previews in the browser.

**Status.** Standing.

**Decision.** The editor previews in the browser. A separate CLI renders the film from the timeline with FFmpeg. The editor never shells out to FFmpeg for the film.

**Why.** Keeps the editor responsive and the render reproducible.

**Cited by.** not cited in code.

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
