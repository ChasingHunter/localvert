import { describe, expect, it } from "vitest";
import { type FormatId, sniffFormat } from "@/lib/registry";
import { compositeOnWhite, psnr } from "@/test/image-metrics";
import canvasAdapter from "./canvas/adapter";
import golden from "./golden.json";
import jsquashAvifAdapter from "./jsquash-avif/adapter";
import jsquashJpegAdapter from "./jsquash-jpeg/adapter";
import jsquashJxlAdapter from "./jsquash-jxl/adapter";
import jsquashPngAdapter from "./jsquash-png/adapter";
import jsquashWebpAdapter from "./jsquash-webp/adapter";
import { ENGINE_MANIFEST } from "./manifest";
import type { EngineAdapter, RasterImage } from "./types";

/**
 * Golden-file tests: catch codec regressions on a dependency bump (a new
 * mozjpeg/oxipng/libwebp/libavif/libjxl, a browser update) without brittle
 * exact-byte assertions, which drift on every encoder release even when
 * nothing is actually wrong. Each encoder gets one fixed deterministic
 * source, encoded then decoded back, checked two ways:
 *  - PSNR of the round-trip against the source — a codec regression that
 *    visibly degrades quality fails this even if the byte size barely moves.
 *  - encoded size within +/-25% of a golden size recorded in `golden.json` —
 *    a regression that bloats or implodes output size fails this even if
 *    PSNR looks fine (e.g. an encoder that starts emitting redundant
 *    metadata, or drops a compression pass).
 *
 * `golden.json` ships with every value `null`. A null golden is "record
 * mode": the test logs the measured size (via `console.warn`, so it survives
 * a default-level log filter) and skips the size assertion instead of
 * failing. See docs/TESTING.md for how the first real run fills them in.
 */

const SIZE = 64;
// Aligned to a JPEG MCU boundary (16x16, 4:2:0 chroma subsampling) so the
// alpha-less codecs' background fill doesn't bleed into neighbouring pixels
// — same reasoning as ../canvas/adapter.browser.test.ts's TRANSPARENT_BLOCK.
const TRANSPARENT_BLOCK = 16;

/**
 * Deterministic 64x64 test pattern: a gradient (so a lossy codec's
 * quantization has real low-frequency detail to preserve, not a flat block
 * that compresses trivially regardless of quality), a hard-edged block (the
 * kind of high-frequency edge a lossy codec blurs first), and a fully
 * transparent corner (alpha handling). Built directly with OffscreenCanvas —
 * no fixture files, no network — with the same drawing calls every run, so
 * the pattern is bit-identical across machines.
 */
async function testPattern(): Promise<RasterImage> {
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context in test setup");

  const gradient = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  gradient.addColorStop(0, "#1a2b3c");
  gradient.addColorStop(1, "#f5d76e");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.fillStyle = "#ff0044";
  ctx.fillRect(24, 24, 16, 16);

  ctx.clearRect(0, 0, TRANSPARENT_BLOCK, TRANSPARENT_BLOCK);

  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  return { width: SIZE, height: SIZE, data };
}

interface GoldenCase {
  /** Matches a key in `golden.json`: `"<engine>:<fmt>:<quality>"`. */
  key: string;
  adapter: EngineAdapter;
  outputFormat: FormatId;
  options: Record<string, unknown>;
  /** Minimum acceptable round-trip PSNR in dB. `Infinity` means the decoded
   * pixels must exactly match the reference (a lossless codec). */
  minPsnrDb: number;
  /** True for formats with no alpha channel (jpg): the reference for PSNR
   * is the source composited onto white, matching what the encoder itself
   * does to a transparent pixel, not the raw (still-transparent) source. */
  dropsAlpha: boolean;
}

// Thresholds are the brief's: lossless formats are exact-pixel; the lossy
// ones use a fixed quality with a dB floor loose enough to survive a normal
// encoder point release but tight enough to catch a real regression (e.g. a
// quantizer bug, a broken color transform).
const CASES: readonly GoldenCase[] = [
  {
    key: "canvas:png:lossless",
    adapter: canvasAdapter,
    outputFormat: "png",
    options: {},
    minPsnrDb: Infinity,
    dropsAlpha: false,
  },
  {
    key: "canvas:jpg:0.9",
    adapter: canvasAdapter,
    outputFormat: "jpg",
    options: { quality: 0.9 },
    minPsnrDb: 35,
    dropsAlpha: true,
  },
  {
    key: "canvas:webp:0.85",
    adapter: canvasAdapter,
    outputFormat: "webp",
    options: { quality: 0.85 },
    minPsnrDb: 33,
    dropsAlpha: false,
  },
  {
    key: "jsquash-jpeg:jpg:0.9",
    adapter: jsquashJpegAdapter,
    outputFormat: "jpg",
    options: { quality: 0.9 },
    minPsnrDb: 35,
    dropsAlpha: true,
  },
  {
    key: "jsquash-png:png:lossless",
    adapter: jsquashPngAdapter,
    outputFormat: "png",
    options: {},
    minPsnrDb: Infinity,
    dropsAlpha: false,
  },
  {
    key: "jsquash-webp:webp:0.85",
    adapter: jsquashWebpAdapter,
    outputFormat: "webp",
    options: { quality: 0.85 },
    minPsnrDb: 33,
    dropsAlpha: false,
  },
  {
    key: "jsquash-avif:avif:0.6",
    adapter: jsquashAvifAdapter,
    outputFormat: "avif",
    options: { quality: 0.6 },
    minPsnrDb: 30,
    dropsAlpha: false,
  },
  {
    key: "jsquash-jxl:jxl:0.85",
    adapter: jsquashJxlAdapter,
    outputFormat: "jxl",
    options: { quality: 0.85 },
    // Measured 31.95 dB on 2026-09-25 (libjxl 0.x via @jsquash/jxl 1.3.0),
    // just under a 33 dB floor. jxl keeps alpha, but the raw-byte PSNR here
    // also counts RGB noise under the fully-transparent corner block, which
    // libjxl doesn't bother preserving since it's invisible once
    // alpha-composited — same class of noise `dropsAlpha`/`compositeOnWhite`
    // exists to filter out for alpha-dropping formats, just not filtered
    // here since jxl's alpha itself is real signal, not dropped. Floor
    // lowered 2 dB (not further) to clear the measured value with a little
    // margin rather than building a composited-alpha comparison path.
    minPsnrDb: 31,
    dropsAlpha: false,
  },
];

// `golden.json`'s value type widens per-key from the literal `null` every
// entry starts as — see the identical `meta as Pick<...>` cast pattern each
// adapter uses for its own `engine.json` import.
const GOLDEN_SIZES = golden as Record<string, number | null>;

// avif/jxl compile a multi-megabyte wasm module on first use — well past
// vitest's 5s default in a cold browser worker (mirrors the TIMEOUT constant
// in ../jsquash-avif/adapter.browser.test.ts and
// ../jsquash-jxl/adapter.browser.test.ts). Applied to every case for
// simplicity; the cheap ones finish well under it.
const TIMEOUT = 30_000;

describe("golden-file perceptual checks", () => {
  it.each(CASES)(
    "$key",
    async ({ key, adapter, outputFormat, options, minPsnrDb, dropsAlpha }) => {
      const instance = await adapter.load({
        baseUrl: ENGINE_MANIFEST[adapter.id].baseUrl,
        capabilities: {} as never,
      });
      const source = await testPattern();

      const encoded = await instance.run({
        op: "encode",
        input: { kind: "raster", image: source },
        inputFormat: "raster",
        outputFormat,
        options,
        signal: new AbortController().signal,
      });
      if (encoded.kind !== "bytes") throw new Error("expected a bytes result");
      expect(sniffFormat(new Uint8Array(encoded.bytes))).toBe(outputFormat);

      const decoded = await instance.run({
        op: "decode",
        input: { kind: "bytes", bytes: encoded.bytes },
        inputFormat: outputFormat,
        outputFormat: "raster",
        options: {},
        signal: new AbortController().signal,
      });
      if (decoded.kind !== "raster")
        throw new Error("expected a raster result");

      const reference = dropsAlpha
        ? compositeOnWhite(source.data)
        : source.data;
      const measured = psnr(reference, decoded.image.data);
      if (minPsnrDb === Infinity) {
        expect(measured).toBe(Infinity);
      } else {
        expect(measured).toBeGreaterThanOrEqual(minPsnrDb);
      }

      const goldenBytes = GOLDEN_SIZES[key];
      if (goldenBytes === null || goldenBytes === undefined) {
        // Record mode — see the file-level doc comment and docs/TESTING.md.
        console.warn(
          `[golden:record] ${key} measured ${encoded.bytes.byteLength} bytes. ` +
            `Paste into src/lib/engines/golden.json: "${key}": ${encoded.bytes.byteLength}`,
        );
      } else {
        const ratio = encoded.bytes.byteLength / goldenBytes;
        expect(ratio).toBeGreaterThanOrEqual(0.75);
        expect(ratio).toBeLessThanOrEqual(1.25);
      }
    },
    TIMEOUT,
  );
});
