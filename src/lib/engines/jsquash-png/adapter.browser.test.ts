import { describe, expect, it } from "vitest";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import { FORMATS, sniffFormat } from "@/lib/registry";
import { isEngineError } from "../errors";
import type { EngineTask } from "../types";
import adapter from "./adapter";

const WIDTH = 32;
const HEIGHT = 32;

/**
 * The real, `pnpm sync-engines`-populated asset path — proves the adapter
 * loads its wasm from our own versioned origin (what `public/engines/
 * jsquash-png@<version>/` is served as by Vite's browser-mode dev server),
 * never jSquash's own default URL. See `../jsquash-png/adapter.ts`'s `load`.
 */
function baseUrl(): string {
  return ENGINE_MANIFEST["jsquash-png"].baseUrl;
}

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "decode",
    input: { kind: "blob", blob: new Blob() },
    inputFormat: "png",
    outputFormat: "raster",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** A small source png with a fully transparent marker corner, built
 * directly with OffscreenCanvas — no fixture files, no network. */
async function sourcePng(width = WIDTH, height = HEIGHT): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context in test setup");
  ctx.fillStyle = "#3366ff";
  ctx.fillRect(0, 0, width, height);
  ctx.clearRect(0, 0, 4, 4);
  return canvas.convertToBlob({ type: "image/png" });
}

describe("jsquash-png adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("jsquash-png");
    expect(adapter.marker).toBe("localvert-engine:jsquash-png");
    expect(adapter.version).toBe("3.1.1");
  });

  describe("supports", () => {
    it("accepts decode png -> raster", () => {
      expect(adapter.supports("decode", "png", "raster")).toBe(true);
    });

    it("rejects decode for a non-png input", () => {
      expect(adapter.supports("decode", "jpg", "raster")).toBe(false);
    });

    it("rejects decode with a non-raster output", () => {
      expect(adapter.supports("decode", "png", "png")).toBe(false);
    });

    it("accepts encode raster -> png", () => {
      expect(adapter.supports("encode", "raster", "png")).toBe(true);
    });

    it("rejects encode with a non-raster input", () => {
      expect(adapter.supports("encode", "png", "png")).toBe(false);
    });

    it("rejects encode with a non-png output", () => {
      expect(adapter.supports("encode", "raster", "jpg")).toBe(false);
    });

    it("rejects a non-decode/encode op", () => {
      expect(adapter.supports("resize", "raster", "raster")).toBe(false);
      expect(adapter.supports("transcode", "png", "png")).toBe(false);
    });
  });

  describe("decode / encode", () => {
    it("decodes real png bytes to plausible raster dimensions and pixels", async () => {
      const instance = await adapter.load({
        baseUrl: baseUrl(),
        capabilities: {} as never,
      });
      const srcBlob = await sourcePng();

      const result = await instance.run(
        baseTask({ input: { kind: "blob", blob: srcBlob } }),
      );
      if (result.kind !== "raster") throw new Error("expected a raster result");
      expect(result.image.width).toBe(WIDTH);
      expect(result.image.height).toBe(HEIGHT);
      expect(result.image.data.length).toBe(WIDTH * HEIGHT * 4);
      // The cleared marker corner decoded losslessly: fully transparent.
      expect(result.image.data[3]).toBe(0);
      // The opaque fill elsewhere decoded losslessly too.
      expect(result.image.data[WIDTH * 4 * (HEIGHT - 1) + 3]).toBe(255);
    });

    it("round-trips losslessly: decode then encode reproduces the same pixels", async () => {
      const instance = await adapter.load({
        baseUrl: baseUrl(),
        capabilities: {} as never,
      });
      const srcBlob = await sourcePng();
      const decoded = await instance.run(
        baseTask({ input: { kind: "blob", blob: srcBlob } }),
      );
      if (decoded.kind !== "raster")
        throw new Error("expected a raster result");

      const encoded = await instance.run(
        baseTask({
          op: "encode",
          input: { kind: "raster", image: decoded.image },
          inputFormat: "raster",
          outputFormat: "png",
        }),
      );
      if (encoded.kind !== "bytes") throw new Error("expected a bytes result");
      expect(sniffFormat(new Uint8Array(encoded.bytes))).toBe("png");
      expect(encoded.mime).toBe(FORMATS.png.mime);

      const redecoded = await instance.run(
        baseTask({
          input: { kind: "bytes", bytes: encoded.bytes },
        }),
      );
      if (redecoded.kind !== "raster")
        throw new Error("expected a raster result");
      expect(redecoded.image.width).toBe(decoded.image.width);
      expect(redecoded.image.height).toBe(decoded.image.height);
      expect(new Uint8Array(redecoded.image.data)).toEqual(
        new Uint8Array(decoded.image.data),
      );
    });

    it("throws EngineError('decode-failed') on garbage bytes", async () => {
      const instance = await adapter.load({
        baseUrl: baseUrl(),
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
        baseUrl: baseUrl(),
        capabilities: {} as never,
      });
      const controller = new AbortController();
      controller.abort();
      const srcBlob = await sourcePng();

      await expect(
        instance.run(
          baseTask({
            input: { kind: "blob", blob: srcBlob },
            signal: controller.signal,
          }),
        ),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "aborted",
      );
    });
  });
});
