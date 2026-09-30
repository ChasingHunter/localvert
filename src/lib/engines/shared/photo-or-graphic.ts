/**
 * ADR-0017's encoder-settings heuristic: mozjpeg should chroma-subsample
 * 4:2:0 for photos but 4:4:4 for graphics/text (thin coloured edges lose
 * saturation and legibility under 4:2:0), and WebP's `use_sharp_yuv` helps
 * the same graphics case. Distinguishing the two without a classifier: count
 * distinct colours on a small downscaled copy (photos have thousands even at
 * low resolution; flat-colour graphics and screenshots have relatively few),
 * combined with edge density (graphics/text have more hard, high-contrast
 * edges relative to their colour count than a photo's soft gradients do).
 *
 * This is a cheap heuristic, not a real classifier — it's meant to bias two
 * encoder knobs sensibly, not to be perfectly accurate. Pure TS (no DOM, no
 * wasm) so it's unit-tested directly in Node.
 */

export interface RasterLike {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export type ImageKind = "photo" | "graphic";

/** Distinct-colour count above this (on the downscaled sample) reads as a
 * photo regardless of edge density — a real photo routinely has thousands of
 * distinct colours even shrunk to a thumbnail. */
const PHOTO_COLOR_THRESHOLD = 4096;

/** Below this colour count, high edge density (see `edgeDensity` below)
 * tips the verdict to "graphic" — flat regions of solid colour meeting at
 * hard boundaries, the signature of UI screenshots, icons, and rendered
 * text. */
const GRAPHIC_COLOR_THRESHOLD = 512;
const GRAPHIC_EDGE_DENSITY_THRESHOLD = 0.02;

/** Downscales (nearest-sample, not area-average — this only needs a rough
 * read, not accuracy) to at most this many pixels on the long side, keeping
 * the heuristic's cost independent of the source image's resolution. */
const SAMPLE_LONG_SIDE = 128;

function sample(image: RasterLike): {
  width: number;
  height: number;
  luma: Uint8ClampedArray;
  colorKeys: Set<number>;
} {
  const { width, height, data } = image;
  const longSide = Math.max(width, height);
  const scale = longSide > SAMPLE_LONG_SIDE ? SAMPLE_LONG_SIDE / longSide : 1;
  const sw = Math.max(1, Math.round(width * scale));
  const sh = Math.max(1, Math.round(height * scale));

  const luma = new Uint8ClampedArray(sw * sh);
  const colorKeys = new Set<number>();

  for (let y = 0; y < sh; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < sw; x++) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const i = (sy * width + sx) * 4;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      luma[y * sw + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      // Quantize to 5 bits/channel before counting distinct colours — two
      // pixels that differ by 1/255 in one channel (sensor noise, dithering)
      // shouldn't count as visually distinct colours for this heuristic.
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      colorKeys.add(key);
    }
  }

  return { width: sw, height: sh, luma, colorKeys };
}

/** Fraction of sampled pixels that are a strong horizontal or vertical
 * gradient edge (simple Sobel-like difference, not a full Sobel operator —
 * this only needs a density estimate). */
function edgeDensity(
  width: number,
  height: number,
  luma: Uint8ClampedArray,
): number {
  if (width < 2 || height < 2) return 0;
  let edgeCount = 0;
  let total = 0;
  const threshold = 40; // Luma delta considered a "hard" edge.

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const center = luma[y * width + x] ?? 0;
      const right =
        x + 1 < width ? (luma[y * width + x + 1] ?? center) : center;
      const down =
        y + 1 < height ? (luma[(y + 1) * width + x] ?? center) : center;
      const delta = Math.max(Math.abs(center - right), Math.abs(center - down));
      if (delta >= threshold) edgeCount++;
      total++;
    }
  }
  return total > 0 ? edgeCount / total : 0;
}

/**
 * Classifies a raster as `"photo"` or `"graphic"` for encoder-settings
 * purposes. See the file doc comment for the thresholds' reasoning.
 */
export function classifyImageKind(image: RasterLike): ImageKind {
  const { width, height, luma, colorKeys } = sample(image);
  const colorCount = colorKeys.size;

  if (colorCount >= PHOTO_COLOR_THRESHOLD) return "photo";
  if (colorCount <= GRAPHIC_COLOR_THRESHOLD) {
    const density = edgeDensity(width, height, luma);
    if (density >= GRAPHIC_EDGE_DENSITY_THRESHOLD) return "graphic";
  }
  return "photo";
}
