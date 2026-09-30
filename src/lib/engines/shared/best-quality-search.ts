/**
 * "Best quality" perceptual search (ADR-0017), shared by `jsquash-jpeg` and
 * `jsquash-webp`'s `compress` op: instead of a single fixed quality number,
 * search for the smallest integer quality whose output still looks the same
 * as the original, measured by SSIM (`./ssim.ts`) on the decoded raster.
 * Environment-neutral (no DOM, no wasm) — the caller supplies `encode` and
 * `decode` closures, same shape as `target-size.ts`, so this is unit-tested
 * directly in Node with a fake codec.
 *
 * Method: integer-quality bisection in `[min, max]`, about 6 encodes.
 * `encode`'s output size (and therefore visible quality) is assumed
 * monotonic in `quality`, so SSIM against the original is also assumed
 * monotonic — this bisects for the smallest quality with
 * `ssim >= threshold` exactly like a boolean predicate search: if `max`
 * itself doesn't clear the threshold, that's the best available and this
 * says so via `metThreshold: false`.
 */

export interface BestQualitySearchOptions {
  /** Lower bound of the integer quality search, inclusive. */
  min: number;
  /** Upper bound of the integer quality search, inclusive — ADR-0017:
   * `min(95, source quality)`, computed by the caller (`estimateJpegQuality`
   * for JPEG; WebP has no equivalent source-quality read, so callers pass
   * 95 there). */
  max: number;
  /** SSIM threshold to meet or exceed — 0.9999 for "High quality" (the
   * default), 0.999 for "Smaller" (ADR-0017). */
  threshold: number;
  /** Most `encode`/`decode`/`ssim` rounds this makes. Default 6 (ADR-0017:
   * "about 6 bisection encodes"). */
  maxIterations?: number;
  signal?: AbortSignal;
}

export interface BestQualitySearchResult<TRaster> {
  bytes: ArrayBuffer;
  raster: TRaster;
  quality: number;
  ssim: number;
  /** False only when even `max` quality's SSIM falls short of `threshold` —
   * the search still returns `max`'s own result, the closest available. */
  metThreshold: boolean;
}

/**
 * Bisects integer `quality` in `[min, max]` for the smallest value whose
 * `ssim(original, decode(encode(quality)))` is `>= threshold`.
 *
 * `encode`/`decode` are opaque async closures (real ones call into wasm);
 * `computeSsim` is injected so Node unit tests can use a synthetic,
 * closed-form SSIM-like function instead of the real per-pixel one, while
 * production callers pass `ssim` from `./ssim.ts` directly.
 */
export async function searchBestQuality<TRaster>(
  original: TRaster,
  encode: (quality: number) => Promise<ArrayBuffer>,
  decode: (bytes: ArrayBuffer) => Promise<TRaster>,
  computeSsim: (a: TRaster, b: TRaster) => number,
  opts: BestQualitySearchOptions,
): Promise<BestQualitySearchResult<TRaster>> {
  const { min, max, threshold } = opts;
  const maxIterations = opts.maxIterations ?? 6;
  const signal = opts.signal;
  signal?.throwIfAborted();

  async function evaluate(
    quality: number,
  ): Promise<{ bytes: ArrayBuffer; raster: TRaster; ssim: number }> {
    const bytes = await encode(quality);
    signal?.throwIfAborted();
    const raster = await decode(bytes);
    signal?.throwIfAborted();
    const score = computeSsim(original, raster);
    return { bytes, raster, ssim: score };
  }

  const ceiling = await evaluate(max);
  if (ceiling.ssim < threshold) {
    // Even the top of the range doesn't meet the bar — that's the best on
    // offer, so return it and say so.
    return { ...ceiling, quality: max, metThreshold: false };
  }

  let best = { ...ceiling, quality: max };
  if (min >= max) return { ...best, metThreshold: true };

  let lo = min;
  let hi = max;
  let iterations = 1; // The ceiling probe already counted.

  while (lo < hi && iterations < maxIterations) {
    const mid = Math.round((lo + hi) / 2);
    if (mid === hi) break; // No further integers to try between lo and hi.

    const candidate = await evaluate(mid);
    iterations++;

    if (candidate.ssim >= threshold) {
      best = { ...candidate, quality: mid };
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  return { ...best, metThreshold: true };
}
