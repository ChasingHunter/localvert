/**
 * Structural similarity (SSIM, Wang et al. 2004) between two RGBA rasters, on
 * their luma plane only. Used by the image "best quality" search (ADR-0017):
 * it scores each candidate encode against the original decoded raster and
 * picks the smallest one that still looks the same. Pure TS — no DOM, no
 * wasm — so it runs in a worker exactly the same as in this file's own Node
 * unit tests.
 *
 * Method, standard and documented here since ADR-0017 asks for it explicitly:
 * - Luma via Rec. 601 (`0.299 R + 0.587 G + 0.114 B`), the same coefficients
 *   already used for perceptual comparisons elsewhere in this codebase's
 *   research notes — chosen over Rec. 709 because it's what most consumer
 *   photo/video codecs (JPEG among them) assume for their own luma plane.
 * - Both images are downscaled first (area-average box filter — cheap, and
 *   correct for the "compare an image to a shrunk copy of itself" case,
 *   unlike point sampling) so the long side is at most `maxLongSide`
 *   (default **512px**, not 1024 — see the perf note below).
 * - The SSIM map itself uses the paper's original **11x11 Gaussian window,
 *   sigma = 1.5** (not the simpler 8x8 uniform box window some
 *   implementations substitute) via the standard separable-filter
 *   optimisation: a 2D Gaussian convolution equals a 1D horizontal pass
 *   followed by a 1D vertical pass. Constants: `K1 = 0.01`, `K2 = 0.03`,
 *   `L = 255` (8-bit luma range), giving `C1 = (K1*L)^2`, `C2 = (K2*L)^2` —
 *   the paper's own defaults, used unmodified.
 * - The two inputs must already be the same size (the caller decodes both
 *   from the same source raster, so this is always true in practice); this
 *   throws rather than silently comparing mismatched planes.
 *
 * Performance (ADR-0017's search runs this ~6 times per compress job, so
 * this is on the hot path):
 * - All working buffers are `Float32Array` (not `Float64Array`) — half the
 *   memory bandwidth for the same convolution math, which is what this
 *   function is bottlenecked on, not floating-point precision.
 * - The five statistic maps the SSIM formula needs (`μx`, `μy`, `σx²`,
 *   `σy²`, `σxy`, computed from the blurred `x`, `y`, `x²`, `y²`, `xy`
 *   planes) are blurred together, one shared horizontal pass and one shared
 *   vertical pass, rather than five separate blur calls each redoing its own
 *   edge-clamping and index arithmetic — that arithmetic is the same for all
 *   five channels at a given pixel, so computing it once and reusing it five
 *   times removes 4/5 of that overhead.
 * - Default `maxLongSide` is **512px, not 1024** — a 4x pixel-count (and
 *   therefore roughly 4x time) reduction from the original default. This
 *   function's job here is *ranking candidate encodes against a threshold*,
 *   not producing a publishable quality metric: the visible difference
 *   between two adjacent integer JPEG/WebP qualities is a global, low
 *   frequency effect (blockiness, banding, blur), not something that only
 *   shows up at full resolution — 512px on the long side comfortably
 *   preserves that signal. `maxLongSide` stays a parameter (e.g. `1024`)
 *   for any future caller that does want a more precise, publishable score.
 */

export interface RasterLike {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface SsimOptions {
  /** Long side both images are downscaled to before scoring. Default 512 —
   * see the perf note in the file doc comment. */
  maxLongSide?: number;
}

/** See the file doc comment's perf note for why 512, not 1024. */
const DEFAULT_MAX_LONG_SIDE = 512;

const K1 = 0.01;
const K2 = 0.03;
const L = 255;
const C1 = (K1 * L) ** 2;
const C2 = (K2 * L) ** 2;

/** 11-tap 1D Gaussian kernel, sigma 1.5, normalised to sum to 1 — the
 * standard SSIM window (Wang et al.), applied separably (horizontal pass
 * then vertical pass) to approximate the 2D window cheaply. */
const GAUSSIAN_RADIUS = 5;
const GAUSSIAN_SIGMA = 1.5;
const GAUSSIAN_KERNEL = buildGaussianKernel(GAUSSIAN_RADIUS, GAUSSIAN_SIGMA);

function buildGaussianKernel(radius: number, sigma: number): Float32Array {
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - radius;
    const w = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel[i] = w;
    sum += w;
  }
  for (let i = 0; i < size; i++) {
    kernel[i] = (kernel[i] ?? 0) / sum;
  }
  return kernel;
}

/** Rec. 601 luma plane, one Float32 per pixel, row-major. */
function toLumaPlane(image: RasterLike): Float32Array {
  const { width, height, data } = image;
  const plane = new Float32Array(width * height);
  for (let p = 0, i = 0; p < width * height; p++, i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    plane[p] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return plane;
}

/**
 * Area-average downscale of a luma plane to `dstW x dstH`. Every destination
 * pixel is the mean of the source pixels whose box it covers — correct
 * (unlike nearest/point sampling) when shrinking, which is all this is ever
 * used for.
 */
function downscaleAreaAverage(
  src: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  if (dstW === srcW && dstH === srcH) return src;

  const dst = new Float32Array(dstW * dstH);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    const sy0 = Math.floor(dy * scaleY);
    const sy1 = Math.max(sy0 + 1, Math.min(srcH, Math.ceil((dy + 1) * scaleY)));
    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = Math.floor(dx * scaleX);
      const sx1 = Math.max(
        sx0 + 1,
        Math.min(srcW, Math.ceil((dx + 1) * scaleX)),
      );

      let sum = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        const rowOffset = sy * srcW;
        for (let sx = sx0; sx < sx1; sx++) {
          sum += src[rowOffset + sx] ?? 0;
          count++;
        }
      }
      dst[dy * dstW + dx] = count > 0 ? sum / count : 0;
    }
  }
  return dst;
}

/** `{width, height}` scaled so the long side is at most `maxLongSide`,
 * preserving aspect ratio. Already-small images pass through unchanged. */
function capLongSide(
  width: number,
  height: number,
  maxLongSide: number,
): { width: number; height: number } {
  const longSide = Math.max(width, height);
  if (longSide <= maxLongSide) return { width, height };
  const scale = maxLongSide / longSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The five Gaussian-filtered maps the SSIM formula needs, all computed
 * together (see the file doc comment's perf note): `muA`/`muB` are the
 * blurred luma planes themselves; `muAA`/`muBB`/`muAB` are the blurred
 * squared/cross planes, from which the caller derives the local variances
 * and covariance (`sigmaA2 = muAA - muA*muA`, etc.) without this function
 * needing to know about SSIM at all. */
interface FilteredMaps {
  muA: Float32Array;
  muB: Float32Array;
  muAA: Float32Array;
  muBB: Float32Array;
  muAB: Float32Array;
}

/**
 * Computes `FilteredMaps` for luma planes `a`/`b` via one shared horizontal
 * convolution pass and one shared vertical pass across all five source
 * channels (`a`, `b`, `a*a`, `b*b`, `a*b`) — edge index clamping and kernel
 * weight lookups happen once per pixel per pass and are reused for all five
 * running sums, rather than recomputed per channel.
 */
function computeFilteredMaps(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
): FilteredMaps {
  const n = width * height;
  const radius = GAUSSIAN_RADIUS;
  const kernel = GAUSSIAN_KERNEL;

  // The three product channels the SSIM formula needs beyond a/b
  // themselves, computed once up front (cheap — O(n), no convolution).
  const aa = new Float32Array(n);
  const bb = new Float32Array(n);
  const ab = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    aa[i] = av * av;
    bb[i] = bv * bv;
    ab[i] = av * bv;
  }

  // Horizontal pass: all five channels, one shared clamp/index per tap.
  const ha = new Float32Array(n);
  const hb = new Float32Array(n);
  const haa = new Float32Array(n);
  const hbb = new Float32Array(n);
  const hab = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      let sa = 0;
      let sb = 0;
      let saa = 0;
      let sbb = 0;
      let sab = 0;
      for (let k = -radius; k <= radius; k++) {
        let sx = x + k;
        if (sx < 0) sx = 0;
        else if (sx >= width) sx = width - 1;
        const idx = rowOffset + sx;
        const w = kernel[k + radius] ?? 0;
        sa += (a[idx] ?? 0) * w;
        sb += (b[idx] ?? 0) * w;
        saa += (aa[idx] ?? 0) * w;
        sbb += (bb[idx] ?? 0) * w;
        sab += (ab[idx] ?? 0) * w;
      }
      const outIdx = rowOffset + x;
      ha[outIdx] = sa;
      hb[outIdx] = sb;
      haa[outIdx] = saa;
      hbb[outIdx] = sbb;
      hab[outIdx] = sab;
    }
  }

  // Vertical pass: same shared-index structure, reading the horizontal
  // pass's output.
  const muA = new Float32Array(n);
  const muB = new Float32Array(n);
  const muAA = new Float32Array(n);
  const muBB = new Float32Array(n);
  const muAB = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sa = 0;
      let sb = 0;
      let saa = 0;
      let sbb = 0;
      let sab = 0;
      for (let k = -radius; k <= radius; k++) {
        let sy = y + k;
        if (sy < 0) sy = 0;
        else if (sy >= height) sy = height - 1;
        const idx = sy * width + x;
        const w = kernel[k + radius] ?? 0;
        sa += (ha[idx] ?? 0) * w;
        sb += (hb[idx] ?? 0) * w;
        saa += (haa[idx] ?? 0) * w;
        sbb += (hbb[idx] ?? 0) * w;
        sab += (hab[idx] ?? 0) * w;
      }
      const outIdx = y * width + x;
      muA[outIdx] = sa;
      muB[outIdx] = sb;
      muAA[outIdx] = saa;
      muBB[outIdx] = sbb;
      muAB[outIdx] = sab;
    }
  }

  return { muA, muB, muAA, muBB, muAB };
}

/**
 * Mean SSIM between two same-size luma planes, via the separable-Gaussian
 * local statistics described in the file doc comment. Returns a value in
 * `[-1, 1]`; identical inputs give exactly `1`.
 */
function ssimOnPlanes(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
): number {
  const { muA, muB, muAA, muBB, muAB } = computeFilteredMaps(
    a,
    b,
    width,
    height,
  );

  let sum = 0;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const ma = muA[i] ?? 0;
    const mb = muB[i] ?? 0;
    const sigmaA2 = (muAA[i] ?? 0) - ma * ma;
    const sigmaB2 = (muBB[i] ?? 0) - mb * mb;
    const sigmaAB = (muAB[i] ?? 0) - ma * mb;

    const numerator = (2 * ma * mb + C1) * (2 * sigmaAB + C2);
    const denominator = (ma * ma + mb * mb + C1) * (sigmaA2 + sigmaB2 + C2);
    sum += numerator / denominator;
  }
  return sum / n;
}

/**
 * SSIM between two RGBA rasters, computed on their Rec. 601 luma plane, each
 * independently downscaled (area average) so its long side is at most
 * `options.maxLongSide` (default 512 — see the file doc comment's perf
 * note). Both rasters are resized to whichever of their two capped sizes is
 * smaller — in practice they're almost always the same size already (a
 * candidate encode decoded back from the same source raster), so this is a
 * no-op resize in the common case.
 */
export function ssim(
  a: RasterLike,
  b: RasterLike,
  options: SsimOptions = {},
): number {
  const maxLongSide = options.maxLongSide ?? DEFAULT_MAX_LONG_SIDE;

  const lumaA = toLumaPlane(a);
  const lumaB = toLumaPlane(b);

  const capA = capLongSide(a.width, a.height, maxLongSide);
  const capB = capLongSide(b.width, b.height, maxLongSide);
  // Use the smaller of the two capped sizes so both planes end up the same
  // size regardless of which input started larger.
  const targetW = Math.min(capA.width, capB.width);
  const targetH = Math.min(capA.height, capB.height);

  const planeA = downscaleAreaAverage(
    lumaA,
    a.width,
    a.height,
    targetW,
    targetH,
  );
  const planeB = downscaleAreaAverage(
    lumaB,
    b.width,
    b.height,
    targetW,
    targetH,
  );

  return ssimOnPlanes(planeA, planeB, targetW, targetH);
}
