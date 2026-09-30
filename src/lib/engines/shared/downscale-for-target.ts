/**
 * ADR-0017's target-size downscale fallback: when even the lowest allowed
 * quality (30) still overshoots a byte budget, shrinking the raster is the
 * only remaining lever. Pixel count scales roughly linearly with encoded
 * size for a fixed quality (more pixels, more DCT/prediction blocks to
 * code), so scaling both dimensions by `sqrt(targetBytes / currentBytes)`
 * targets the right pixel *count* — the `* 0.95` safety margin accounts for
 * container/header overhead not scaling down with the image, and for the
 * area-vs-size relationship being an approximation, not exact.
 */

export interface DownscaleDims {
  width: number;
  height: number;
}

/** The scale factor to apply to both dimensions, per the file doc comment.
 * Never exceeds 1 (this only ever shrinks) and never goes below a small
 * floor so a pathological ratio can't collapse the image to nothing in one
 * round. */
export function computeDownscaleFactor(
  currentBytes: number,
  targetBytes: number,
): number {
  if (currentBytes <= 0 || targetBytes <= 0) return 1;
  const raw = Math.sqrt(targetBytes / currentBytes) * 0.95;
  return Math.min(1, Math.max(0.1, raw));
}

/** Applies `computeDownscaleFactor` to a source width/height, rounding to at
 * least 1px on each axis. */
export function computeDownscaleDims(
  width: number,
  height: number,
  currentBytes: number,
  targetBytes: number,
): DownscaleDims {
  const factor = computeDownscaleFactor(currentBytes, targetBytes);
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}
