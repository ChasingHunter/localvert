/**
 * Target-file-size encoding, shared by every lossy image codec adapter that
 * exposes a `quality` knob (`jsquash-jpeg`, `jsquash-webp`, `jsquash-avif`
 * today). A tool's "Target size" option asks for a byte budget, not a
 * quality; this searches `quality` to find output that lands in
 * `[0.95 * targetBytes, targetBytes]`, re-encoding the same raster each time.
 * Environment-neutral (no DOM, no wasm) so it can be unit-tested directly in
 * Node — every adapter just supplies its own `encode(quality)` closure.
 *
 * ADR-0017 replaces the original fixed 8-step bisection with **interpolation
 * on log(size) vs. quality**: for a JPEG/WebP-style DCT/block encoder, size
 * grows roughly exponentially with quality over most of the practical range,
 * so `log(size)` is close to linear in `quality` — fitting a line through
 * two probes and solving for the target lands much closer on the first
 * guess than plain bisection, typically converging in 3-5 encodes instead of
 * a fixed 8. Bisection is kept as the fallback update rule (narrowing
 * `[lo, hi]` around the best guess so far) whenever the linear model's
 * prediction would be out of bounds or the model degenerates (e.g. both
 * probes gave the same size) — so this never does worse than the old
 * bisection, only better when the log-linear assumption holds.
 */

export interface EncodeToTargetSizeOptions {
  /** Lower bound of the quality search, inclusive. Default 0.05. */
  min?: number;
  /** Upper bound of the quality search, inclusive. Default 0.95. */
  max?: number;
  /** Most `encode` calls this makes, including the two floor/ceiling probes.
   * Default 8 (ADR-0017: typically 3-5 in practice, 8 is the safety cap). */
  maxIterations?: number;
  signal?: AbortSignal;
}

export interface EncodeToTargetSizeResult {
  bytes: ArrayBuffer;
  /** The quality that produced `bytes`. */
  quality: number;
  /** False only when even `min` quality's output exceeds `targetBytes`. */
  hitTarget: boolean;
  /** True when `max` quality's own output already fits under `targetBytes`
   * without landing in the `[0.95*targetBytes, targetBytes]` band — i.e. the
   * best (highest) quality this search is allowed to try is *already*
   * smaller than the target allows. Since size only grows with quality,
   * nothing between `min` and `max` can get closer to the band from below:
   * `max` itself is the closest reachable point, so the caller should report
   * "already under target at full quality" rather than a misleading percent
   * of target computed by continuing to search (and likely landing on some
   * arbitrary, *lower*-quality candidate further from the band still). */
  atCeiling: boolean;
}

/** The result is accepted once its size falls in
 * `[LOW_FRACTION * targetBytes, targetBytes]` — ADR-0017's "[0.95*T, T]". */
const LOW_FRACTION = 0.95;

/**
 * Searches `quality` in `[min, max]`, calling `encode(quality)` at most
 * `maxIterations` times, for the largest quality whose output size lands in
 * `[0.95 * targetBytes, targetBytes]` (or, failing that, the largest quality
 * that still fits under `targetBytes` at all).
 *
 * Assumes `encode`'s output size grows monotonically with `quality` — true
 * for every codec's own quality knob, and the reason a floor probe at `min`
 * decides reachability outright: if `min` already overshoots, no higher
 * quality can do better, so the search stops immediately and that floor
 * output is returned with `hitTarget: false`.
 *
 * Otherwise a ceiling probe at `max` seeds the log-size/quality line; each
 * further iteration predicts a quality from that line, encodes it, and
 * either accepts it (within the target band), or uses it to refit the line
 * (replacing whichever probe is on the same side) and keeps the best
 * still-fitting result seen so far. `signal` is checked before the first
 * probe and after every `encode` call — never mid-encode, since `encode`
 * itself is opaque here.
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

  const floor = await encode(min);
  signal?.throwIfAborted();
  if (floor.byteLength > targetBytes) {
    return { bytes: floor, quality: min, hitTarget: false, atCeiling: false };
  }
  if (maxIterations <= 1) {
    return { bytes: floor, quality: min, hitTarget: true, atCeiling: false };
  }

  let best: EncodeToTargetSizeResult = {
    bytes: floor,
    quality: min,
    hitTarget: true,
    atCeiling: false,
  };
  const lowBound = LOW_FRACTION * targetBytes;
  if (floor.byteLength >= lowBound) {
    // The floor quality already lands in the target band — nothing smaller
    // to search for below it, and quality only grows from here.
    return best;
  }

  const ceiling = await encode(max);
  signal?.throwIfAborted();
  if (ceiling.byteLength <= targetBytes) {
    // `max` is the best quality this search is allowed to reach, and it
    // already fits — nothing between `min` and `max` can land closer to the
    // band (that would need an even *larger* output than `max` gives), so
    // this is the final answer regardless of whether it's in-band.
    return { bytes: ceiling, quality: max, hitTarget: true, atCeiling: true };
  }

  // Two known points: (min, floor.byteLength) always fits; (max,
  // ceiling.byteLength) may or may not. `lo`/`hi` bracket the quality range
  // still being searched, narrowed by both the log-linear prediction and,
  // whenever that prediction misbehaves, plain bisection.
  let lo = min;
  let loSize = floor.byteLength;
  let hi = max;
  let hiSize = ceiling.byteLength;
  // Consecutive iterations that moved the same bound, without the other
  // bound ever moving — a real (roughly log-linear) codec never does this
  // more than once or twice, but a pathological/non-log-linear `encode`
  // could make the log-fit prediction crawl toward the target from one side
  // forever. Forcing a plain bisection step whenever this streak gets long
  // guarantees the same worst-case convergence rate as the old fixed
  // bisection, so this never does worse than that baseline.
  let staleSide: "lo" | "hi" | undefined;
  let staleStreak = 0;

  for (let i = 2; i < maxIterations; i++) {
    let quality = predictQuality(lo, loSize, hi, hiSize, targetBytes);
    const outOfBounds =
      !Number.isFinite(quality) || quality <= lo || quality >= hi;
    if (outOfBounds || staleStreak >= 2) {
      quality = (lo + hi) / 2;
    }

    const bytes = await encode(quality);
    signal?.throwIfAborted();
    const size = bytes.byteLength;

    if (size <= targetBytes) {
      best = { bytes, quality, hitTarget: true, atCeiling: false };
      if (size >= lowBound) break; // Landed in the target band.
      lo = quality;
      loSize = size;
      staleStreak = staleSide === "lo" ? staleStreak + 1 : 1;
      staleSide = "lo";
    } else {
      hi = quality;
      hiSize = size;
      staleStreak = staleSide === "hi" ? staleStreak + 1 : 1;
      staleSide = "hi";
    }
  }

  return best;
}

/**
 * Fits `log(size) = a * quality + b` through the two bracketing points and
 * solves for the quality whose predicted size is the target band's midpoint
 * (`0.975 * targetBytes`, so a prediction that lands slightly either side
 * still likely falls in `[0.95T, T]`). Returns `NaN` if the two points have
 * the same size (a degenerate, non-invertible line) — the caller falls back
 * to bisection in that case.
 */
function predictQuality(
  lo: number,
  loSize: number,
  hi: number,
  hiSize: number,
  targetBytes: number,
): number {
  if (loSize <= 0 || hiSize <= 0 || loSize === hiSize) return Number.NaN;

  const logLo = Math.log(loSize);
  const logHi = Math.log(hiSize);
  const slope = (logHi - logLo) / (hi - lo);
  if (!Number.isFinite(slope) || slope === 0) return Number.NaN;

  const targetLog = Math.log(
    targetBytes * (LOW_FRACTION + (1 - LOW_FRACTION) / 2),
  );
  return lo + (targetLog - logLo) / slope;
}
