/**
 * Word selection in the Edited row (A38): a contiguous range, client-only. An item is one word or one sentence, held as the ids of its
 * first and last word; the range is everything between the anchor item and the focus item in row order. Ids rather than indices so a
 * story refetch cannot silently shift the selection onto different words.
 */

export type SelectionItem = { readonly first: string; readonly last: string };
export type Selection = { readonly anchor: SelectionItem; readonly focus: SelectionItem };
export type IndexRange = { readonly first: number; readonly last: number };

/** Click selects the item; shift-click keeps the anchor and moves the focus. */
export function selectItem(selection: Selection | null, item: SelectionItem, extend: boolean): Selection {
  if (extend && selection !== null) return { anchor: selection.anchor, focus: item };
  return { anchor: item, focus: item };
}

/** Inclusive index range of the selection in `order` (word ids in row order), or null when any of its words is gone. */
export function selectedRange(order: ReadonlyArray<string>, selection: Selection | null): IndexRange | null {
  if (selection === null) return null;
  const index = new Map(order.map((id, i) => [id, i]));
  const positions = [selection.anchor.first, selection.anchor.last, selection.focus.first, selection.focus.last].map(id => index.get(id));
  if (positions.some(p => p === undefined)) return null;
  const known = positions as number[];
  return { first: Math.min(...known), last: Math.max(...known) };
}

export function selectedIds(order: ReadonlyArray<string>, selection: Selection | null): ReadonlySet<string> {
  const range = selectedRange(order, selection);
  return range === null ? new Set() : new Set(order.slice(range.first, range.last + 1));
}
