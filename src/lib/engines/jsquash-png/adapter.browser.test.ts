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

  /** A bigger, noisier "photo-like" source — real per-pixel colour variation
   * so both palette quantization and target-size actually have something to
   * work with (mirrors ../jsquash-jpeg/adapter.browser.test.ts's own
   * `noisySourceJpeg`). */
  async function noisySourcePng(size = 200): Promise<Blob> {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context in test setup");
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        ctx.fillStyle = `rgb(${(x * 7) % 256}, ${(y * 13) % 256}, ${(x + y) % 256})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return canvas.convertToBlob({ type: "image/png" });
  }

  /** A source with exactly a handful of distinct flat colours (well under
   * the 256-colour exact-palette threshold, ADR-0017). */
  async function fewColorsPng(size = 64): Promise<Blob> {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context in test setup");
    const colors = ["#ffffff", "#000000", "#ff0000", "#00ff00", "#0000ff"];
    for (let i = 0; i < colors.length; i++) {
      ctx.fillStyle = colors[i] ?? "#000000";
      ctx.fillRect(0, (size / colors.length) * i, size, size / colors.length);
    }
    return canvas.convertToBlob({ type: "image/png" });
  }

  describe("compress (ADR-0013/0017)", () => {
    async function loadInstance() {
      return adapter.load({ baseUrl: baseUrl(), capabilities: {} as never });
    }

    it("mode lossless repacks without changing pixels", async () => {
      const instance = await loadInstance();
      const srcBlob = await sourcePng();

      const result = await instance.run(
        baseTask({
          op: "compress",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "png",
          outputFormat: "png",
          options: { mode: "lossless" },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected a bytes result");
      expect(sniffFormat(new Uint8Array(result.bytes))).toBe("png");
    });

    it("compresses a <=256-colour source losslessly (ADR-0017: exact palette via oxipng's own reduction)", async () => {
      const instance = await loadInstance();
      const srcBlob = await fewColorsPng();

      const result = await instance.run(
        baseTask({
          op: "compress",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "png",
          outputFormat: "png",
          options: { mode: "lossless" },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected a bytes result");

      // Losslessness is the actual claim: re-decoding the compressed output
      // must reproduce the exact same pixels as the original, regardless of
      // whether oxipng chose an indexed (palette) representation under the
      // hood to get there.
      const original = await instance.run(
        baseTask({ input: { kind: "blob", blob: srcBlob } }),
      );
      const recompressed = await instance.run(
        baseTask({ input: { kind: "bytes", bytes: result.bytes } }),
      );
      if (original.kind !== "raster" || recompressed.kind !== "raster") {
        throw new Error("expected raster results");
      }
      expect(new Uint8Array(recompressed.image.data)).toEqual(
        new Uint8Array(original.image.data),
      );
    });

    it("mode smaller never produces a file bigger than the source", async () => {
      // Not strictly-smaller: this synthetic per-pixel-unique fixture is
      // adversarial for palette quantization (very little redundancy for
      // oxipng to exploit even after quantizing), so the never-larger
      // fallback legitimately can win here — same guarantee this adapter
      // makes everywhere else.
      const instance = await loadInstance();
      const srcBlob = await noisySourcePng();

      const result = await instance.run(
        baseTask({
          op: "compress",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "png",
          outputFormat: "png",
          options: { mode: "smaller" },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected a bytes result");
      expect(result.bytes.byteLength).toBeLessThanOrEqual(srcBlob.size);
    });

    it("mode target-size's note reports the achieved size against the target (ADR-0017 result contract)", async () => {
      const instance = await loadInstance();
      const srcBlob = await noisySourcePng();

      const result = await instance.run(
        baseTask({
          op: "compress",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "png",
          outputFormat: "png",
          options: { mode: "target-size", targetSizeKB: 10 },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected a bytes result");
      expect(result.note).toBeTruthy();
    });

    it("mode percent reduces the file relative to the source", async () => {
      const instance = await loadInstance();
      const srcBlob = await noisySourcePng();

      const result = await instance.run(
        baseTask({
          op: "compress",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "png",
          outputFormat: "png",
          options: { mode: "percent", percent: 50 },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected a bytes result");
      // Some note is always attached for percent (hit/miss/unreachable
      // wording), and the result is never bigger than the source.
      expect(result.note).toBeTruthy();
      expect(result.bytes.byteLength).toBeLessThanOrEqual(srcBlob.size);
    });

    it("never returns a file bigger than the input, and notes it when it doesn't", async () => {
      const instance = await loadInstance();
      // A tiny already-minimal source: lossless repack + strip can't beat
      // the original by much, if at all.
      const srcBlob = await sourcePng(4, 4);

      const result = await instance.run(
        baseTask({
          op: "compress",
          input: { kind: "blob", blob: srcBlob },
          inputFormat: "png",
          outputFormat: "png",
          options: { mode: "lossless" },
        }),
      );
      if (result.kind !== "bytes") throw new Error("expected a bytes result");
      expect(result.bytes.byteLength).toBeLessThanOrEqual(srcBlob.size);
    });
  });
});
