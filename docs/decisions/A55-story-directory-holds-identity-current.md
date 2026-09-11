# A55: A story is a directory: `data/stories/<story-id>/` holds `story.json` (identity, current file locators, origin, and the editable synopsis), the verified `audio/` and transcript pair, planning documents, `shots/`, `decisions.json`, timing overlays, and caches.

**Status.** Standing. The `data/books/<book>/split/segments/` folder still holds the extras after the stories moved out; it is hash-pinned split evidence, so it keeps its name.

**Decision.** A story is a directory: `data/stories/<story-id>/` holds `story.json` (identity, current file locators, origin, and the editable synopsis), the verified `audio/` and transcript pair, planning documents, `shots/`, `decisions.json`, timing overlays, and caches. `data/books/<book>/` is the pre-treated input and book-level processing: originals, imports, the split plan and its acceptance inventory, and the extras. Story ids are unique across books. Configs select a story by its directory; the manifest is verified against the linked files on every load, and the split inventory is retained as origin evidence, not reopened.

**Why.** Stories are the unit of creative work, so everything about one story lives in one place and any script can find it by id. The split inventory stays an unchanged acceptance artifact; the manifest is the current locator, as A11 separates location from identity for inputs.

**Cited by.** not cited in code.

Recorded in the decision index of [CONTEXT.md](../../CONTEXT.md); earlier rounds and evidence are in [docs/history](../history/).
