import { describe, expect, it } from "vitest";
import { FORMATS, type FormatId, sniffFormat } from "@/lib/registry";
import { isEngineError } from "../errors";
import type { EngineTask, RasterImage } from "../types";
import adapter from "./adapter";

const WIDTH = 32;
const HEIGHT = 32;
// JPEG encodes in independent 16x16 blocks (4:2:0 chroma subsampling MCUs)
// aligned to multiples of 16, starting at (0,0) — the transparent corner
// below is exactly one such block, so it reconstructs as a clean, uniform
// white with no DCT bleed from the opaque color elsewhere in the image.
// (A single semi-transparent pixel in a tiny image was tried first and
// failed: with the whole image inside one block, the fill color and the
// "transparent" pixel share the same DCT coefficients and the pixel comes
// back a blend, not white — see the failed run this was adjusted from.)
const TRANSPARENT_BLOCK = 16;

/**
 * Builds a small source image directly with OffscreenCanvas + convertToBlob
 * — no fixture files, no network. The top-left `TRANSPARENT_BLOCK` square is
 * fully transparent so the same source doubles as the "transparent" case
 * below; the rest of the canvas is an opaque solid color so decoded
 * dimensions and content are easy to assert on.
 */
async function sourceImage(
  type: "image/png" | "image/jpeg" | "image/webp",
): Promise<Blob> {
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context in test setup");
  ctx.fillStyle = "#3366ff";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.clearRect(0, 0, TRANSPARENT_BLOCK, TRANSPARENT_BLOCK);
  return canvas.convertToBlob({ type });
}

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "transcode",
    input: { kind: "blob", blob: new Blob() },
    inputFormat: "png",
    outputFormat: "jpg",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** Builds a `RasterImage` directly with OffscreenCanvas + getImageData — no
 * fixture files, no network, and no dependency on the adapter's own decode
 * (so resize/rotate/crop tests stay focused on those ops). A 1x1 red marker
 * pixel sits at the top-left corner, over an otherwise solid blue fill, so a
 * transform that moves or crops pixels around has something distinct to
 * check for. */
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

describe("canvas adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("canvas");
    expect(adapter.marker).toBe("localvert-engine:canvas");
    expect(adapter.version).toBe("1.0.0");
  });

  describe("supports", () => {
    const inputs = ["jpg", "png", "webp", "bmp", "gif"] as const;
    const outputs = ["jpg", "png", "webp"] as const;

    it("accepts transcode for every supported input/output pair", () => {
      for (const input of inputs) {
        for (const output of outputs) {
          expect(adapter.supports("transcode", input, output)).toBe(true);
        }
      }
    });

    it("rejects a non-transcode op", () => {
      expect(adapter.supports("resize", "png", "jpg")).toBe(false);
    });

    it("rejects an unsupported input format", () => {
      expect(adapter.supports("transcode", "pdf", "jpg")).toBe(false);
    });

    it("accepts decode for a decodable format -> raster", () => {
      for (const input of inputs) {
        expect(adapter.supports("decode", input, "raster")).toBe(true);
      }
    });

    it("rejects decode for a non-decodable format", () => {
      expect(adapter.supports("decode", "pdf", "raster")).toBe(false);
    });

    it("rejects decode with a non-raster output", () => {
      expect(adapter.supports("decode", "png", "jpg")).toBe(false);
    });

    it("accepts encode for raster -> an encodable format", () => {
      for (const output of outputs) {
        expect(adapter.supports("encode", "raster", output)).toBe(true);
      }
    });

    it("rejects encode with a non-raster input", () => {
      expect(adapter.supports("encode", "png", "jpg")).toBe(false);
    });

    it("rejects encode with a non-encodable output", () => {
      expect(adapter.supports("encode", "raster", "gif")).toBe(false);
    });

    it("accepts resize/rotate/crop for raster -> raster", () => {
      for (const op of ["resize", "rotate", "crop"] as const) {
        expect(adapter.supports(op, "raster", "raster")).toBe(true);
      }
    });

    it("rejects resize/rotate/crop with a non-raster side", () => {
      expect(adapter.supports("resize", "png", "raster")).toBe(false);
      expect(adapter.supports("crop", "raster", "png")).toBe(false);
    });

    it("rejects an unsupported output format", () => {
      expect(adapter.supports("transcode", "png", "gif")).toBe(false);
    });
  });

  describe("run", () => {
    const roundTrips: readonly (readonly [FormatId, FormatId])[] = [
      ["png", "jpg"],
      ["png", "webp"],
      ["jpg", "png"],
      ["webp", "png"],
    ];

    it.each(roundTrips)(
      "%s to %s produces correct magic bytes and dimensions",
      async (from, to) => {
        const instance = await adapter.load({
          baseUrl: "",
          capabilities: {} as never,
        });
        const srcBlob = await sourceImage(
          FORMATS[from].mime as "image/png" | "image/jpeg" | "image/webp",
        );
        const result = await instance.run(
          baseTask({
            input: { kind: "blob", blob: srcBlob },
            inputFormat: from,
            outputFormat: to,
          }),
        );
        if (result.kind !== "bytes") throw new Error("expected bytes result");
        expect(sniffFormat(new Uint8Array(result.bytes))).toBe(to);

        const outBitmap = await createImageBitmap(
          new Blob([result.bytes], { type: result.mime }),
        );
        expect(outBitmap.width).toBe(WIDTH);
        expect(outBitmap.height).toBe(HEIGHT);
        outBitmap.close();
      },
    );

    it("fills a transparent pixel white, not black, when encoding to jpg", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const srcBlob = await sourceImage("image/png");
      const result = await instance.run(
        baseTask({
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "png",
          outputFormat: "jpg",
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");

      const outBitmap = await createImageBitmap(
        new Blob([result.bytes], { type: result.mime }),
      );
      const canvas = new OffscreenCanvas(outBitmap.width, outBitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context in test verification");
      ctx.drawImage(outBitmap, 0, 0);
      outBitmap.close();

      const { data } = ctx.getImageData(0, 0, 1, 1);
      // JPEG's DCT and chroma subsampling mean the decoded pixel is rarely
      // exactly 255 — allow a small tolerance rather than an exact match.
      expect(data[0]).toBeGreaterThan(240);
      expect(data[1]).toBeGreaterThan(240);
      expect(data[2]).toBeGreaterThan(240);
    });

    it("produces a smaller jpg at lower quality", async () => {
      const instance = await adapter.load({
        baseUrl: "",
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
      const srcBlob = await canvas.convertToBlob({ type: "image/png" });

      const low = await instance.run(
        baseTask({
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "png",
          outputFormat: "jpg",
          options: { quality: 0.1 },
        }),
      );
      const high = await instance.run(
        baseTask({
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "png",
          outputFormat: "jpg",
          options: { quality: 0.95 },
        }),
      );
      if (low.kind !== "bytes" || high.kind !== "bytes") {
        throw new Error("expected bytes results");
      }
      expect(low.bytes.byteLength).toBeLessThan(high.bytes.byteLength);
    });

    it("accepts a bytes input", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const srcBlob = await sourceImage("image/png");
      const bytes = await srcBlob.arrayBuffer();
      const result = await instance.run(
        baseTask({
          input: { kind: "bytes", bytes },
          inputFormat: "png",
          outputFormat: "png",
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected bytes result");
      expect(sniffFormat(new Uint8Array(result.bytes))).toBe("png");
    });

    it("throws EngineError('aborted') when the signal is already aborted", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const controller = new AbortController();
      controller.abort();
      const srcBlob = await sourceImage("image/png");

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
        baseUrl: "",
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

  describe("decode / encode", () => {
    it("round-trips: decode a real format to raster, then encode raster back to bytes", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const srcBlob = await sourceImage("image/png");

      const decoded = await instance.run(
        baseTask({
          op: "decode",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "png",
          outputFormat: "raster",
        }),
      );
      if (decoded.kind !== "raster")
        throw new Error("expected a raster result");
      expect(decoded.image.width).toBe(WIDTH);
      expect(decoded.image.height).toBe(HEIGHT);
      expect(decoded.image.data.length).toBe(WIDTH * HEIGHT * 4);

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

      const outBitmap = await createImageBitmap(
        new Blob([encoded.bytes], { type: encoded.mime }),
      );
      expect(outBitmap.width).toBe(WIDTH);
      expect(outBitmap.height).toBe(HEIGHT);
      outBitmap.close();
    });

    it("encode fills a transparent pixel white, not black, for jpg", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const srcBlob = await sourceImage("image/png");
      const decoded = await instance.run(
        baseTask({
          op: "decode",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "png",
          outputFormat: "raster",
        }),
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

      const outBitmap = await createImageBitmap(
        new Blob([encoded.bytes], { type: encoded.mime }),
      );
      const canvas = new OffscreenCanvas(outBitmap.width, outBitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context in test verification");
      ctx.drawImage(outBitmap, 0, 0);
      outBitmap.close();

      const { data } = ctx.getImageData(0, 0, 1, 1);
      expect(data[0]).toBeGreaterThan(240);
      expect(data[1]).toBeGreaterThan(240);
      expect(data[2]).toBeGreaterThan(240);
    });

    it("encode honors a custom background color for jpg", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const srcBlob = await sourceImage("image/png");
      const decoded = await instance.run(
        baseTask({
          op: "decode",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "png",
          outputFormat: "raster",
        }),
      );
      if (decoded.kind !== "raster")
        throw new Error("expected a raster result");

      const encoded = await instance.run(
        baseTask({
          op: "encode",
          input: { kind: "raster", image: decoded.image },
          inputFormat: "raster",
          outputFormat: "jpg",
          options: { background: "#000000" },
        }),
      );
      if (encoded.kind !== "bytes") throw new Error("expected a bytes result");

      const outBitmap = await createImageBitmap(
        new Blob([encoded.bytes], { type: encoded.mime }),
      );
      const canvas = new OffscreenCanvas(outBitmap.width, outBitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context in test verification");
      ctx.drawImage(outBitmap, 0, 0);
      outBitmap.close();

      const { data } = ctx.getImageData(0, 0, 1, 1);
      expect(data[0]).toBeLessThan(30);
      expect(data[1]).toBeLessThan(30);
      expect(data[2]).toBeLessThan(30);
    });
  });

  describe("resize", () => {
    it("fit=contain (default) scales down to fit within the box, preserving aspect ratio", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const image = await rasterOf(100, 50);

      const result = await instance.run(
        baseTask({
          op: "resize",
          input: { kind: "raster", image },
          inputFormat: "raster",
          outputFormat: "raster",
          options: { width: 50, height: 50 },
        }),
      );
      if (result.kind !== "raster") throw new Error("expected a raster result");
      expect(result.image.width).toBe(50);
      expect(result.image.height).toBe(25);
    });

    it("fit=cover scales to cover the box, preserving aspect ratio", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const image = await rasterOf(100, 50);

      const result = await instance.run(
        baseTask({
          op: "resize",
          input: { kind: "raster", image },
          inputFormat: "raster",
          outputFormat: "raster",
          options: { width: 50, height: 50, fit: "cover" },
        }),
      );
      if (result.kind !== "raster") throw new Error("expected a raster result");
      expect(result.image.width).toBe(100);
      expect(result.image.height).toBe(50);
    });

    it("never upscales past the source size unless allowUpscale is set", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const image = await rasterOf(20, 20);

      const clamped = await instance.run(
        baseTask({
          op: "resize",
          input: { kind: "raster", image },
          inputFormat: "raster",
          outputFormat: "raster",
          options: { width: 100, height: 100 },
        }),
      );
      if (clamped.kind !== "raster")
        throw new Error("expected a raster result");
      expect(clamped.image.width).toBe(20);
      expect(clamped.image.height).toBe(20);

      const upscaled = await instance.run(
        baseTask({
          op: "resize",
          input: { kind: "raster", image },
          inputFormat: "raster",
          outputFormat: "raster",
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
        baseUrl: "",
        capabilities: {} as never,
      });
      const image = await rasterOf(40, 30);

      const result = await instance.run(
        baseTask({
          op: "resize",
          input: { kind: "raster", image },
          inputFormat: "raster",
          outputFormat: "raster",
          options: {},
        }),
      );
      if (result.kind !== "raster") throw new Error("expected a raster result");
      expect(result.image.width).toBe(40);
      expect(result.image.height).toBe(30);
    });
  });

  describe("rotate", () => {
    it("90 degrees swaps width/height and moves the top-left pixel to the top-right", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const width = 4;
      const height = 2;
      const image = await rasterOf(width, height);

      const result = await instance.run(
        baseTask({
          op: "rotate",
          input: { kind: "raster", image },
          inputFormat: "raster",
          outputFormat: "raster",
          options: { rotate: 90 },
        }),
      );
      if (result.kind !== "raster") throw new Error("expected a raster result");
      expect(result.image.width).toBe(height);
      expect(result.image.height).toBe(width);

      // A 90-degree clockwise rotation moves the marker pixel from the
      // source's top-left corner to the rotated image's top-right corner.
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
      const corner = ctx.getImageData(result.image.width - 1, 0, 1, 1).data;
      expect(corner[0]).toBeGreaterThan(200); // red marker
      expect(corner[2]).toBeLessThan(100); // not the blue background
    });

    it("0 degrees passes through unchanged", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const image = await rasterOf(10, 6);

      const result = await instance.run(
        baseTask({
          op: "rotate",
          input: { kind: "raster", image },
          inputFormat: "raster",
          outputFormat: "raster",
          options: { rotate: 0 },
        }),
      );
      if (result.kind !== "raster") throw new Error("expected a raster result");
      expect(result.image.width).toBe(10);
      expect(result.image.height).toBe(6);
    });
  });

  describe("crop", () => {
    it("crops to the given rect, clamped to the source bounds", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const image = await rasterOf(20, 20);

      const result = await instance.run(
        baseTask({
          op: "crop",
          input: { kind: "raster", image },
          inputFormat: "raster",
          outputFormat: "raster",
          options: { crop: { x: 5, y: 5, width: 100, height: 100 } },
        }),
      );
      if (result.kind !== "raster") throw new Error("expected a raster result");
      expect(result.image.width).toBe(15); // clamped: 20 source - 5 offset
      expect(result.image.height).toBe(15);
    });

    it("passes through unchanged when no crop is given", async () => {
      const instance = await adapter.load({
        baseUrl: "",
        capabilities: {} as never,
      });
      const image = await rasterOf(20, 12);

      const result = await instance.run(
        baseTask({
          op: "crop",
          input: { kind: "raster", image },
          inputFormat: "raster",
          outputFormat: "raster",
          options: {},
        }),
      );
      if (result.kind !== "raster") throw new Error("expected a raster result");
      expect(result.image.width).toBe(20);
      expect(result.image.height).toBe(12);
    });
  });
});
