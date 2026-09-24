import { describe, expect, it } from "vitest";
import { FORMATS, type FormatId, sniffFormat } from "@/lib/registry";
import { isEngineError } from "../errors";
import type { EngineTask } from "../types";
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
});
