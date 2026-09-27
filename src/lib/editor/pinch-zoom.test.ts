import { describe, expect, it } from "vitest";
import { pinchRatioToZoomDelta, pointerDistance } from "./pinch-zoom";

describe("pointerDistance", () => {
  it("measures the straight-line distance between two points", () => {
    expect(pointerDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("is zero for the same point", () => {
    expect(pointerDistance({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0);
  });
});

describe("pinchRatioToZoomDelta", () => {
  it("returns a positive delta when fingers spread apart", () => {
    expect(pinchRatioToZoomDelta(1.2)).toBeCloseTo(0.2);
  });

  it("returns a negative delta when fingers pinch together", () => {
    expect(pinchRatioToZoomDelta(0.8)).toBeCloseTo(-0.2);
  });

  it("returns zero for an unchanged span", () => {
    expect(pinchRatioToZoomDelta(1)).toBe(0);
  });

  it("clamps a large spread to maxStep", () => {
    expect(pinchRatioToZoomDelta(5, 0.5)).toBe(0.5);
  });

  it("clamps a large pinch to -maxStep", () => {
    expect(pinchRatioToZoomDelta(0.01, 0.5)).toBe(-0.5);
  });

  it("treats a non-positive or non-finite ratio as no change", () => {
    expect(pinchRatioToZoomDelta(0)).toBe(0);
    expect(pinchRatioToZoomDelta(-1)).toBe(0);
    expect(pinchRatioToZoomDelta(Number.NaN)).toBe(0);
    expect(pinchRatioToZoomDelta(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
