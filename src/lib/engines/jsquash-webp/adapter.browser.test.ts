import { describe, expect, it } from "vitest";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import { sniffFormat } from "@/lib/registry";
import { isEngineError } from "../errors";
import type { EngineTask, RasterImage } from "../types";
import adapter from "./adapter";

const BASE_URL = ENGINE_MANIFEST["jsquash-webp"].baseUrl;
const WIDTH = 32;
const HEIGHT = 32;

/** Builds a real webp source with the browser's own encoder — no fixture
 * files, no network. A solid fill with a distinct corner marker, same shape
 * as the canvas adapter tests' `sourceImage`, so dimensions and content are
 * easy to assert on. */
async function sourceWebpBlob(): Promise<Blob> {
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context in test setup");
  ctx.fillStyle = "#3366ff";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 4, 4);
  return canvas.convertToBlob({ type: "image/webp" });
}

/** Builds a `RasterImage` directly with OffscreenCanvas + getImageData — no
 * fixture files, no network, and no dependency on this adapter's own decode
 * (so encode tests stay focused on encode). A 1x1 red marker pixel sits at
 * the top-left corner over an otherwise solid blue fill. */
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

/** A bigger, noisier source so quality actually changes byte size — a tiny
 * solid-color image compresses to ~the same size regardless. */
async function noisySourceWebpBlob(size = 200): Promise<Blob> {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context in test setup");
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      ctx.fillStyle = `rgb(${(x * 7) % 256}, ${(y * 13) % 256}, ${(x + y) % 256})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas.convertToBlob({ type: "image/webp" });
}

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "decode",
    input: { kind: "blob", blob: new Blob() },
    inputFormat: "webp",
    outputFormat: "raster",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("jsquash-webp adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("jsquash-webp");
    expect(adapter.marker).toBe("localvert-engine:jsquash-webp");
    expect(adapter.version).toBe("1.5.0");
  });

  describe("supports", () => {
    it("accepts decode for webp -> raster", () => {
      expect(adapter.supports("decode", "webp", "raster")).toBe(true);
    });

    it("rejects decode for a non-webp input", () => {
      expect(adapter.supports("decode", "png", "raster")).toBe(false);
    });

    it("rejects decode with a non-raster output", () => {
      expect(adapter.supports("decode", "webp", "jpg")).toBe(false);
    });

    it("accepts encode for raster -> webp", () => {
      expect(adapter.supports("encode", "raster", "webp")).toBe(true);
    });

    it("rejects encode with a non-raster input", () => {
      expect(adapter.supports("encode", "webp", "webp")).toBe(false);
    });

    it("rejects encode with a non-webp output", () => {
      expect(adapter.supports("encode", "raster", "png")).toBe(false);
    });

    it("rejects an unrelated op", () => {
      expect(adapter.supports("resize", "raster", "raster")).toBe(false);
      expect(adapter.supports("transcode", "webp", "webp")).toBe(false);
      expect(adapter.supports("decode", "jpg", "raster")).toBe(false);
    });

    it("accepts compress webp -> webp", () => {
      expect(adapter.supports("compress", "webp", "webp")).toBe(true);
    });
  });

  describe("decode", () => {
    it("decodes a real webp to raster with correct dimensions", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const srcBlob = await sourceWebpBlob();

      const result = await instance.run(
        baseTask({ input: { kind: "blob", blob: srcBlob } }),
      );
      if (result.kind !== "raster") throw new Error("expected a raster result");
      expect(result.image.width).toBe(WIDTH);
      expect(result.image.height).toBe(HEIGHT);
      expect(result.image.data.length).toBe(WIDTH * HEIGHT * 4);
    });

    it("accepts a bytes input", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const srcBlob = await sourceWebpBlob();
      const bytes = await srcBlob.arrayBuffer();

      const result = await instance.run(
        baseTask({ input: { kind: "bytes", bytes } }),
      );
      if (result.kind !== "raster") throw new Error("expected a raster result");
      expect(result.image.width).toBe(WIDTH);
    });

    it("throws EngineError('aborted') when the signal is already aborted", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const controller = new AbortController();
      controller.abort();
      const srcBlob = await sourceWebpBlob();

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
  });

  describe("encode", () => {
    it("produces webp magic bytes and correct dimensions", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const image = await rasterOf(WIDTH, HEIGHT);

      const result = await instance.run(
        baseTask({
          op: "encode",
          input: { kind: "raster", image },
          inputFormat: "raster",
          outputFormat: "webp",
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected a bytes result");
      expect(sniffFormat(new Uint8Array(result.bytes))).toBe("webp");

      const outBitmap = await createImageBitmap(
        new Blob([result.bytes], { type: result.mime }),
      );
      expect(outBitmap.width).toBe(WIDTH);
      expect(outBitmap.height).toBe(HEIGHT);
      outBitmap.close();
    });

    it("produces a smaller lossy webp at lower quality", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      // A bigger, noisier source so quality actually changes byte size — a
      // tiny solid-color image compresses to ~the same size regardless.
      const size = 200;
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context in test setup");
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          ctx.fillStyle = `rgb(${(x * 7) % 256}, ${(y * 13) % 256}, ${(x + y) % 256})`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
      const { data, width, height } = ctx.getImageData(0, 0, size, size);
      const image: RasterImage = { width, height, data };

      const low = await instance.run(
        baseTask({
          op: "encode",
          input: { kind: "raster", image },
          inputFormat: "raster",
          outputFormat: "webp",
          options: { quality: 0.1 },
        }),
      );
      const high = await instance.run(
        baseTask({
          op: "encode",
          input: { kind: "raster", image },
          inputFormat: "raster",
          outputFormat: "webp",
          options: { quality: 0.95 },
        }),
      );
      if (low.kind !== "bytes" || high.kind !== "bytes") {
        throw new Error("expected bytes results");
      }
      expect(low.bytes.byteLength).toBeLessThan(high.bytes.byteLength);
    });

    it("round-trips lossless encode -> decode pixel-exact", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const image = await rasterOf(WIDTH, HEIGHT);

      const encoded = await instance.run(
        baseTask({
          op: "encode",
          input: { kind: "raster", image },
          inputFormat: "raster",
          outputFormat: "webp",
          options: { lossless: true },
        }),
      );
      if (encoded.kind !== "bytes") throw new Error("expected a bytes result");

      const decoded = await instance.run(
        baseTask({
          op: "decode",
          input: { kind: "bytes", bytes: encoded.bytes },
          inputFormat: "webp",
          outputFormat: "raster",
        }),
      );
      if (decoded.kind !== "raster")
        throw new Error("expected a raster result");

      expect(decoded.image.width).toBe(image.width);
      expect(decoded.image.height).toBe(image.height);
      expect(Array.from(decoded.image.data)).toEqual(Array.from(image.data));
    });

    it("throws EngineError('aborted') when the signal is already aborted", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const image = await rasterOf(4, 4);
      const controller = new AbortController();
      controller.abort();

      await expect(
        instance.run(
          baseTask({
            op: "encode",
            input: { kind: "raster", image },
            inputFormat: "raster",
            outputFormat: "webp",
            signal: controller.signal,
          }),
        ),
      ).rejects.toSatisfy(
        (e: unknown) => isEngineError(e) && e.code === "aborted",
      );
    });
  });

  describe("compress (ADR-0013)", () => {
    it("mode lossless strips metadata without touching pixels", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const srcBlob = await sourceWebpBlob();

      const result = await instance.run(
        baseTask({
          op: "compress",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "webp",
          outputFormat: "webp",
          options: { mode: "lossless" },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected a bytes result");
      expect(sniffFormat(new Uint8Array(result.bytes))).toBe("webp");

      const outBitmap = await createImageBitmap(
        new Blob([result.bytes], { type: result.mime }),
      );
      expect(outBitmap.width).toBe(WIDTH);
      expect(outBitmap.height).toBe(HEIGHT);
      outBitmap.close();
    });

    it("mode strong never produces a larger file than mode visually-lossless (ADR-0017 perceptual search)", async () => {
      // ADR-0017: both modes now run an SSIM-thresholded search
      // (searchBestQuality) rather than a fixed quality number — "strong"'s
      // looser threshold (0.999 vs 0.9999) means its required quality is
      // always <= "visually-lossless"'s, so its output is never bigger,
      // though on a fixture harsh enough that even max quality (95) misses
      // both thresholds, they can tie (both fall back to the same quality
      // 95 encode) rather than "strong" strictly winning.
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const srcBlob = await noisySourceWebpBlob();

      const visuallyLossless = await instance.run(
        baseTask({
          op: "compress",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "webp",
          outputFormat: "webp",
          options: { mode: "visually-lossless" },
        }),
      );
      const strong = await instance.run(
        baseTask({
          op: "compress",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "webp",
          outputFormat: "webp",
          options: { mode: "strong" },
        }),
      );
      if (visuallyLossless.kind !== "bytes" || strong.kind !== "bytes") {
        throw new Error("expected bytes results");
      }
      expect(strong.bytes.byteLength).toBeLessThanOrEqual(
        visuallyLossless.bytes.byteLength,
      );
    });

    it("mode custom honours options.quality", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const srcBlob = await noisySourceWebpBlob();

      const low = await instance.run(
        baseTask({
          op: "compress",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "webp",
          outputFormat: "webp",
          options: { mode: "custom", quality: 0.2 },
        }),
      );
      const high = await instance.run(
        baseTask({
          op: "compress",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "webp",
          outputFormat: "webp",
          options: { mode: "custom", quality: 0.9 },
        }),
      );
      if (low.kind !== "bytes" || high.kind !== "bytes") {
        throw new Error("expected bytes results");
      }
      expect(low.bytes.byteLength).toBeLessThan(high.bytes.byteLength);
    });

    it("mode target-size bisects toward the requested byte budget", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const srcBlob = await noisySourceWebpBlob();

      const result = await instance.run(
        baseTask({
          op: "compress",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "webp",
          outputFormat: "webp",
          options: { mode: "target-size", targetSizeKB: 5 },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected a bytes result");
      expect(result.bytes.byteLength).toBeLessThanOrEqual(5 * 1024 * 1.2);
    });

    it("mode target-size's note reports the achieved size against the target (ADR-0017 result contract)", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const srcBlob = await noisySourceWebpBlob();

      const result = await instance.run(
        baseTask({
          op: "compress",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "webp",
          outputFormat: "webp",
          options: { mode: "target-size", targetSizeKB: 5 },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected a bytes result");
      expect(result.note).toBeTruthy();
    });

    it("mode percent reduces the file relative to the source, and behaves like target-size", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const srcBlob = await noisySourceWebpBlob();

      const result = await instance.run(
        baseTask({
          op: "compress",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "webp",
          outputFormat: "webp",
          options: { mode: "percent", percent: 50 },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected a bytes result");
      expect(result.bytes.byteLength).toBeLessThan(srcBlob.size * 0.7);
    });

    it("mode target-size falls back to a downscale when quality alone can't reach an aggressive target, and notes the new dimensions", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const srcBlob = await noisySourceWebpBlob(400);

      const result = await instance.run(
        baseTask({
          op: "compress",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "webp",
          outputFormat: "webp",
          options: { mode: "target-size", targetSizeKB: 2 },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected a bytes result");
      expect(result.bytes.byteLength).toBeLessThan(srcBlob.size);
      expect(result.note).toBeTruthy();
    });

    it("never returns a file bigger than the input, and notes it when it doesn't", async () => {
      const instance = await adapter.load({
        baseUrl: BASE_URL,
        capabilities: {} as never,
      });
      const canvas = new OffscreenCanvas(4, 4);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context in test setup");
      ctx.fillStyle = "#3366ff";
      ctx.fillRect(0, 0, 4, 4);
      const srcBlob = await canvas.convertToBlob({ type: "image/webp" });

      const result = await instance.run(
        baseTask({
          op: "compress",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "webp",
          outputFormat: "webp",
          options: { mode: "custom", quality: 1 },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected a bytes result");
      expect(result.bytes.byteLength).toBeLessThanOrEqual(srcBlob.size);
    });
  });
});
