import { describe, expect, it } from "vitest";
import { applyWhiteThreshold, computeInkBounds } from "./signature-image";

/** Builds a flat RGBA buffer for a `width`x`height` image, defaulting every
 * pixel to `fill` (opaque white unless overridden), then applies `paint` to
 * set individual pixels for the test. */
function makeImage(
  width: number,
  height: number,
  fill: [number, number, number, number],
  paint: (
    set: (x: number, y: number, rgba: [number, number, number, number]) => void,
  ) => void,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  }
  paint((x, y, rgba) => {
    const i = (y * width + x) * 4;
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  });
  return data;
}

describe("computeInkBounds", () => {
  it("returns null for a fully transparent image", () => {
    const data = makeImage(10, 10, [0, 0, 0, 0], () => {});
    expect(computeInkBounds(data, 10, 10)).toBeNull();
  });

  it("finds the tight bounding box of opaque pixels", () => {
    const data = makeImage(10, 10, [0, 0, 0, 0], (set) => {
      set(3, 4, [0, 0, 0, 255]);
      set(6, 7, [0, 0, 0, 255]);
    });
    expect(computeInkBounds(data, 10, 10)).toEqual({
      x: 3,
      y: 4,
      width: 4, // 6 - 3 + 1
      height: 4, // 7 - 4 + 1
    });
  });

  it("expands by padding and clamps to the image edges", () => {
    const data = makeImage(10, 10, [0, 0, 0, 0], (set) => {
      set(0, 0, [0, 0, 0, 255]);
      set(9, 9, [0, 0, 0, 255]);
    });
    expect(computeInkBounds(data, 10, 10, 5)).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
  });

  it("treats partially transparent pixels as ink", () => {
    const data = makeImage(4, 4, [0, 0, 0, 0], (set) => {
      set(1, 1, [0, 0, 0, 1]);
    });
    expect(computeInkBounds(data, 4, 4)).toEqual({
      x: 1,
      y: 1,
      width: 1,
      height: 1,
    });
  });
});

describe("applyWhiteThreshold", () => {
  it("makes near-white pixels transparent, leaving others untouched", () => {
    const data = makeImage(2, 1, [255, 255, 255, 255], (set) => {
      set(1, 0, [10, 20, 30, 255]);
    });
    applyWhiteThreshold(data, 245);
    // pixel 0 was white -> transparent
    expect(data[3]).toBe(0);
    // pixel 1 was dark -> untouched
    expect([data[4], data[5], data[6], data[7]]).toEqual([10, 20, 30, 255]);
  });

  it("thresholds near-white, not just pure white", () => {
    const data = makeImage(1, 1, [250, 250, 250, 255], () => {});
    applyWhiteThreshold(data, 245);
    expect(data[3]).toBe(0);
  });

  it("leaves pixels below the threshold opaque", () => {
    const data = makeImage(1, 1, [200, 200, 200, 255], () => {});
    applyWhiteThreshold(data, 245);
    expect(data[3]).toBe(255);
  });
});
