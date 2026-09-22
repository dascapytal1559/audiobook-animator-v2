# A63: The editor is one page of collapsible sections; the story map is the Scenes and Cast & world sections.

**Status.** Standing (2026-09-22; sections re-cut around scenes 2026-09-23). Requested by the user: combine the Timeline and Explorer views into one page, then re-cut the story map section around scenes.

**Decision.** The editor has no views. Under the header the page stacks, top to bottom: a **Video** section holding the preview and its subtitles, a **Scenes** section, a **Cast & world** section, the transport, and the timeline lanes. Each of the three sections collapses to its heading row and expands again from a control on that row, and its body is dragged to a height by the handle on its bottom edge; whether each is minimized, and how tall it is, are browser view preferences, remembered per browser like the subtitle toggles and the column splits, never part of the story. Video and Scenes open expanded at first; Cast & world opens minimized, since it is there to be tucked away. The transport and lanes are always visible; a section may grow only as far as leaves the lanes their floor, and when the open sections and that floor exceed the window, the page scrolls.

The **Scenes** section is the story map (A62) seen as scenes. Its left column is the structure: acts, chapters, scenes, and beats in narration order, indented by depth, the chain under the playhead highlighted and opened, each leaf able to unfold its transcript passage. Its right column is the detail of one scene: its heading and times, its summary, the subjects it mentions, what it looks like, and its transcript passage with click-to-seek words. Clicking a section's title seeks the playhead to it and pins its detail; until a click, and again after the pin is closed, the detail follows the innermost section under the playhead. What the scene looks like is a description and an image. This decision lays out their places and labels them not generated yet; which model writes them, and where the result is kept, is a later decision, and until then the places stay empty rather than hidden.

The **Cast & world** section is the same map seen as subjects: the characters, locations, objects, and motifs grouped by kind with their first image on the left, and the selected subject's detail (description, images, the sections it appears in, every mention) on the right, each mention seeking the playhead. A subject chip on a scene row opens that subject here, expanding the section if it is minimized. The divider between the two columns of each section drags; each split is a browser view preference.

One audio element and one playhead serve the whole page, so a seek in any section moves the same playhead.

The header's view switch is gone, and with it the `view` URL parameter. A link still carries `story`, `track`, and `at`; an old link with `view=explorer` opens the same page, the parameter ignored.

**Naming.** The user-facing names are "Scenes" and "Cast & world"; "World map" and "explorer" are retired. The code has `Scenes` and `Cast` components and preference keys named for them. A layout saved under the World map name is carried across: the section flags and heights read the old `worldMap` field as `scenes`, and the Scenes column split reads the explorer's old key until the first drag writes its own.

**Why.** The two views showed the same story at the same playhead but never together: reading the structure meant losing the picture and the lanes. Stacked sections that fold away keep everything one glance apart and let each user choose how much of the window each part takes.

**Supersedes.** The "Explorer" paragraph of A62, where the explorer was a second view carried in the URL, and this decision's own first cut, where the map was one World map section with the cast beside the structure.

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md).
