import { describe, expect, it } from "vitest";
import { arrowKeyNudge } from "./nudge";

describe("arrowKeyNudge", () => {
  it("moves one point per press, in the arrow's direction", () => {
    expect(arrowKeyNudge("ArrowUp", false)).toEqual({ x: 0, y: -1 });
    expect(arrowKeyNudge("ArrowDown", false)).toEqual({ x: 0, y: 1 });
    expect(arrowKeyNudge("ArrowLeft", false)).toEqual({ x: -1, y: 0 });
    expect(arrowKeyNudge("ArrowRight", false)).toEqual({ x: 1, y: 0 });
  });

  it("moves ten points per press when Shift is held", () => {
    expect(arrowKeyNudge("ArrowUp", true)).toEqual({ x: 0, y: -10 });
    expect(arrowKeyNudge("ArrowRight", true)).toEqual({ x: 10, y: 0 });
  });

  it("returns null for any non-arrow key", () => {
    expect(arrowKeyNudge("Enter", false)).toBeNull();
    expect(arrowKeyNudge("a", true)).toBeNull();
  });
});
