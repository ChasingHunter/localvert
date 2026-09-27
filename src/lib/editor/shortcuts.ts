/**
 * Slice E6a — the editor's keyboard shortcut table, as a pure function: a
 * `KeyboardEvent` (or the small subset of its fields this needs) in, an
 * `EditorAction` out (or `null` for "not a shortcut"). Kept pure and free of
 * React/DOM so it's unit-testable without a browser, and so
 * `pdf-editor-app.tsx`'s one `keydown` listener and the "Keyboard shortcuts"
 * help popover can both read from the same source of truth (`SHORTCUTS`
 * below) instead of the table drifting out of sync with what's actually
 * wired up.
 */

/** Every action a keyboard shortcut can trigger. Deliberately a flat union,
 * not tool ids straight from `ANNOTATION_TOOLS` (`pdf-editor-app.tsx`) —
 * `activateTool` carries its own id instead, so this module has zero
 * dependency on that toolbar's specific tool list. */
export type EditorAction =
  | { kind: "search" }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "copy" }
  | { kind: "zoomIn" }
  | { kind: "zoomOut" }
  | { kind: "zoomReset" }
  | { kind: "nextPage" }
  | { kind: "previousPage" }
  | { kind: "escape" }
  | {
      kind: "activateTool";
      toolId: "select" | "highlight" | "freeText" | "ink";
    };

/** The minimal shape this module reads off a `KeyboardEvent` — lets tests
 * build plain objects instead of constructing a real event. */
export interface ShortcutKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** One row of the shortcut table: the description shown in the help
 * popover, plus the platform-neutral key label ("Ctrl/Cmd+F") and the
 * predicate that recognizes it. `mod` stands for "Ctrl on
 * Windows/Linux, Cmd on macOS" — both are accepted on every platform rather
 * than detecting the OS, same as the pre-existing undo/redo handler this
 * table replaces. */
export interface ShortcutEntry {
  action: EditorAction;
  label: string;
  keys: string;
}

function isMod(e: ShortcutKeyEvent): boolean {
  return e.ctrlKey || e.metaKey;
}

/** The single source of truth for both dispatch (`matchShortcut`) and the
 * help popover's listing. Order here is the order shown in the popover. */
export const SHORTCUTS: ShortcutEntry[] = [
  { action: { kind: "search" }, label: "Find in document", keys: "Ctrl/Cmd+F" },
  { action: { kind: "undo" }, label: "Undo", keys: "Ctrl/Cmd+Z" },
  { action: { kind: "redo" }, label: "Redo", keys: "Ctrl/Cmd+Shift+Z" },
  { action: { kind: "copy" }, label: "Copy selected text", keys: "Ctrl/Cmd+C" },
  { action: { kind: "zoomIn" }, label: "Zoom in", keys: "Ctrl/Cmd++" },
  { action: { kind: "zoomOut" }, label: "Zoom out", keys: "Ctrl/Cmd+-" },
  { action: { kind: "zoomReset" }, label: "Fit width", keys: "Ctrl/Cmd+0" },
  {
    action: { kind: "previousPage" },
    label: "Previous page",
    keys: "PageUp / ←",
  },
  { action: { kind: "nextPage" }, label: "Next page", keys: "PageDown / →" },
  {
    action: { kind: "escape" },
    label: "Deactivate tool / close",
    keys: "Escape",
  },
  {
    action: { kind: "activateTool", toolId: "select" },
    label: "Select tool",
    keys: "V",
  },
  {
    action: { kind: "activateTool", toolId: "highlight" },
    label: "Highlight tool",
    keys: "H",
  },
  {
    action: { kind: "activateTool", toolId: "freeText" },
    label: "Add text tool",
    keys: "T",
  },
  {
    action: { kind: "activateTool", toolId: "ink" },
    label: "Draw tool",
    keys: "D",
  },
];

/** Maps a keyboard event to the `EditorAction` it triggers, or `null` if it
 * isn't a recognized shortcut. Callers are responsible for skipping this
 * while a text-entry target (input/textarea/contenteditable) is focused —
 * this function only knows about keys, not focus, so it stays a pure
 * key-in/action-out mapping. */
export function matchShortcut(e: ShortcutKeyEvent): EditorAction | null {
  const mod = isMod(e);
  const key = e.key.toLowerCase();

  if (mod && key === "f") return { kind: "search" };
  if (mod && key === "z" && e.shiftKey) return { kind: "redo" };
  if (mod && key === "z") return { kind: "undo" };
  if (mod && key === "y") return { kind: "redo" };
  if (mod && key === "c") return { kind: "copy" };
  if (mod && (e.key === "+" || e.key === "=")) return { kind: "zoomIn" };
  if (mod && e.key === "-") return { kind: "zoomOut" };
  if (mod && e.key === "0") return { kind: "zoomReset" };

  if (!mod && !e.altKey) {
    if (key === "escape") return { kind: "escape" };
    if (key === "pagedown" || key === "arrowright") return { kind: "nextPage" };
    if (key === "pageup" || key === "arrowleft")
      return { kind: "previousPage" };
    if (key === "v") return { kind: "activateTool", toolId: "select" };
    if (key === "h") return { kind: "activateTool", toolId: "highlight" };
    if (key === "t") return { kind: "activateTool", toolId: "freeText" };
    if (key === "d") return { kind: "activateTool", toolId: "ink" };
  }

  return null;
}

/** True if `target` is a text-entry element a global shortcut must not
 * hijack (typing "h" into a text field must never activate the Highlight
 * tool). Shared by the keydown handler and its unit tests. Duck-typed
 * (`tagName`/`isContentEditable`) rather than `instanceof HTMLElement` so
 * this module — and its unit tests, which run under Vitest's `node`
 * environment with no DOM globals — never needs one. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    !!el.isContentEditable
  );
}
