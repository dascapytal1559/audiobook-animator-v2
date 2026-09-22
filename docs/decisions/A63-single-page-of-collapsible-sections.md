# A63: The editor is one page of collapsible sections; the story map is the World map section.

**Status.** Standing (2026-09-22). Requested by the user: combine the Timeline and Explorer views into one page.

**Decision.** The editor has no views. Under the header the page stacks, top to bottom: a **Video** section holding the preview and its subtitles, a **World map** section holding what A62 called the explorer (structure, cast list, detail, and their draggable dividers), the transport, and the timeline lanes. The Video and World map sections each collapse to their heading row and expand again from a control on that row; whether each is minimized is a browser view preference, remembered per browser like the subtitle toggles and the explorer's splits, never part of the story. The transport and lanes are always visible. The World map section keeps a fixed share of the window so the lanes always have room; when the open sections and the lanes' floor exceed the window, the page scrolls.

One audio element and one playhead serve the whole page, so a seek in any section moves the same playhead.

The header's view switch is gone, and with it the `view` URL parameter. A link still carries `story`, `track`, and `at`; an old link with `view=explorer` opens the same page, the parameter ignored.

**Naming.** The user-facing name is "World map". The code keeps `Explorer` for the component, its file, its CSS classes, and its preference keys; renaming them is a later cleanup so this change stays a layout change.

**Why.** The two views showed the same story at the same playhead but never together: reading the structure meant losing the picture and the lanes. Stacked sections that fold away keep everything one glance apart and let each user choose how much of the window each part takes.

**Supersedes.** The "Explorer" paragraph of A62, where the explorer was a second view carried in the URL.

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md).
