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
 * jsquash-jpeg@<version>/` is served as by Vite's browser-mode dev server),
 * never jSquash's own default URL. See `../jsquash-jpeg/adapter.ts`'s `load`.
 */
function baseUrl(): string {
  return ENGINE_MANIFEST["jsquash-jpeg"].baseUrl;
}

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "decode",
    input: { kind: "blob", blob: new Blob() },
    inputFormat: "jpg",
    outputFormat: "raster",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** A small source jpeg with a distinct marker corner, built directly with
 * OffscreenCanvas — no fixture files, no network. */
async function sourceJpeg(width = WIDTH, height = HEIGHT): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context in test setup");
  ctx.fillStyle = "#3366ff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 4, 4);
  return canvas.convertToBlob({ type: "image/jpeg" });
}

/** A bigger, noisier source so jpeg quality actually changes byte size — a
 * tiny solid-color image compresses to ~the same size regardless (mirrors
 * ../canvas/adapter.browser.test.ts's "produces a smaller jpg at lower
 * quality" fixture). */
async function noisySourceJpeg(size = 200): Promise<Blob> {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context in test setup");
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      ctx.fillStyle = `rgb(${(x * 7) % 256}, ${(y * 13) % 256}, ${(x + y) % 256})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas.convertToBlob({ type: "image/jpeg" });
}

describe("jsquash-jpeg adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("jsquash-jpeg");
    expect(adapter.marker).toBe("localvert-engine:jsquash-jpeg");
    expect(adapter.version).toBe("1.6.0");
  });

  describe("supports", () => {
    it("accepts decode jpg -> raster", () => {
      expect(adapter.supports("decode", "jpg", "raster")).toBe(true);
    });

    it("rejects decode for a non-jpg input", () => {
      expect(adapter.supports("decode", "png", "raster")).toBe(false);
    });

    it("rejects decode with a non-raster output", () => {
      expect(adapter.supports("decode", "jpg", "jpg")).toBe(false);
    });

    it("accepts encode raster -> jpg", () => {
      expect(adapter.supports("encode", "raster", "jpg")).toBe(true);
    });

    it("rejects encode with a non-raster input", () => {
      expect(adapter.supports("encode", "jpg", "jpg")).toBe(false);
    });

    it("rejects encode with a non-jpg output", () => {
      expect(adapter.supports("encode", "raster", "png")).toBe(false);
    });

    it("rejects a non-decode/encode op", () => {
      expect(adapter.supports("resize", "raster", "raster")).toBe(false);
      expect(adapter.supports("transcode", "jpg", "jpg")).toBe(false);
    });
  });

  describe("decode / encode", () => {
    it("decodes real jpeg bytes to plausible raster dimensions and pixels", async () => {
      const instance = await adapter.load({
        baseUrl: baseUrl(),
        capabilities: {} as never,
      });
      const srcBlob = await sourceJpeg();

      const result = await instance.run(
        baseTask({ input: { kind: "blob", blob: srcBlob } }),
      );
      if (result.kind !== "raster") throw new Error("expected a raster result");
      expect(result.image.width).toBe(WIDTH);
      expect(result.image.height).toBe(HEIGHT);
      expect(result.image.data.length).toBe(WIDTH * HEIGHT * 4);
      // The marker corner decodes close to red, not the blue fill — jpeg's
      // lossy DCT means it's rarely exact, so this checks the channel
      // relationship rather than an exact value.
      expect(result.image.data[0]).toBeGreaterThan(150);
      expect(result.image.data[2]).toBeLessThan(150);
    });

    it("round-trips: decode real jpeg bytes, then encode raster back to valid jpeg bytes", async () => {
      const instance = await adapter.load({
        baseUrl: baseUrl(),
        capabilities: {} as never,
      });
      const srcBlob = await sourceJpeg();
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
          outputFormat: "jpg",
        }),
      );
      if (encoded.kind !== "bytes") throw new Error("expected a bytes result");
      expect(sniffFormat(new Uint8Array(encoded.bytes))).toBe("jpg");
      expect(encoded.mime).toBe(FORMATS.jpg.mime);

      const outBitmap = await createImageBitmap(
        new Blob([encoded.bytes], { type: encoded.mime }),
      );
      expect(outBitmap.width).toBe(WIDTH);
      expect(outBitmap.height).toBe(HEIGHT);
      outBitmap.close();
    });

    it("produces a smaller jpg at lower quality", async () => {
      const instance = await adapter.load({
        baseUrl: baseUrl(),
        capabilities: {} as never,
      });
      const srcBlob = await noisySourceJpeg();
      const decoded = await instance.run(
        baseTask({ input: { kind: "blob", blob: srcBlob } }),
      );
      if (decoded.kind !== "raster")
        throw new Error("expected a raster result");

      const low = await instance.run(
        baseTask({
          op: "encode",
          input: { kind: "raster", image: decoded.image },
          inputFormat: "raster",
          outputFormat: "jpg",
          options: { quality: 0.2 },
        }),
      );
      const high = await instance.run(
        baseTask({
          op: "encode",
          input: { kind: "raster", image: decoded.image },
          inputFormat: "raster",
          outputFormat: "jpg",
          options: { quality: 0.9 },
        }),
      );
      if (low.kind !== "bytes" || high.kind !== "bytes") {
        throw new Error("expected bytes results");
      }
      expect(low.bytes.byteLength).toBeLessThan(high.bytes.byteLength);
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
      const srcBlob = await sourceJpeg();

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
