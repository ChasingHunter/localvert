import { applyPaletteSync, buildPaletteSync, utils } from "image-q";
import type { RasterImage } from "../types";

const { PointContainer } = utils;

/**
 * `compress-png`'s `smaller` mode (ADR-0013): reduces a raster to at most
 * `colors` distinct colours before oxipng gets it — image-q is pure JS (no
 * wasm, no DOM), so this is unit-tested directly in Node
 * (`palette-quantize.test.ts`). This only reduces colour count; it doesn't
 * write a PNG palette (PLTE) chunk itself — the `jsquash-png` adapter's own
 * `encodePng` + oxipng pass (run by the caller afterwards) picks an indexed
 * encoding automatically once the colour count is low enough for that to be
 * smaller.
 */
export interface QuantizeOptions {
  /** Max distinct colours in the output. Default 256 — the most a PNG's own
   * palette chunk can hold. */
  colors?: number;
  /** Default true. Off produces flatter, sometimes banded results for a
   * simpler (often marginally smaller) image; on (Floyd-Steinberg error
   * diffusion) trades a slightly larger file for less visible banding. */
  dither?: boolean;
}

/** RGBA raster -> RGBA raster with at most `options.colors` distinct
 * colours, same width/height. Wu quantization (image-q's `wuquant` palette
 * builder) picks the palette; `applyPaletteSync` maps every source pixel to
 * it, dithered or not per `options.dither`. */
export function quantizeToPalette(
  image: RasterImage,
  options: QuantizeOptions = {},
): RasterImage {
  const colors = options.colors ?? 256;
  const dither = options.dither ?? true;

  const container = PointContainer.fromUint8Array(
    image.data,
    image.width,
    image.height,
  );
  const palette = buildPaletteSync([container], {
    colors,
    paletteQuantization: "wuquant",
  });
  const applied = applyPaletteSync(container, palette, {
    imageQuantization: dither ? "floyd-steinberg" : "nearest",
  });

  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(applied.toUint8Array()),
  };
}
