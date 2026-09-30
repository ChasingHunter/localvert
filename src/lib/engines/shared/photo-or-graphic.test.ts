import { describe, expect, it } from "vitest";
import type { RasterLike } from "./photo-or-graphic";
import { classifyImageKind } from "./photo-or-graphic";

function makePhoto(width: number, height: number): RasterLike {
  // A smooth gradient with per-pixel dithering noise: thousands of
  // distinct colours, low hard-edge density — the profile of a photo.
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const noise = ((x * 7 + y * 13) % 23) - 11;
      data[i] = Math.min(
        255,
        Math.max(0, Math.round((x / width) * 255) + noise),
      );
      data[i + 1] = Math.min(
        255,
        Math.max(0, Math.round((y / height) * 255) + noise),
      );
      data[i + 2] = Math.min(255, Math.max(0, 128 + noise));
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function makeGraphic(width: number, height: number): RasterLike {
  // A handful of flat colour blocks with hard boundaries — the profile of a
  // UI screenshot or icon.
  const data = new Uint8ClampedArray(width * height * 4);
  const colors = [
    [255, 255, 255],
    [10, 10, 10],
    [255, 0, 0],
    [0, 120, 255],
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const block =
        (Math.floor(x / (width / 4)) + Math.floor(y / (height / 4))) %
        colors.length;
      const [r, g, b] = colors[block] ?? [0, 0, 0];
      data[i] = r ?? 0;
      data[i + 1] = g ?? 0;
      data[i + 2] = b ?? 0;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

describe("classifyImageKind", () => {
  it("classifies a noisy gradient as a photo", () => {
    expect(classifyImageKind(makePhoto(256, 256))).toBe("photo");
  });

  it("classifies flat colour blocks with hard edges as a graphic", () => {
    expect(classifyImageKind(makeGraphic(256, 256))).toBe("graphic");
  });

  it("classifies a single solid colour as a photo (no hard edges, low colour count, falls through the graphic gate)", () => {
    const data = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 200;
      data[i + 1] = 200;
      data[i + 2] = 200;
      data[i + 3] = 255;
    }
    // A flat single-colour image has zero edge density, so it doesn't meet
    // the graphic gate either — it falls back to "photo", which is the
    // harmless default (4:2:0 loses nothing on a flat colour).
    expect(classifyImageKind({ width: 64, height: 64, data })).toBe("photo");
  });
});
