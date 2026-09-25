/**
 * Pure reordering helpers for `FileOrderList` (ADR-0008's many-to-one
 * dropzone flow, e.g. merge-pdf) — kept separate from the component so the
 * actual array math is unit-testable without React or pointer events. Every
 * function returns a **new** array; none mutate `items`.
 */

/** Swaps `index` with `index - 1`. No-op (returns `items` unchanged, same
 * reference) if `index` is already first or out of bounds. */
export function moveUp<T>(items: readonly T[], index: number): T[] {
  return swap(items, index, index - 1);
}

/** Swaps `index` with `index + 1`. No-op if `index` is already last or out
 * of bounds. */
export function moveDown<T>(items: readonly T[], index: number): T[] {
  return swap(items, index, index + 1);
}

function swap<T>(items: readonly T[], a: number, b: number): T[] {
  if (a < 0 || a >= items.length || b < 0 || b >= items.length) {
    return items as T[];
  }
  const next = items.slice();
  const itemA = next[a] as T;
  const itemB = next[b] as T;
  next[a] = itemB;
  next[b] = itemA;
  return next;
}

/** Removes the item at `index`. No-op if `index` is out of bounds. */
export function removeAt<T>(items: readonly T[], index: number): T[] {
  if (index < 0 || index >= items.length) return items as T[];
  const next = items.slice();
  next.splice(index, 1);
  return next;
}

/**
 * Moves the item at `from` to sit at `to`, shifting everything between them
 * — the drag-and-drop primitive `FileOrderList`'s pointer handlers call as
 * the dragged item passes over each other row. No-op if either index is out
 * of bounds or they're equal.
 */
export function reorder<T>(items: readonly T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    from >= items.length ||
    to < 0 ||
    to >= items.length
  ) {
    return items as T[];
  }
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return items as T[]; // unreachable: from is in bounds
  next.splice(to, 0, moved);
  return next;
}
