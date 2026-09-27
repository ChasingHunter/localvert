/// <reference path="../gifenc.d.ts" />
/**
 * GIF encode: `RasterImage` -> a single-frame GIF, on gifenc (MIT) — the
 * same library `mediabunny/gif.ts` uses for video-to-gif, reused here rather
 * than duplicated. No canvas/wasm involved: `quantize`/`applyPalette`/
 * `GIFEncoder` all operate on flat RGBA bytes, so this whole module is pure
 * TS and (unlike bmp/ico encode's directory-parsing pieces) needs no
 * `OffscreenCanvas` at all. Kept in its own file, same reasoning as
 * `bmp.ts`/`mediabunny/gif.ts`'s doc comments.
 *
 * Animated GIF output is out of scope (see the wave-b-image brief) — this
 * always writes exactly one frame.
 */
import { applyPalette, GIFEncoder, quantize } from "gifenc";
import type { RasterImage } from "../types";

/** Encodes a `RasterImage` as a single-frame GIF. Quantizes to at most 256
 * colors and preserves 1-bit transparency (gifenc's `oneBitAlpha`: any pixel
 * with alpha <= 127 in the quantized palette becomes fully transparent, GIF
 * having no partial-alpha concept). */
export function encodeGif(image: RasterImage): Uint8Array {
  const { data, width, height } = image;

  const palette = quantize(data, 256, {
    format: "rgba4444",
    oneBitAlpha: true,
  });
  const index = applyPalette(data, palette, "rgba4444");
  const transparentIndex = palette.findIndex((color) => color[3] === 0);

  const gif = GIFEncoder();
  gif.writeFrame(index, width, height, {
    palette,
    transparent: transparentIndex >= 0,
    transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
  });
  gif.finish();

  return gif.bytes();
}
