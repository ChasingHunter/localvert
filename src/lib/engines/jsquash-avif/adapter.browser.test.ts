import { describe, expect, it } from "vitest";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import { sniffFormat } from "@/lib/registry";
import { isEngineError } from "../errors";
import type { EngineTask, RasterImage } from "../types";
import adapter from "./adapter";

const BASE_URL = ENGINE_MANIFEST["jsquash-avif"].baseUrl;
// Small and square — avif encode/decode is the heaviest codec in this
// pipeline, so tests stay quick even with the generous per-test timeout
// below.
const WIDTH = 16;
const HEIGHT = 16;
// avif encode/decode compiles a multi-megabyte wasm module on first use —
// well past vitest's 5s default in a cold browser worker.
const TIMEOUT = 30_000;

/** Builds a `RasterImage` directly with OffscreenCanvas + getImageData — no
 * fixture files, no network. A 1x1 red marker pixel sits at the top-left
 * corner over an otherwise solid blue fill, same shape as the other jSquash
 * adapters' tests. Browsers can decode avif but not encode it via
 * `convertToBlob` (see `../canvas/adapter.ts`'s `ENCODABLE` list, which omits
 * avif), so — unlike the jpeg/png/webp adapter tests — there is no
 * browser-native way to produce a *source* avif blob; every test here goes
 * through this engine's own encode instead. */
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

function baseTask(overrides: Partial<EngineTask> = {}): EngineTask {
  return {
    op: "encode",
    input: {
      kind: "raster",
      image: { width: 1, height: 1, data: new Uint8ClampedArray(4) },
    },
    inputFormat: "raster",
    outputFormat: "avif",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("jsquash-avif adapter", () => {
  it("carries the metadata defineEngine validated", () => {
    expect(adapter.id).toBe("jsquash-avif");
    expect(adapter.marker).toBe("localvert-engine:jsquash-avif");
    expect(adapter.version).toBe("2.1.1");
    expect(adapter.heavy).toBe(true);
    expect(adapter.needsIsolation).toBe(false);
  });

  describe("supports", () => {
    it("accepts decode for avif -> raster", () => {
      expect(adapter.supports("decode", "avif", "raster")).toBe(true);
    });

    it("rejects decode for a non-avif input", () => {
      expect(adapter.supports("decode", "png", "raster")).toBe(false);
    });

    it("rejects decode with a non-raster output", () => {
      expect(adapter.supports("decode", "avif", "jpg")).toBe(false);
    });

    it("accepts encode for raster -> avif", () => {
      expect(adapter.supports("encode", "raster", "avif")).toBe(true);
    });

    it("rejects encode with a non-raster input", () => {
      expect(adapter.supports("encode", "avif", "avif")).toBe(false);
    });

    it("rejects encode with a non-avif output", () => {
      expect(adapter.supports("encode", "raster", "png")).toBe(false);
    });

    it("rejects an unrelated op", () => {
      expect(adapter.supports("resize", "raster", "raster")).toBe(false);
      expect(adapter.supports("transcode", "avif", "avif")).toBe(false);
    });
  });

  describe("encode / decode", () => {
    it(
      "encodes to correct avif magic bytes and dimensions",
      async () => {
        const instance = await adapter.load({
          baseUrl: BASE_URL,
          capabilities: {} as never,
        });
        const image = await rasterOf(WIDTH, HEIGHT);

        const result = await instance.run(
          baseTask({ input: { kind: "raster", image } }),
        );
        if (result.kind !== "bytes") throw new Error("expected a bytes result");
        expect(sniffFormat(new Uint8Array(result.bytes))).toBe("avif");
        expect(result.mime).toBe("image/avif");
      },
      TIMEOUT,
    );

    it(
      "round-trips lossless encode -> decode pixel-exact",
      async () => {
        const instance = await adapter.load({
          baseUrl: BASE_URL,
          capabilities: {} as never,
        });
        const image = await rasterOf(WIDTH, HEIGHT);

        const encoded = await instance.run(
          baseTask({
            input: { kind: "raster", image },
            options: { lossless: true },
          }),
        );
        if (encoded.kind !== "bytes")
          throw new Error("expected a bytes result");

        const decoded = await instance.run(
          baseTask({
            op: "decode",
            input: { kind: "bytes", bytes: encoded.bytes },
            inputFormat: "avif",
            outputFormat: "raster",
          }),
        );
        if (decoded.kind !== "raster")
          throw new Error("expected a raster result");

        expect(decoded.image.width).toBe(WIDTH);
        expect(decoded.image.height).toBe(HEIGHT);
        expect(Array.from(decoded.image.data)).toEqual(Array.from(image.data));
      },
      TIMEOUT,
    );

    it(
      "produces a smaller lossy avif at lower quality",
      async () => {
        const instance = await adapter.load({
          baseUrl: BASE_URL,
          capabilities: {} as never,
        });
        // A bigger, noisier source so quality actually changes byte size.
        const size = 64;
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
            input: { kind: "raster", image },
            options: { quality: 0.1 },
          }),
        );
        const high = await instance.run(
          baseTask({
            input: { kind: "raster", image },
            options: { quality: 0.9 },
          }),
        );
        if (low.kind !== "bytes" || high.kind !== "bytes") {
          throw new Error("expected bytes results");
        }
        expect(low.bytes.byteLength).toBeLessThan(high.bytes.byteLength);
      },
      TIMEOUT,
    );

    it(
      "throws EngineError('decode-failed') on garbage bytes",
      async () => {
        const instance = await adapter.load({
          baseUrl: BASE_URL,
          capabilities: {} as never,
        });
        const garbage = new Uint8Array([1, 2, 3, 4, 5]).buffer;

        await expect(
          instance.run(
            baseTask({
              op: "decode",
              input: { kind: "bytes", bytes: garbage },
              inputFormat: "avif",
              outputFormat: "raster",
            }),
          ),
        ).rejects.toSatisfy(
          (e: unknown) => isEngineError(e) && e.code === "decode-failed",
        );
      },
      TIMEOUT,
    );

    it(
      "throws EngineError('aborted') when the signal is already aborted",
      async () => {
        const instance = await adapter.load({
          baseUrl: BASE_URL,
          capabilities: {} as never,
        });
        const controller = new AbortController();
        controller.abort();
        const image = await rasterOf(4, 4);

        await expect(
          instance.run(
            baseTask({
              input: { kind: "raster", image },
              signal: controller.signal,
            }),
          ),
        ).rejects.toSatisfy(
          (e: unknown) => isEngineError(e) && e.code === "aborted",
        );
      },
      TIMEOUT,
    );
  });
});
