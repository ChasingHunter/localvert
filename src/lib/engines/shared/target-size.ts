/**
 * Target-file-size encoding, shared by every lossy image codec adapter that
 * exposes a `quality` knob (`jsquash-jpeg`, `jsquash-webp`, `jsquash-avif`
 * today). A tool's "Target size" option asks for a byte budget, not a
 * quality; this bisects `quality` to find the largest value whose encoded
 * output still fits that budget, re-encoding the same raster each time.
 * Environment-neutral (no DOM, no wasm) so it can be unit-tested directly in
 * Node — every adapter just supplies its own `encode(quality)` closure.
 */

export interface EncodeToTargetSizeOptions {
  /** Lower bound of the quality search, inclusive. Default 0.05. */
  min?: number;
  /** Upper bound of the quality search, inclusive. Default 0.95. */
  max?: number;
  /** Most `encode` calls this makes, including the floor probe. Default 8. */
  maxIterations?: number;
  signal?: AbortSignal;
}

export interface EncodeToTargetSizeResult {
  bytes: ArrayBuffer;
  /** The quality that produced `bytes`. */
  quality: number;
  /** False only when even `min` quality's output exceeds `targetBytes`. */
  hitTarget: boolean;
}

/**
 * Bisects `quality` in `[min, max]`, calling `encode(quality)` at most
 * `maxIterations` times, to find the largest quality whose output is
 * `<= targetBytes`. Assumes `encode`'s output size grows monotonically with
 * `quality` — true for every codec's own quality knob, and the reason a
 * single floor probe at `min` is enough to decide whether the target is
 * reachable at all: if `min` already overshoots, no higher quality can do
 * better, so bisection is skipped and that floor output is returned with
 * `hitTarget: false`. Otherwise the floor output seeds `best`, and each
 * further iteration narrows toward the largest quality that still fits,
 * always keeping the best (largest, still-fitting) result seen so far.
 *
 * `signal` is checked before the floor probe and after every `encode` call —
 * never mid-encode, since `encode` itself is opaque here.
 */
export async function encodeToTargetSize(
  encode: (quality: number) => Promise<ArrayBuffer>,
  targetBytes: number,
  opts: EncodeToTargetSizeOptions = {},
): Promise<EncodeToTargetSizeResult> {
  const min = opts.min ?? 0.05;
  const max = opts.max ?? 0.95;
  const maxIterations = opts.maxIterations ?? 8;
  const signal = opts.signal;

  signal?.throwIfAborted();

  let lo = min;
  let hi = max;

  const floor = await encode(min);
  signal?.throwIfAborted();
  if (floor.byteLength > targetBytes) {
    return { bytes: floor, quality: min, hitTarget: false };
  }

  let best: EncodeToTargetSizeResult = {
    bytes: floor,
    quality: min,
    hitTarget: true,
  };

  for (let i = 1; i < maxIterations; i++) {
    const quality = (lo + hi) / 2;
    const bytes = await encode(quality);
    signal?.throwIfAborted();

    if (bytes.byteLength <= targetBytes) {
      best = { bytes, quality, hitTarget: true };
      lo = quality;
    } else {
      hi = quality;
    }
  }

  return best;
}
