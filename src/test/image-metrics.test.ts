import { describe, expect, it } from "vitest";
import { psnr } from "./image-metrics";

describe("psnr", () => {
  it("returns Infinity for identical buffers", () => {
    const a = new Uint8ClampedArray([10, 20, 30, 255, 0, 128, 64, 255]);
    const b = new Uint8ClampedArray(a);
    expect(psnr(a, b)).toBe(Infinity);
  });

  it("returns the expected dB for a known, uniform noise offset", () => {
    // Every byte differs by exactly 10 -> MSE = 100 -> a closed-form PSNR,
    // independent of this function's own implementation.
    const a = new Uint8ClampedArray(16).fill(100);
    const b = new Uint8ClampedArray(16).fill(110);
    const expected = 10 * Math.log10((255 * 255) / 100);
    expect(psnr(a, b)).toBeCloseTo(expected, 6);
  });

  it("throws on mismatched buffer lengths", () => {
    expect(() =>
      psnr(new Uint8ClampedArray(4), new Uint8ClampedArray(5)),
    ).toThrow();
  });
});
