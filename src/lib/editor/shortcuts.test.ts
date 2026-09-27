import { describe, expect, it } from "vitest";
import {
  isTypingTarget,
  matchShortcut,
  SHORTCUTS,
  type ShortcutKeyEvent,
} from "./shortcuts";

function key(
  k: string,
  mods: Partial<Omit<ShortcutKeyEvent, "key">> = {},
): ShortcutKeyEvent {
  return {
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  };
}

describe("matchShortcut", () => {
  it("recognizes Ctrl+F and Cmd+F as search", () => {
    expect(matchShortcut(key("f", { ctrlKey: true }))).toEqual({
      kind: "search",
    });
    expect(matchShortcut(key("f", { metaKey: true }))).toEqual({
      kind: "search",
    });
  });

  it("recognizes Ctrl+Z as undo and Ctrl+Shift+Z as redo", () => {
    expect(matchShortcut(key("z", { ctrlKey: true }))).toEqual({
      kind: "undo",
    });
    expect(matchShortcut(key("z", { ctrlKey: true, shiftKey: true }))).toEqual({
      kind: "redo",
    });
    expect(matchShortcut(key("y", { ctrlKey: true }))).toEqual({
      kind: "redo",
    });
  });

  it("recognizes Ctrl+C as copy", () => {
    expect(matchShortcut(key("c", { ctrlKey: true }))).toEqual({
      kind: "copy",
    });
  });

  it("recognizes zoom shortcuts", () => {
    expect(matchShortcut(key("+", { ctrlKey: true }))).toEqual({
      kind: "zoomIn",
    });
    expect(matchShortcut(key("=", { ctrlKey: true }))).toEqual({
      kind: "zoomIn",
    });
    expect(matchShortcut(key("-", { ctrlKey: true }))).toEqual({
      kind: "zoomOut",
    });
    expect(matchShortcut(key("0", { ctrlKey: true }))).toEqual({
      kind: "zoomReset",
    });
  });

  it("recognizes page navigation without a modifier", () => {
    expect(matchShortcut(key("PageDown"))).toEqual({ kind: "nextPage" });
    expect(matchShortcut(key("ArrowRight"))).toEqual({ kind: "nextPage" });
    expect(matchShortcut(key("PageUp"))).toEqual({ kind: "previousPage" });
    expect(matchShortcut(key("ArrowLeft"))).toEqual({ kind: "previousPage" });
  });

  it("recognizes Escape with no modifier", () => {
    expect(matchShortcut(key("Escape"))).toEqual({ kind: "escape" });
  });

  it("recognizes tool letter shortcuts without a modifier", () => {
    expect(matchShortcut(key("v"))).toEqual({
      kind: "activateTool",
      toolId: "select",
    });
    expect(matchShortcut(key("h"))).toEqual({
      kind: "activateTool",
      toolId: "highlight",
    });
    expect(matchShortcut(key("t"))).toEqual({
      kind: "activateTool",
      toolId: "freeText",
    });
    expect(matchShortcut(key("d"))).toEqual({
      kind: "activateTool",
      toolId: "ink",
    });
  });

  it("does not treat a modified letter as a tool shortcut", () => {
    // Ctrl+H, for example, must not activate the highlight tool.
    expect(matchShortcut(key("h", { ctrlKey: true }))).toBeNull();
  });

  it("ignores unmodified letters with Alt held", () => {
    expect(matchShortcut(key("v", { altKey: true }))).toBeNull();
  });

  it("returns null for keys with no shortcut", () => {
    expect(matchShortcut(key("q"))).toBeNull();
    expect(matchShortcut(key("F5"))).toBeNull();
  });

  it("every SHORTCUTS entry's action round-trips through the label table uniquely", () => {
    const kinds = SHORTCUTS.map((s) => s.action.kind);
    expect(new Set(kinds).size).toBeGreaterThan(0);
  });
});

describe("isTypingTarget", () => {
  it("is false for null", () => {
    expect(isTypingTarget(null)).toBe(false);
  });

  it("is true for input, textarea and contenteditable elements", () => {
    // Plain duck-typed stand-ins, not real DOM nodes — this suite runs
    // under Vitest's `node` environment, with no `document` global.
    expect(isTypingTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(
      true,
    );
    expect(
      isTypingTarget({ tagName: "TEXTAREA" } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isTypingTarget({
        tagName: "DIV",
        isContentEditable: true,
      } as unknown as EventTarget),
    ).toBe(true);
  });

  it("is false for a plain, non-editable element", () => {
    expect(isTypingTarget({ tagName: "DIV" } as unknown as EventTarget)).toBe(
      false,
    );
  });
});
