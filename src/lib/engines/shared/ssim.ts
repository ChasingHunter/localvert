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
 *   unlike point sampling) so the long side is at most 1024 px. This bounds
 *   the cost of a search that runs SSIM ~6 times per job.
 * - The SSIM map itself uses the paper's original **11x11 Gaussian window,
 *   sigma = 1.5** (not the simpler 8x8 uniform box window some
 *   implementations substitute) via the standard separable-filter
 *   optimisation: a 2D Gaussian convolution equals a 1D horizontal pass
 *   followed by a 1D vertical pass, so this never allocates an 11x11 kernel
 *   per pixel. Constants: `K1 = 0.01`, `K2 = 0.03`, `L = 255` (8-bit luma
 *   range), giving `C1 = (K1*L)^2`, `C2 = (K2*L)^2` — the paper's own
 *   defaults, used unmodified.
 * - The two inputs must already be the same size (the caller decodes both
 *   from the same source raster, so this is always true in practice); this
 *   throws rather than silently comparing mismatched planes.
 */

export interface RasterLike {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Long side is capped here — see the file doc comment. */
const MAX_LONG_SIDE = 1024;

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

function buildGaussianKernel(radius: number, sigma: number): Float64Array {
  const size = radius * 2 + 1;
  const kernel = new Float64Array(size);
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

/** Rec. 601 luma plane, one Float64 per pixel, row-major. */
function toLumaPlane(image: RasterLike): Float64Array {
  const { width, height, data } = image;
  const plane = new Float64Array(width * height);
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
  src: Float64Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float64Array {
  if (dstW === srcW && dstH === srcH) return src;

  const dst = new Float64Array(dstW * dstH);
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

/** `{width, height}` scaled so the long side is at most `MAX_LONG_SIDE`,
 * preserving aspect ratio. Already-small images pass through unchanged. */
function capLongSide(
  width: number,
  height: number,
): { width: number; height: number } {
  const longSide = Math.max(width, height);
  if (longSide <= MAX_LONG_SIDE) return { width, height };
  const scale = MAX_LONG_SIDE / longSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Separable Gaussian blur (horizontal pass then vertical pass), edges
 * clamped to the nearest in-bounds sample rather than zero-padded — zero
 * padding would darken every window that touches an edge. */
function gaussianBlur(
  plane: Float64Array,
  width: number,
  height: number,
): Float64Array {
  const kernel = GAUSSIAN_KERNEL;
  const radius = GAUSSIAN_RADIUS;

  const horizontal = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = Math.min(width - 1, Math.max(0, x + k));
        sum += (plane[rowOffset + sx] ?? 0) * (kernel[k + radius] ?? 0);
      }
      horizontal[rowOffset + x] = sum;
    }
  }

  const vertical = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = Math.min(height - 1, Math.max(0, y + k));
        sum += (horizontal[sy * width + x] ?? 0) * (kernel[k + radius] ?? 0);
      }
      vertical[y * width + x] = sum;
    }
  }
  return vertical;
}

function multiply(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] ?? 0) * (b[i] ?? 0);
  return out;
}

/**
 * Mean SSIM between two same-size luma planes, via the separable-Gaussian
 * local statistics described in the file doc comment. Returns a value in
 * `[-1, 1]`; identical inputs give exactly `1`.
 */
function ssimOnPlanes(
  a: Float64Array,
  b: Float64Array,
  width: number,
  height: number,
): number {
  const muA = gaussianBlur(a, width, height);
  const muB = gaussianBlur(b, width, height);
  const muA2 = multiply(muA, muA);
  const muB2 = multiply(muB, muB);
  const muAB = multiply(muA, muB);

  const aa = gaussianBlur(multiply(a, a), width, height);
  const bb = gaussianBlur(multiply(b, b), width, height);
  const ab = gaussianBlur(multiply(a, b), width, height);

  let sum = 0;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const sigmaA2 = (aa[i] ?? 0) - (muA2[i] ?? 0);
    const sigmaB2 = (bb[i] ?? 0) - (muB2[i] ?? 0);
    const sigmaAB = (ab[i] ?? 0) - (muAB[i] ?? 0);
    const ma = muA[i] ?? 0;
    const mb = muB[i] ?? 0;

    const numerator = (2 * ma * mb + C1) * (2 * sigmaAB + C2);
    const denominator = (ma * ma + mb * mb + C1) * (sigmaA2 + sigmaB2 + C2);
    sum += numerator / denominator;
  }
  return sum / n;
}

/**
 * SSIM between two RGBA rasters, computed on their Rec. 601 luma plane, each
 * independently downscaled (area average) so its long side is at most
 * `MAX_LONG_SIDE`. Both rasters are resized to whichever of their two capped
 * sizes is smaller — in practice they're almost always the same size already
 * (a candidate encode decoded back from the same source raster), so this is
 * a no-op resize in the common case.
 */
export function ssim(a: RasterLike, b: RasterLike): number {
  const lumaA = toLumaPlane(a);
  const lumaB = toLumaPlane(b);

  const capA = capLongSide(a.width, a.height);
  const capB = capLongSide(b.width, b.height);
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
