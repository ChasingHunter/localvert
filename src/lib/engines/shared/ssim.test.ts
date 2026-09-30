import { describe, expect, it } from "vitest";
import type { RasterLike } from "./ssim";
import { ssim } from "./ssim";

function makeGradient(width: number, height: number): RasterLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = Math.round(((x + y) / (width + height)) * 255);
      data[i] = v;
      data[i + 1] = (v * 3) % 256;
      data[i + 2] = (255 - v) % 256;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function clone(image: RasterLike): RasterLike {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data),
  };
}

/** Adds uniform per-pixel noise of the given amplitude, deterministically
 * (no Math.random) so the test is reproducible. */
function addNoise(image: RasterLike, amplitude: number): RasterLike {
  const data = new Uint8ClampedArray(image.data);
  for (let i = 0; i < data.length; i += 4) {
    // A cheap deterministic pseudo-noise pattern, not true randomness.
    const n = (((i / 4) * 2654435761) % 2000) / 2000 - 0.5;
    data[i] = data[i] + n * amplitude * 2;
    data[i + 1] = data[i + 1] + n * amplitude * 2;
    data[i + 2] = data[i + 2] + n * amplitude * 2;
  }
  return { width: image.width, height: image.height, data };
}

describe("ssim", () => {
  it("scores identical images as 1", () => {
    const image = makeGradient(200, 150);
    expect(ssim(image, clone(image))).toBeCloseTo(1, 6);
  });

  it("scores a flat solid image against itself as 1", () => {
    const data = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 128;
      data[i + 1] = 128;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
    const image = { width: 64, height: 64, data };
    expect(ssim(image, clone(image))).toBeCloseTo(1, 6);
  });

  it("drops for a heavier perturbation and stays high for a lighter one", () => {
    const image = makeGradient(200, 150);
    const lightlyNoisy = addNoise(image, 3);
    const heavilyNoisy = addNoise(image, 40);

    const lightScore = ssim(image, lightlyNoisy);
    const heavyScore = ssim(image, heavilyNoisy);

    expect(lightScore).toBeGreaterThan(heavyScore);
    // A light perturbation should still read as very similar...
    expect(lightScore).toBeGreaterThan(0.9);
    // ...while a heavy one should read as clearly different, within a
    // tolerance band rather than pinned to one exact value (the point is
    // "noticeably lower", not a specific float).
    expect(heavyScore).toBeLessThan(0.9);
    expect(heavyScore).toBeGreaterThan(0.2);
  });

  it("downscales larger-than-1024 images without throwing and still scores 1 for identical input", () => {
    const image = makeGradient(1600, 1200);
    expect(ssim(image, clone(image))).toBeCloseTo(1, 5);
  });

  it("measures cost on a 1024x768 plane (reported via console, not asserted)", () => {
    const a = makeGradient(1024, 768);
    const b = addNoise(a, 5);
    const start = performance.now();
    const iterations = 2;
    for (let i = 0; i < iterations; i++) ssim(a, b);
    const elapsedMs = (performance.now() - start) / iterations;
    // biome-ignore lint/suspicious/noConsole: intentional perf measurement, surfaced in the final report.
    console.log(`ssim() on a 1024x768 plane: ${elapsedMs.toFixed(1)}ms/call`);
    // Generous ceiling — this is a measurement, not a strict perf gate. A
    // regression that makes SSIM unusably slow in a ~6-encode search would
    // still fail this.
    expect(elapsedMs).toBeLessThan(10_000);
  }, 20_000);
});
