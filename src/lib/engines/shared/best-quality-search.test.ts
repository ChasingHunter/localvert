import { describe, expect, it, vi } from "vitest";
import { searchBestQuality } from "./best-quality-search";

/**
 * A synthetic codec/SSIM pair: "ssim" rises monotonically with quality
 * toward 1, crossing typical thresholds (0.999, 0.9999) at known integer
 * qualities, so tests can assert the exact quality the search should land
 * on. "raster" is just the quality itself, boxed — the fake `computeSsim`
 * reads it back out rather than doing real pixel math.
 */
function fakeCodec(ssimAt: (quality: number) => number) {
  const encode = vi.fn(async (quality: number) => {
    return new ArrayBuffer(quality); // size not used by these tests
  });
  const decode = vi.fn(async (bytes: ArrayBuffer) => ({
    quality: bytes.byteLength,
  }));
  const computeSsim = (
    _original: { quality: number },
    candidate: { quality: number },
  ) => ssimAt(candidate.quality);
  return { encode, decode, computeSsim };
}

describe("searchBestQuality", () => {
  it("finds the smallest quality meeting the threshold", async () => {
    // ssim reaches 0.9999 at quality >= 80, and keeps climbing after.
    const ssimAt = (q: number) =>
      q >= 80 ? 0.9999 + (q - 80) * 0.00001 : 0.995;
    const { encode, decode, computeSsim } = fakeCodec(ssimAt);

    const result = await searchBestQuality(
      { quality: 0 },
      encode,
      decode,
      computeSsim,
      { min: 40, max: 95, threshold: 0.9999 },
    );

    expect(result.metThreshold).toBe(true);
    expect(result.quality).toBe(80);
    // ~6 encodes, per ADR-0017: 1 ceiling probe + bisection over a range of
    // 55 integers converges well within that budget's default cap.
    expect(encode.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("uses a lower quality for the looser 'Smaller' threshold than the strict one", async () => {
    const ssimAt = (q: number) => 0.995 + q * 0.0001; // crosses 0.999 at 45, 0.9999 near 100
    const strict = await searchBestQuality(
      { quality: 0 },
      fakeCodec(ssimAt).encode,
      fakeCodec(ssimAt).decode,
      fakeCodec(ssimAt).computeSsim,
      { min: 40, max: 95, threshold: 0.9999 },
    );
    const loose = await searchBestQuality(
      { quality: 0 },
      fakeCodec(ssimAt).encode,
      fakeCodec(ssimAt).decode,
      fakeCodec(ssimAt).computeSsim,
      { min: 40, max: 95, threshold: 0.999 },
    );

    expect(loose.quality).toBeLessThan(strict.quality);
  });

  it("reports metThreshold: false when even max quality falls short", async () => {
    const { encode, decode, computeSsim } = fakeCodec(() => 0.9);
    const result = await searchBestQuality(
      { quality: 0 },
      encode,
      decode,
      computeSsim,
      { min: 40, max: 95, threshold: 0.9999 },
    );

    expect(result.metThreshold).toBe(false);
    expect(result.quality).toBe(95);
    expect(encode).toHaveBeenCalledTimes(1); // Ceiling probe only.
  });

  it("never calls encode more than maxIterations times", async () => {
    const ssimAt = (q: number) => (q >= 80 ? 0.9999 : 0.995);
    const { encode, decode, computeSsim } = fakeCodec(ssimAt);
    await searchBestQuality({ quality: 0 }, encode, decode, computeSsim, {
      min: 40,
      max: 95,
      threshold: 0.9999,
      maxIterations: 3,
    });
    expect(encode.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("propagates an aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const { encode, decode, computeSsim } = fakeCodec(() => 1);
    await expect(
      searchBestQuality({ quality: 0 }, encode, decode, computeSsim, {
        min: 40,
        max: 95,
        threshold: 0.9999,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});
