/**
 * Pure image-comparison helpers for the golden-file perceptual tests
 * (`src/lib/engines/golden.browser.test.ts`). No DOM, no wasm — safe to
 * unit-test in plain node (`vitest.config.ts`), unlike the adapters
 * themselves, which only ever run for real in `vitest.browser.config.ts`.
 */

/** RGBA, or any other equal-length byte buffer. */
export type ByteBuffer = Uint8ClampedArray | Uint8Array;

/**
 * Peak signal-to-noise ratio between two equal-length byte buffers, in
 * decibels — higher means closer. Returns `Infinity` for byte-identical
 * buffers (a lossless round-trip) rather than some large finite number
 * standing in for "perfect", so a caller can assert exact equality the same
 * way it asserts a dB threshold.
 */
export function psnr(a: ByteBuffer, b: ByteBuffer): number {
  if (a.length !== b.length) {
    throw new Error(
      `psnr: buffers must be the same length (${a.length} vs ${b.length})`,
    );
  }
  let sumSquaredError = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    sumSquaredError += diff * diff;
  }
  const meanSquaredError = sumSquaredError / a.length;
  if (meanSquaredError === 0) return Infinity;
  const MAX = 255;
  return 10 * Math.log10((MAX * MAX) / meanSquaredError);
}

/**
 * Alpha-composites an RGBA buffer over solid white, forcing alpha to 255 —
 * the same blend the canvas and jsquash-jpeg adapters perform before
 * encoding to a format with no alpha channel (`../lib/engines/canvas/
 * adapter.ts`'s `runEncode`, `../lib/engines/jsquash-jpeg/adapter.ts`'s
 * `compositeOverBackground`, both default to white). A golden comparison for
 * a jpg round-trip needs this applied to the source side too, or the
 * encoder's correct alpha-to-white fill scores as noise instead of a match.
 */
export function compositeOnWhite(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const alpha = (data[i + 3] ?? 0) / 255;
    out[i] = r * alpha + 255 * (1 - alpha);
    out[i + 1] = g * alpha + 255 * (1 - alpha);
    out[i + 2] = b * alpha + 255 * (1 - alpha);
    out[i + 3] = 255;
  }
  return out;
}
