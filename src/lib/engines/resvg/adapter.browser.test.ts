import { describe, expect, it, vi } from "vitest";
import { isEngineError } from "../errors";
import { engineBaseUrl } from "../meta";
import type { EngineTask } from "../types";
import adapter from "./adapter";

const BASE_URL = engineBaseUrl({
  id: adapter.id,
  version: adapter.version,
  location: adapter.location,
});

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "decode",
    input: { kind: "blob", blob: new Blob() },
    inputFormat: "svg",
    outputFormat: "raster",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** A 10x10 SVG whose rect exactly covers the canvas — no antialiased edge
 * pixels to worry about, so every decoded pixel is the fill color exactly. */
function squareSvg(fill = "#3366ff"): Blob {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" fill="${fill}"/></svg>`;
  return new Blob([svg], { type: "image/svg+xml" });
}

describe("resvg adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("resvg");
    expect(adapter.marker).toBe("localvert-engine:resvg");
    expect(adapter.location).toBe("static");
  });

  describe("supports", () => {
    it("accepts decode from svg to raster", () => {
      expect(adapter.supports("decode", "svg", "raster")).toBe(true);
    });

    it("rejects a non-decode op", () => {
      expect(adapter.supports("encode", "svg", "raster")).toBe(false);
    });

    it("rejects a non-svg input", () => {
      expect(adapter.supports("decode", "png", "raster")).toBe(false);
    });

    it("rejects a non-raster output", () => {
      expect(adapter.supports("decode", "svg", "svg")).toBe(false);
    });
  });

  describe("run", () => {
    it("rasterises a simple SVG to its intrinsic size and exact fill color", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });

      const result = await instance.run(
        baseTask({ input: { kind: "blob", blob: squareSvg() } }),
      );
      if (result.kind !== "raster") throw new Error("expected raster result");

      expect(result.image.width).toBe(10);
      expect(result.image.height).toBe(10);
      const i = (5 * result.image.width + 5) * 4;
      expect(Array.from(result.image.data.subarray(i, i + 4))).toEqual([
        0x33, 0x66, 0xff, 255,
      ]);
    });

    it("rasterises at the requested width, preserving aspect ratio", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });

      const result = await instance.run(
        baseTask({
          input: { kind: "blob", blob: squareSvg() },
          options: { width: 40 },
        }),
      );
      if (result.kind !== "raster") throw new Error("expected raster result");

      expect(result.image.width).toBe(40);
      expect(result.image.height).toBe(40);
    });

    it("decodes an SVG with an external image href without fetching it", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      // Spy only after load() — its own wasm fetch has already happened by
      // now, so any call captured here would have to come from decoding.
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="https://example.invalid/should-not-be-fetched.png" width="10" height="10"/></svg>`;
      const result = await instance.run(
        baseTask({
          input: {
            kind: "blob",
            blob: new Blob([svg], { type: "image/svg+xml" }),
          },
        }),
      );

      expect(result.kind).toBe("raster");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("throws EngineError('decode-failed') on garbage bytes", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const garbage = new Blob([new Uint8Array([1, 2, 3, 4, 5])]);

      await expect(
        instance.run(baseTask({ input: { kind: "blob", blob: garbage } })),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "decode-failed",
      );
    });

    it("throws EngineError('aborted') when the signal is already aborted", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const controller = new AbortController();
      controller.abort();

      await expect(
        instance.run(
          baseTask({
            input: { kind: "blob", blob: squareSvg() },
            signal: controller.signal,
          }),
        ),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "aborted",
      );
    });
  });
});
