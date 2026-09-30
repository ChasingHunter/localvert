import { describe, expect, it } from "vitest";
import {
  computeDownscaleDims,
  computeDownscaleFactor,
} from "./downscale-for-target";

describe("computeDownscaleFactor", () => {
  it("computes sqrt(target/current) * 0.95", () => {
    // target = current / 4 -> sqrt(0.25) = 0.5, * 0.95 = 0.475
    expect(computeDownscaleFactor(400_000, 100_000)).toBeCloseTo(0.475, 5);
  });

  it("never exceeds 1 (never upscales)", () => {
    expect(computeDownscaleFactor(100_000, 400_000)).toBe(1);
  });

  it("never goes below the safety floor", () => {
    expect(computeDownscaleFactor(1_000_000_000, 1)).toBeGreaterThanOrEqual(
      0.1,
    );
  });
});

describe("computeDownscaleDims", () => {
  it("scales both dimensions by the same factor", () => {
    const dims = computeDownscaleDims(1600, 1200, 400_000, 100_000);
    expect(dims.width).toBe(Math.round(1600 * 0.475));
    expect(dims.height).toBe(Math.round(1200 * 0.475));
  });

  it("never returns a zero dimension", () => {
    const dims = computeDownscaleDims(10, 10, 1_000_000_000, 1);
    expect(dims.width).toBeGreaterThanOrEqual(1);
    expect(dims.height).toBeGreaterThanOrEqual(1);
  });
});
