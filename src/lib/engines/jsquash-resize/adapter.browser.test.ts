import { describe, expect, it } from "vitest";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import { isEngineError } from "../errors";
import type { EngineTask, RasterImage } from "../types";
import adapter from "./adapter";

const BASE_URL = ENGINE_MANIFEST["jsquash-resize"].baseUrl;

/** Builds a `RasterImage` directly with OffscreenCanvas + getImageData — no
 * fixture files, no network. Same shape as the canvas adapter tests'
 * `rasterOf`: a 1x1 red marker pixel over an otherwise solid blue fill, so a
 * resize has something distinct to check for besides dimensions. */
async function rasterOf(width: number, height: number): Promise<RasterImage> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context in test setup");
  ctx.fillStyle = "#3366ff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 1, 1);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { width, height, data };
}

/** A solid-colour raster with no marker pixel — for the "stays that colour"
 * check, where any contamination from the resize filter would show up as a
 * channel value drifting away from the fill. */
async function solidRasterOf(
  width: number,
  height: number,
  color: string,
): Promise<RasterImage> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context in test setup");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { width, height, data };
}

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "resize",
    input: {
      kind: "raster",
      image: { width: 1, height: 1, data: new Uint8ClampedArray(4) },
    },
    inputFormat: "raster",
    outputFormat: "raster",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("jsquash-resize adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("jsquash-resize");
    expect(adapter.marker).toBe("localvert-engine:jsquash-resize");
    expect(adapter.version).toBe("2.1.1");
  });

  describe("supports", () => {
    it("accepts resize for raster -> raster", () => {
      expect(adapter.supports("resize", "raster", "raster")).toBe(true);
    });

    it("rejects a non-resize op", () => {
      expect(adapter.supports("rotate", "raster", "raster")).toBe(false);
      expect(adapter.supports("crop", "raster", "raster")).toBe(false);
      expect(adapter.supports("decode", "raster", "raster")).toBe(false);
    });

    it("rejects resize with a non-raster side", () => {
      expect(adapter.supports("resize", "png", "raster")).toBe(false);
      expect(adapter.supports("resize", "raster", "png")).toBe(false);
    });
  });

  describe("resize", () => {
    it("fit=contain (default) scales down to fit within the box, preserving aspect ratio", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const image = await rasterOf(100, 50);

      const result = await instance.run(
        baseTask({
          input: { kind: "raster", image },
          options: { width: 50, height: 50 },
        }),
      );
      if (result.kind !== "raster") throw new Error("expected a raster result");
      expect(result.image.width).toBe(50);
      expect(result.image.height).toBe(25);
    });

    it("fit=cover scales to cover the box, preserving aspect ratio", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const image = await rasterOf(100, 50);

      const result = await instance.run(
        baseTask({
          input: { kind: "raster", image },
          options: { width: 50, height: 50, fit: "cover" },
        }),
      );
      if (result.kind !== "raster") throw new Error("expected a raster result");
      expect(result.image.width).toBe(100);
      expect(result.image.height).toBe(50);
    });

    it("fit=fill stretches independently on both axes", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const image = await rasterOf(100, 50);

      const result = await instance.run(
        baseTask({
          input: { kind: "raster", image },
          options: { width: 40, height: 40, fit: "fill", allowUpscale: true },
        }),
      );
      if (result.kind !== "raster") throw new Error("expected a raster result");
      expect(result.image.width).toBe(40);
      expect(result.image.height).toBe(40);
    });

    it("never upscales past the source size unless allowUpscale is set", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const image = await rasterOf(20, 20);

      const clamped = await instance.run(
        baseTask({
          input: { kind: "raster", image },
          options: { width: 100, height: 100 },
        }),
      );
      if (clamped.kind !== "raster")
        throw new Error("expected a raster result");
      expect(clamped.image.width).toBe(20);
      expect(clamped.image.height).toBe(20);

      const upscaled = await instance.run(
        baseTask({
          input: { kind: "raster", image },
          options: { width: 100, height: 100, allowUpscale: true },
        }),
      );
      if (upscaled.kind !== "raster")
        throw new Error("expected a raster result");
      expect(upscaled.image.width).toBe(100);
      expect(upscaled.image.height).toBe(100);
    });

    it("passes through unchanged when neither width nor height is given", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const image = await rasterOf(40, 30);

      const result = await instance.run(
        baseTask({ input: { kind: "raster", image }, options: {} }),
      );
      if (result.kind !== "raster") throw new Error("expected a raster result");
      expect(result.image.width).toBe(40);
      expect(result.image.height).toBe(30);
    });

    it("a solid-colour image stays that colour after resizing", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const image = await solidRasterOf(40, 40, "#3366ff");

      const result = await instance.run(
        baseTask({
          input: { kind: "raster", image },
          options: { width: 20, height: 20 },
        }),
      );
      if (result.kind !== "raster") throw new Error("expected a raster result");

      const canvas = new OffscreenCanvas(
        result.image.width,
        result.image.height,
      );
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context in test verification");
      ctx.putImageData(
        new ImageData(
          result.image.data,
          result.image.width,
          result.image.height,
        ),
        0,
        0,
      );
      const { data } = ctx.getImageData(0, 0, 1, 1);
      expect(data[0]).toBeCloseTo(0x33, -1);
      expect(data[1]).toBeCloseTo(0x66, -1);
      expect(data[2]).toBeCloseTo(0xff, -1);
      expect(data[3]).toBe(255);
    });

    it("throws EngineError('aborted') when the signal is already aborted", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const image = await rasterOf(20, 20);
      const controller = new AbortController();
      controller.abort();

      await expect(
        instance.run(
          baseTask({
            input: { kind: "raster", image },
            options: { width: 10, height: 10 },
            signal: controller.signal,
          }),
        ),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "aborted",
      );
    });

    it("throws EngineError('unsupported') for a non-resize op", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const image = await rasterOf(10, 10);

      await expect(
        instance.run(
          baseTask({ op: "rotate", input: { kind: "raster", image } }),
        ),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "unsupported",
      );
    });
  });
});
