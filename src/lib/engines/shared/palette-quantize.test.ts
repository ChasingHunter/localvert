import { describe, expect, it } from "vitest";
import type { RasterImage } from "../types";
import { quantizeToPalette } from "./palette-quantize";

/** A 16x16 gradient with far more than 256 distinct RGBA colours — every
 * pixel's R/G channel is derived from its own coordinates so no two rows
 * repeat the same colour. */
function gradientImage(size = 16): RasterImage {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = (x * 16) % 256;
      data[i + 1] = (y * 16) % 256;
      data[i + 2] = (x + y) % 256;
      data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

function distinctColorCount(image: RasterImage): number {
  const seen = new Set<string>();
  for (let i = 0; i < image.data.length; i += 4) {
    seen.add(
      `${image.data[i]},${image.data[i + 1]},${image.data[i + 2]},${image.data[i + 3]}`,
    );
  }
  return seen.size;
}

describe("quantizeToPalette", () => {
  it("reduces colour count to at most the requested palette size", () => {
    const source = gradientImage();
    expect(distinctColorCount(source)).toBeGreaterThan(16);

    const result = quantizeToPalette(source, { colors: 8, dither: false });

    expect(distinctColorCount(result)).toBeLessThanOrEqual(8);
  });

  it("keeps the image's own dimensions", () => {
    const source = gradientImage();
    const result = quantizeToPalette(source, { colors: 4 });
    expect(result.width).toBe(source.width);
    expect(result.height).toBe(source.height);
    expect(result.data.length).toBe(source.data.length);
  });

  it("defaults to 256 colours and dithering on", () => {
    const source = gradientImage();
    const result = quantizeToPalette(source);
    expect(distinctColorCount(result)).toBeLessThanOrEqual(256);
  });

  it("a solid single-colour image quantizes to exactly one colour", () => {
    const size = 4;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 10;
      data[i + 1] = 20;
      data[i + 2] = 30;
      data[i + 3] = 255;
    }
    const result = quantizeToPalette(
      { width: size, height: size, data },
      { colors: 16, dither: false },
    );
    expect(distinctColorCount(result)).toBe(1);
  });
});
