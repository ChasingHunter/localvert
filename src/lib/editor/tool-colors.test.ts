import { describe, expect, it } from "vitest";
import { colorForTool, DEFAULT_TOOL_COLORS, setToolColor } from "./tool-colors";

describe("colorForTool", () => {
  it("returns each tool's own remembered default", () => {
    expect(colorForTool(DEFAULT_TOOL_COLORS, "highlight")).toBe("#ffd400");
    expect(colorForTool(DEFAULT_TOOL_COLORS, "freeText")).toBe("#000000");
  });

  it("falls back for no active tool or an unrecognized id", () => {
    expect(colorForTool(DEFAULT_TOOL_COLORS, null)).toBe("#000000");
    expect(colorForTool(DEFAULT_TOOL_COLORS, "stamp")).toBe("#000000");
  });
});

describe("setToolColor", () => {
  it("updates only the given tool's default", () => {
    const next = setToolColor(DEFAULT_TOOL_COLORS, "freeText", "#ff0000");
    expect(colorForTool(next, "freeText")).toBe("#ff0000");
    // Every other tool's default is untouched -- this was the actual bug:
    // one shared `color` state meant changing FreeText's colour also changed
    // Highlight's.
    expect(colorForTool(next, "highlight")).toBe("#ffd400");
  });

  it("never mutates the input map", () => {
    const original = { ...DEFAULT_TOOL_COLORS };
    setToolColor(DEFAULT_TOOL_COLORS, "ink", "#00ff00");
    expect(DEFAULT_TOOL_COLORS).toEqual(original);
  });
});
