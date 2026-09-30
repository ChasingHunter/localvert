import { describe, expect, it } from "vitest";
import { searchPngTargetSize } from "./png-target-size";

/** A fake quantize/encode/ssim triple: fewer colours -> smaller bytes and
 * lower SSIM, deterministically, so tests can predict exactly which step
 * wins. `raster` is just the colour count boxed. */
function fakeCodec(ssimByColors: Record<number, number>) {
  const quantize = async (colors: number) => ({ colors });
  const encode = async (raster: { colors: number }) =>
    new ArrayBuffer(raster.colors * 1000); // 256 -> 256,000 bytes, etc.
  const computeSsim = (_original: unknown, candidate: { colors: number }) =>
    ssimByColors[candidate.colors] ?? 1;
  return { quantize, encode, computeSsim };
}

describe("searchPngTargetSize", () => {
  it("stops at the first (largest) palette step that fits the target", async () => {
    const { quantize, encode, computeSsim } = fakeCodec({
      256: 1,
      128: 0.9999,
      64: 0.9995,
      32: 0.999,
      16: 0.998,
    });
    // 128 colours -> 128,000 bytes fits a 150,000 target; 256 -> 256,000
    // doesn't.
    const result = await searchPngTargetSize(
      {},
      quantize,
      encode,
      computeSsim,
      150_000,
    );
    expect(result.hitTarget).toBe(true);
    expect(result.colors).toBe(128);
    expect(result.unreachableQuality).toBe(false);
  });

  it("skips steps whose SSIM falls below the lossy floor (0.998)", async () => {
    const { quantize, encode, computeSsim } = fakeCodec({
      256: 1,
      128: 0.999,
      64: 0.997, // below floor -> search stops here, never returned
      32: 0.995,
      16: 0.99,
    });
    // Target so small only 64/32/16 colours would fit by size alone, but
    // they're all below the SSIM floor -> best remains 128 (still over
    // target). ADR-0017/real-world validation (2026-09-30): this still
    // counts as "unreachable" for the caller's JPG/WebP-suggestion note —
    // 128 being "usable" (good SSIM) doesn't mean the *target* was
    // reachable, only that the target-size ladder never returns a ruined
    // image as its answer.
    const result = await searchPngTargetSize(
      {},
      quantize,
      encode,
      computeSsim,
      50_000,
    );
    expect(result.hitTarget).toBe(false);
    expect(result.colors).toBe(128);
    expect(result.unreachableQuality).toBe(true);
  });

  it("reports unreachableQuality when even the least-aggressive step fails the SSIM floor", async () => {
    const { quantize, encode, computeSsim } = fakeCodec({
      256: 0.99, // already below the 0.998 floor at the very first step
    });
    const result = await searchPngTargetSize(
      {},
      quantize,
      encode,
      computeSsim,
      1_000,
    );
    expect(result.unreachableQuality).toBe(true);
    expect(result.hitTarget).toBe(false);
  });

  it("propagates an aborted signal", async () => {
    const { quantize, encode, computeSsim } = fakeCodec({ 256: 1 });
    const controller = new AbortController();
    controller.abort();
    await expect(
      searchPngTargetSize(
        {},
        quantize,
        encode,
        computeSsim,
        1_000,
        controller.signal,
      ),
    ).rejects.toThrow();
  });
});
