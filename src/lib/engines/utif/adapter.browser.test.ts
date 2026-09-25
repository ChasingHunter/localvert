import { encodeImage } from "utif2";
import { describe, expect, it } from "vitest";
import { isEngineError } from "../errors";
import type { EngineTask } from "../types";
import adapter from "./adapter";

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "decode",
    input: { kind: "bytes", bytes: new ArrayBuffer(0) },
    inputFormat: "tiff",
    outputFormat: "raster",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

/**
 * Builds a real, minimal TIFF with `UTIF.encodeImage` itself — no fixture
 * files, no network. Four distinct corner colors (same layout as
 * `../psd/adapter.browser.test.ts`'s hand-built PSD) make the decoded pixels
 * easy to assert on exactly.
 *
 *   (0,0) red   (1,0) green
 *   (0,1) blue  (1,1) white
 */
function buildTiff(): ArrayBuffer {
  const width = 2;
  const height = 2;
  // biome-ignore format: one row per pixel reads clearer than one long line.
  const rgba = new Uint8Array([
    255,   0,   0, 255,    0, 255,   0, 255,
      0,   0, 255, 255,  255, 255, 255, 255,
  ]);
  return encodeImage(rgba, width, height);
}

describe("utif adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("utif");
    expect(adapter.marker).toBe("localvert-engine:utif");
    expect(adapter.location).toBe("bundled");
  });

  describe("supports", () => {
    it("accepts decode from tiff to raster", () => {
      expect(adapter.supports("decode", "tiff", "raster")).toBe(true);
    });

    it("rejects a non-decode op", () => {
      expect(adapter.supports("encode", "tiff", "raster")).toBe(false);
    });

    it("rejects a non-tiff input", () => {
      expect(adapter.supports("decode", "png", "raster")).toBe(false);
    });

    it("rejects a non-raster output", () => {
      expect(adapter.supports("decode", "tiff", "tiff")).toBe(false);
    });
  });

  describe("run", () => {
    it("decodes a UTIF.encodeImage-built TIFF to its exact pixels", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const bytes = buildTiff();

      const result = await instance.run(
        baseTask({ input: { kind: "bytes", bytes } }),
      );
      if (result.kind !== "raster") throw new Error("expected raster result");

      expect(result.image.width).toBe(2);
      expect(result.image.height).toBe(2);
      const px = (x: number, y: number) => {
        const i = (y * result.image.width + x) * 4;
        return Array.from(result.image.data.subarray(i, i + 4));
      };
      expect(px(0, 0)).toEqual([255, 0, 0, 255]); // red
      expect(px(1, 0)).toEqual([0, 255, 0, 255]); // green
      expect(px(0, 1)).toEqual([0, 0, 255, 255]); // blue
      expect(px(1, 1)).toEqual([255, 255, 255, 255]); // white
    });

    it("throws EngineError('decode-failed') on garbage bytes", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const garbage = new Uint8Array([1, 2, 3, 4, 5]).buffer;

      await expect(
        instance.run(baseTask({ input: { kind: "bytes", bytes: garbage } })),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "decode-failed",
      );
    });

    it("throws EngineError('aborted') when the signal is already aborted", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const controller = new AbortController();
      controller.abort();
      const bytes = buildTiff();

      await expect(
        instance.run(
          baseTask({
            input: { kind: "bytes", bytes },
            signal: controller.signal,
          }),
        ),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "aborted",
      );
    });
  });
});
