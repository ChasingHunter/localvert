import { describe, expect, it } from "vitest";
import {
  applyAspectRatio,
  clampRect,
  displayToSource,
  initialCrop,
  moveRect,
  resizeRect,
  roundRect,
  sourceToDisplay,
} from "./crop-geometry";

const BOUNDS = { width: 200, height: 100 };

describe("clampRect", () => {
  it("passes through a rect already inside bounds", () => {
    expect(clampRect({ x: 10, y: 10, width: 50, height: 50 }, BOUNDS)).toEqual({
      x: 10,
      y: 10,
      width: 50,
      height: 50,
    });
  });

  it("pulls a negative origin back to 0", () => {
    expect(clampRect({ x: -20, y: -5, width: 50, height: 50 }, BOUNDS)).toEqual(
      {
        x: 0,
        y: 0,
        width: 50,
        height: 50,
      },
    );
  });

  it("pulls an origin back so the rect stays inside the right/bottom edge", () => {
    expect(clampRect({ x: 190, y: 90, width: 50, height: 50 }, BOUNDS)).toEqual(
      {
        x: 150,
        y: 50,
        width: 50,
        height: 50,
      },
    );
  });

  it("shrinks a rect wider than bounds instead of pushing it negative", () => {
    expect(clampRect({ x: 0, y: 0, width: 500, height: 500 }, BOUNDS)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
  });

  it("never returns a dimension below minSize", () => {
    const result = clampRect({ x: 0, y: 0, width: 0, height: -5 }, BOUNDS, 2);
    expect(result.width).toBeGreaterThanOrEqual(2);
    expect(result.height).toBeGreaterThanOrEqual(2);
  });
});

describe("moveRect", () => {
  it("translates by dx/dy", () => {
    expect(
      moveRect({ x: 10, y: 10, width: 20, height: 20 }, 5, -3, BOUNDS),
    ).toEqual({ x: 15, y: 7, width: 20, height: 20 });
  });

  it("clamps so a move can't push the rect out of bounds", () => {
    const result = moveRect(
      { x: 180, y: 80, width: 20, height: 20 },
      50,
      50,
      BOUNDS,
    );
    expect(result.x).toBe(180);
    expect(result.y).toBe(80);
  });
});

describe("resizeRect", () => {
  const rect = { x: 20, y: 20, width: 40, height: 40 };

  it("dragging the se handle grows width/height, keeps the nw corner fixed", () => {
    const result = resizeRect(rect, "se", 10, 5, BOUNDS);
    expect(result).toEqual({ x: 20, y: 20, width: 50, height: 45 });
  });

  it("dragging the nw handle moves x/y and shrinks toward the se corner", () => {
    const result = resizeRect(rect, "nw", 10, 5, BOUNDS);
    expect(result).toEqual({ x: 30, y: 25, width: 30, height: 35 });
  });

  it("dragging the ne handle keeps the sw corner (x, bottom edge) fixed", () => {
    const result = resizeRect(rect, "ne", 10, -5, BOUNDS);
    expect(result.x).toBe(20);
    expect(result.y + result.height).toBe(60);
    expect(result.width).toBe(50);
    expect(result.height).toBe(45);
  });

  it("locks the aspect ratio when one is given", () => {
    const result = resizeRect(rect, "se", 20, 4, BOUNDS, 1);
    expect(result.width).toBe(result.height);
  });

  it("never resizes below minSize", () => {
    // -38/-38 shrinks the 40x40 rect toward (but not past) its own nw
    // anchor corner — a delta large enough to cross it would flip the rect
    // instead of shrinking it, which is a separate (untested) case.
    const result = resizeRect(rect, "se", -38, -38, BOUNDS, null, 5);
    expect(result.width).toBeGreaterThanOrEqual(5);
    expect(result.height).toBeGreaterThanOrEqual(5);
  });

  it("clamps the result to bounds", () => {
    const result = resizeRect(rect, "se", 1000, 1000, BOUNDS);
    expect(result.x + result.width).toBeLessThanOrEqual(BOUNDS.width);
    expect(result.y + result.height).toBeLessThanOrEqual(BOUNDS.height);
  });
});

describe("applyAspectRatio", () => {
  it("returns the rect unchanged for Free (null)", () => {
    const rect = { x: 5, y: 5, width: 40, height: 20 };
    expect(applyAspectRatio(rect, null, BOUNDS)).toEqual(rect);
  });

  it("shrinks width to hit a taller ratio, keeping the center fixed", () => {
    const rect = { x: 0, y: 0, width: 40, height: 20 }; // 2:1, center (20, 10)
    const result = applyAspectRatio(rect, 1, BOUNDS); // -> 1:1
    expect(result.width).toBe(result.height);
    expect(result.x + result.width / 2).toBeCloseTo(20);
    expect(result.y + result.height / 2).toBeCloseTo(10);
  });

  it("stays within bounds after refitting", () => {
    const rect = { x: 0, y: 0, width: 200, height: 10 };
    const result = applyAspectRatio(rect, 16 / 9, BOUNDS);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.x + result.width).toBeLessThanOrEqual(BOUNDS.width);
    expect(result.y + result.height).toBeLessThanOrEqual(BOUNDS.height);
  });
});

describe("displayToSource / sourceToDisplay", () => {
  const displaySize = { width: 100, height: 50 };
  const sourceSize = { width: 400, height: 200 }; // 4x scale on both axes

  it("scales a display rect up to source pixels", () => {
    expect(
      displayToSource(
        { x: 10, y: 5, width: 20, height: 10 },
        displaySize,
        sourceSize,
      ),
    ).toEqual({ x: 40, y: 20, width: 80, height: 40 });
  });

  it("scales a source rect down to display pixels", () => {
    expect(
      sourceToDisplay(
        { x: 40, y: 20, width: 80, height: 40 },
        sourceSize,
        displaySize,
      ),
    ).toEqual({ x: 10, y: 5, width: 20, height: 10 });
  });

  it("round-trips display -> source -> display", () => {
    const original = { x: 12, y: 8, width: 30, height: 15 };
    const roundTripped = sourceToDisplay(
      displayToSource(original, displaySize, sourceSize),
      sourceSize,
      displaySize,
    );
    expect(roundTripped.x).toBeCloseTo(original.x);
    expect(roundTripped.y).toBeCloseTo(original.y);
    expect(roundTripped.width).toBeCloseTo(original.width);
    expect(roundTripped.height).toBeCloseTo(original.height);
  });
});

describe("roundRect", () => {
  it("rounds every field to the nearest integer", () => {
    expect(roundRect({ x: 1.4, y: 1.5, width: 9.49, height: 9.5 })).toEqual({
      x: 1,
      y: 2,
      width: 9,
      height: 10,
    });
  });
});

describe("initialCrop", () => {
  it("insets by the given fraction on every edge, centered", () => {
    const result = initialCrop({ width: 100, height: 50 }, 0.1);
    expect(result).toEqual({ x: 10, y: 5, width: 80, height: 40 });
  });

  it("defaults to a 10% inset", () => {
    const result = initialCrop({ width: 200, height: 200 });
    expect(result).toEqual({ x: 20, y: 20, width: 160, height: 160 });
  });
});
