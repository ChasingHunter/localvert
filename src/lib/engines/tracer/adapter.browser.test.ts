import { describe, expect, it } from "vitest";
import { isEngineError } from "../errors";
import type { EngineTask, RasterImage } from "../types";
import adapter from "./adapter";

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "encode",
    input: { kind: "raster", image: solidRaster(2, 2, [0, 0, 0, 255]) },
    inputFormat: "raster",
    outputFormat: "svg",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** A flat-color `width x height` raster — every pixel the same RGBA. */
function solidRaster(
  width: number,
  height: number,
  rgba: readonly [number, number, number, number],
): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data.set(rgba, i);
  }
  return { width, height, data };
}

/** A `width x height` raster, left half one flat color, right half another —
 * no antialiasing, so every pixel is exactly one of the two colors. */
function twoColorRaster(
  width: number,
  height: number,
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data.set(x < width / 2 ? left : right, i);
    }
  }
  return { width, height, data };
}

/** SVG path fill colors are written as `fill="rgb(r,g,b)"` — see
 * `SvgDrawer.colorToRgbString` in `@image-tracer-ts/core`. */
function fillColors(svg: string): [number, number, number][] {
  return Array.from(svg.matchAll(/fill="rgb\((\d+),(\d+),(\d+)\)"/g)).map(
    ([, r, g, b]) => [Number(r), Number(g), Number(b)],
  );
}

function distance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Tolerant match: color clustering can shift a solid region's traced fill a
 * little off the exact source RGB. */
function hasColorNear(
  colors: readonly [number, number, number][],
  target: readonly [number, number, number],
  tolerance = 40,
): boolean {
  return colors.some((c) => distance(c, target) <= tolerance);
}

function viewBoxWidth(svg: string): number {
  const match = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) /);
  if (!match?.[1]) throw new Error("svg has no viewBox");
  return Number(match[1]);
}

describe("tracer adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("tracer");
    expect(adapter.marker).toBe("localvert-engine:tracer");
    expect(adapter.location).toBe("bundled");
  });

  describe("supports", () => {
    it("accepts encode from raster to svg", () => {
      expect(adapter.supports("encode", "raster", "svg")).toBe(true);
    });

    it("rejects a non-encode op", () => {
      expect(adapter.supports("decode", "raster", "svg")).toBe(false);
    });

    it("rejects a non-raster input", () => {
      expect(adapter.supports("encode", "png", "svg")).toBe(false);
    });

    it("rejects a non-svg output", () => {
      expect(adapter.supports("encode", "raster", "png")).toBe(false);
    });
  });

  describe("run", () => {
    it("traces a two-color raster to an svg with both fill colors", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const image = twoColorRaster(32, 32, [255, 0, 0, 255], [0, 0, 255, 255]);

      const result = await instance.run(
        baseTask({ input: { kind: "raster", image } }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");
      expect(result.mime).toBe("image/svg+xml");

      const svg = new TextDecoder().decode(result.bytes);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.match(/<path/g)?.length ?? 0).toBeGreaterThanOrEqual(2);

      const colors = fillColors(svg);
      expect(hasColorNear(colors, [255, 0, 0])).toBe(true);
      expect(hasColorNear(colors, [0, 0, 255])).toBe(true);
    });

    it("downscales a raster wider than maxSize before tracing", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      // Flat color: cheap to trace (one big shape), only the downscale step
      // under test.
      const image = solidRaster(3000, 100, [0, 128, 0, 255]);

      const result = await instance.run(
        baseTask({ input: { kind: "raster", image } }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");

      const svg = new TextDecoder().decode(result.bytes);
      expect(viewBoxWidth(svg)).toBeLessThanOrEqual(1600);
    });

    it("throws EngineError('aborted') when the signal is already aborted", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const controller = new AbortController();
      controller.abort();

      await expect(
        instance.run(baseTask({ signal: controller.signal })),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "aborted",
      );
    });
  });
});
