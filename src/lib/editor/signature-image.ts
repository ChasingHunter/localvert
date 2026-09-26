/**
 * Pure pixel-math helpers for the signature dialog (`signature-dialog.tsx`).
 * No canvas, no DOM — these operate on plain RGBA buffers so they can run
 * (and be unit-tested) in Node, unlike the canvas drawing/compositing that
 * calls them from the browser.
 */

export interface PixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Finds the bounding box of every non-transparent pixel in `data` (RGBA,
 * `width * height * 4` bytes), expanded by `padding` px on each side and
 * clamped to the image. Returns `null` when every pixel is fully transparent
 * (nothing was drawn/typed/uploaded yet) — callers should treat that as "no
 * signature to place".
 */
export function computeInkBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  padding = 0,
): PixelBounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3] ?? 0;
      if (alpha > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;

  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  const right = Math.min(width, maxX + 1 + padding);
  const bottom = Math.min(height, maxY + 1 + padding);
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Mutates `data` in place (RGBA), setting alpha to 0 for every pixel whose
 * red, green AND blue channels are all >= `threshold` — the upload tab's
 * "Remove white background" option, thresholding near-white pixels to
 * transparent rather than requiring an exact white match (scans and phone
 * photos of a signed page are rarely pure #fff).
 */
export function applyWhiteThreshold(
  data: Uint8ClampedArray,
  threshold = 245,
): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    if (r >= threshold && g >= threshold && b >= threshold) {
      data[i + 3] = 0;
    }
  }
}
