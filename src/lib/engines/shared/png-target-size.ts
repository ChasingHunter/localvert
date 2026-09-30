/**
 * PNG target-size/percent search (ADR-0017): PNG has no continuous quality
 * knob, so hitting a byte budget means stepping the palette size down
 * instead — 256 -> 128 -> 64 -> 32 -> 16 distinct colours, re-encoding
 * (oxipng repack included) at each step and stopping at the first that fits.
 * Environment-neutral (no DOM, no wasm): `quantize` and `encode` are opaque
 * closures the caller supplies (real ones call into image-q and
 * jSquash/oxipng), so this is unit-tested directly in Node with fakes,
 * mirroring `target-size.ts` and `best-quality-search.ts`.
 */

/** The palette sizes tried, in order, per ADR-0017 ("256 → 128 → 64 → 32 →
 * 16"). A caller whose image already has ≤256 colours (the exact-palette,
 * lossless case) never needs this — that's handled before this runs. */
export const PALETTE_STEPS: readonly number[] = [256, 128, 64, 32, 16];

export interface PngTargetSizeResult<TRaster> {
  bytes: ArrayBuffer;
  raster: TRaster;
  /** The palette size that produced `bytes`, or `undefined` if no
   * quantization was needed (shouldn't happen via `searchPngTargetSize` —
   * present for API symmetry with other search results). */
  colors?: number;
  ssim: number;
  hitTarget: boolean;
  /** True once every step's SSIM fell under the lossy-palette floor
   * (0.998, ADR-0017) — signals "this photo can't get small enough as a
   * PNG" so the caller's note can suggest JPG/WebP instead. */
  unreachableQuality: boolean;
}

const LOSSY_SSIM_FLOOR = 0.998;

/**
 * Steps `PALETTE_STEPS` down from 256 colours, quantizing + encoding at each
 * step, until either the output fits `targetBytes` (returned immediately —
 * no point quantizing further once the budget's met) or every step has been
 * tried. A step whose SSIM against the original raster falls below
 * `LOSSY_SSIM_FLOOR` is skipped (ADR-0017: "a lossy palette only if
 * SSIM >= 0.998") — its output is never returned, since a smaller-but-ruined
 * image isn't a usable result for a photo-like PNG.
 *
 * `quantize(colors)` reduces `original` to at most `colors` distinct
 * colours (a raster of the caller's `TRaster` type); `encode(raster)`
 * produces the final PNG bytes (including any oxipng repack).
 */
export async function searchPngTargetSize<TRaster>(
  original: TRaster,
  quantize: (colors: number) => Promise<TRaster>,
  encode: (raster: TRaster) => Promise<ArrayBuffer>,
  computeSsim: (a: TRaster, b: TRaster) => number,
  targetBytes: number,
  signal?: AbortSignal,
): Promise<PngTargetSizeResult<TRaster>> {
  signal?.throwIfAborted();

  let best: PngTargetSizeResult<TRaster> | undefined;
  let anyUsable = false;

  for (const colors of PALETTE_STEPS) {
    const raster = await quantize(colors);
    signal?.throwIfAborted();
    const score = computeSsim(original, raster);

    if (score < LOSSY_SSIM_FLOOR) {
      // This step (and every smaller palette after it, which can only look
      // worse) is unusable — stop rather than keep shrinking a ruined image.
      break;
    }
    anyUsable = true;

    const bytes = await encode(raster);
    signal?.throwIfAborted();

    const candidate: PngTargetSizeResult<TRaster> = {
      bytes,
      raster,
      colors,
      ssim: score,
      hitTarget: bytes.byteLength <= targetBytes,
      unreachableQuality: false,
    };

    // Always keep the smallest-so-far as the fallback "closest we got"
    // result, in case nothing hits the target.
    if (!best || bytes.byteLength < best.bytes.byteLength) {
      best = candidate;
    }

    if (candidate.hitTarget) {
      return candidate;
    }
  }

  if (best) {
    return { ...best, unreachableQuality: !anyUsable };
  }

  // Nothing was usable at all — even the least-aggressive step (256 colours)
  // failed the SSIM floor. Fall back to that first step's own (unusable but
  // real) output so the caller always has *something* to report against,
  // flagged as unreachable.
  const raster = await quantize(PALETTE_STEPS[0] ?? 256);
  const bytes = await encode(raster);
  return {
    bytes,
    raster,
    colors: PALETTE_STEPS[0],
    ssim: computeSsim(original, raster),
    hitTarget: false,
    unreachableQuality: true,
  };
}
