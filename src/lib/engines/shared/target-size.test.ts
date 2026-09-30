import { describe, expect, it, vi } from "vitest";
import { encodeToTargetSize } from "./target-size";

/**
 * A deterministic, monotonic fake "codec" whose output size scales
 * *exponentially* with quality — the shape a real DCT/block codec like
 * mozjpeg or libwebp actually has (ADR-0017's log-linear assumption), unlike
 * a linear fake. `bytesOf` mirrors the encoder's own scale so tests can
 * predict which quality a given target resolves near.
 */
function fakeExponentialEncoder(minBytes = 2_000, maxBytes = 500_000) {
  const bytesOf = (quality: number) =>
    Math.round(minBytes * (maxBytes / minBytes) ** quality);
  const encode = vi.fn(async (quality: number): Promise<ArrayBuffer> => {
    return new ArrayBuffer(bytesOf(quality));
  });
  return { encode, bytesOf };
}

/** A linear fake, kept for the tests that only care about monotonic
 * bisection-fallback correctness, not interpolation speed. */
function fakeLinearEncoder() {
  const calls: number[] = [];
  const bytesOf = (quality: number) => Math.round(quality * 100_000);
  const encode = vi.fn(async (quality: number): Promise<ArrayBuffer> => {
    calls.push(quality);
    return new ArrayBuffer(bytesOf(quality));
  });
  return { encode, calls, bytesOf };
}

describe("encodeToTargetSize", () => {
  it("lands in [0.95*target, target] on an exponential (log-linear) codec within a handful of encodes", async () => {
    const { encode, bytesOf } = fakeExponentialEncoder();
    const target = 50_000;
    const result = await encodeToTargetSize(encode, target);

    expect(result.hitTarget).toBe(true);
    expect(result.bytes.byteLength).toBeLessThanOrEqual(target);
    expect(result.bytes.byteLength).toBeGreaterThanOrEqual(0.95 * target);
    expect(bytesOf(result.quality)).toBe(result.bytes.byteLength);
    // ADR-0017: typically 3-5 encodes on a log-linear codec, capped at 8 —
    // well under the old fixed 8-step bisection.
    expect(encode.mock.calls.length).toBeLessThan(8);
  });

  it("returns the largest output that is <= target when no quality lands exactly on it", async () => {
    const { encode, bytesOf } = fakeLinearEncoder();
    const result = await encodeToTargetSize(encode, 42_000);

    expect(result.hitTarget).toBe(true);
    expect(result.bytes.byteLength).toBeLessThanOrEqual(42_000);
    expect(bytesOf(result.quality)).toBe(result.bytes.byteLength);
    // Should have gotten close: within a few % of the target.
    expect(result.bytes.byteLength).toBeGreaterThan(40_000);
  });

  it("returns the min-quality output with hitTarget false when even min overshoots", async () => {
    const { encode } = fakeLinearEncoder();
    const result = await encodeToTargetSize(encode, 1_000, { min: 0.05 });

    expect(result.hitTarget).toBe(false);
    expect(result.quality).toBe(0.05);
    expect(result.bytes.byteLength).toBe(5_000);
    // No search needed once the floor probe alone rules the target out.
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it("returns immediately once the floor probe already lands in the target band", async () => {
    const { encode } = fakeLinearEncoder();
    // Floor (0.05) encodes to 5,000 bytes; a target whose band includes that
    // is satisfied with a single probe.
    const result = await encodeToTargetSize(encode, 5_100, { min: 0.05 });
    expect(result.hitTarget).toBe(true);
    expect(result.quality).toBe(0.05);
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it("never calls encode more than maxIterations times", async () => {
    const { encode } = fakeLinearEncoder();
    await encodeToTargetSize(encode, 50_000, { maxIterations: 3 });
    expect(encode).toHaveBeenCalledTimes(3);
  });

  it("respects custom min/max bounds", async () => {
    const { encode } = fakeExponentialEncoder();
    const result = await encodeToTargetSize(encode, 99_999, {
      min: 0.4,
      max: 0.6,
    });
    expect(result.quality).toBeGreaterThanOrEqual(0.4);
    expect(result.quality).toBeLessThanOrEqual(0.6);
  });

  it("returns the ceiling immediately, flagged atCeiling, when max quality already undershoots the band (real-world validation, 2026-09-30)", async () => {
    // An already-efficient source: even `max` quality's own output lands
    // well under the target, outside `[0.95*target, target]`. Continuing to
    // search *lower* qualities can only shrink the output further from the
    // band, never closer — so the ceiling itself is the only sensible
    // answer, reached with exactly two encodes (floor + ceiling probes).
    const { encode, bytesOf } = fakeLinearEncoder();
    const target = 500_000; // ceiling (quality 0.95) encodes to 95,000 bytes
    const result = await encodeToTargetSize(encode, target);

    expect(result.hitTarget).toBe(true);
    expect(result.atCeiling).toBe(true);
    expect(result.quality).toBe(0.95);
    expect(result.bytes.byteLength).toBe(bytesOf(0.95));
    expect(encode).toHaveBeenCalledTimes(2);
  });

  it("does not flag atCeiling on a normal in-band result", async () => {
    const { encode } = fakeExponentialEncoder();
    const result = await encodeToTargetSize(encode, 50_000);
    expect(result.hitTarget).toBe(true);
    expect(result.atCeiling).toBe(false);
  });

  it("throws synchronously-observable rejection when the signal is already aborted", async () => {
    const { encode } = fakeLinearEncoder();
    const controller = new AbortController();
    controller.abort();

    await expect(
      encodeToTargetSize(encode, 50_000, { signal: controller.signal }),
    ).rejects.toThrow();
    expect(encode).not.toHaveBeenCalled();
  });

  it("stops between iterations once the signal aborts mid-run", async () => {
    const controller = new AbortController();
    const encode = vi.fn(async (quality: number): Promise<ArrayBuffer> => {
      if (encode.mock.calls.length === 2) controller.abort();
      return new ArrayBuffer(Math.round(quality * 100_000));
    });

    await expect(
      encodeToTargetSize(encode, 50_000, { signal: controller.signal }),
    ).rejects.toThrow();
    // The floor probe (call 1) plus the iteration that triggered the abort
    // (call 2) ran; nothing after that should have.
    expect(encode).toHaveBeenCalledTimes(2);
  });
});
