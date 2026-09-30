import { describe, expect, it } from "vitest";
import { downscaleRasterAreaAverage } from "./downscale-raster";

function makeSolid(
  width: number,
  height: number,
  rgba: [number, number, number, number],
) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  }
  return { width, height, data };
}

describe("downscaleRasterAreaAverage", () => {
  it("returns the same object when dims already match", () => {
    const image = makeSolid(10, 10, [1, 2, 3, 4]);
    expect(downscaleRasterAreaAverage(image, 10, 10)).toBe(image);
  });

  it("preserves a solid colour exactly when downscaled", () => {
    const image = makeSolid(100, 80, [200, 50, 10, 255]);
    const result = downscaleRasterAreaAverage(image, 25, 20);
    expect(result.width).toBe(25);
    expect(result.height).toBe(20);
    expect(result.data[0]).toBe(200);
    expect(result.data[1]).toBe(50);
    expect(result.data[2]).toBe(10);
    expect(result.data[3]).toBe(255);
  });

  it("averages a half-and-half split", () => {
    // Left half black, right half white; downscale to 2x1 should average
    // roughly toward the middle for a column straddling both halves, and be
    // exact for a destination pixel fully inside one half.
    const width = 4;
    const height = 1;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let x = 0; x < width; x++) {
      const v = x < 2 ? 0 : 255;
      data[x * 4] = v;
      data[x * 4 + 1] = v;
      data[x * 4 + 2] = v;
      data[x * 4 + 3] = 255;
    }
    const result = downscaleRasterAreaAverage({ width, height, data }, 2, 1);
    expect(result.data[0]).toBe(0); // left dst pixel averages source px 0-1 (both black)
    expect(result.data[4]).toBe(255); // right dst pixel averages source px 2-3 (both white)
  });
});
