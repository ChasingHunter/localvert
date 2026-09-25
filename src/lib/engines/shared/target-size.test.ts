import { describe, expect, it, vi } from "vitest";
import { encodeToTargetSize } from "./target-size";

/**
 * A deterministic, monotonic fake "codec": output size scales linearly with
 * quality, same shape every real codec has (higher quality -> bigger
 * output). `bytesOf` mirrors the encoder's own scale so tests can predict
 * exactly which quality a given target resolves to.
 */
function fakeEncoder() {
  const calls: number[] = [];
  const bytesOf = (quality: number) => Math.round(quality * 100_000);
  const encode = vi.fn(async (quality: number): Promise<ArrayBuffer> => {
    calls.push(quality);
    return new ArrayBuffer(bytesOf(quality));
  });
  return { encode, calls, bytesOf };
}

describe("encodeToTargetSize", () => {
  it("bisects to the largest quality whose output lands exactly on the target", async () => {
    const { encode } = fakeEncoder();
    const result = await encodeToTargetSize(encode, 50_000);

    expect(result.hitTarget).toBe(true);
    expect(result.quality).toBe(0.5);
    expect(result.bytes.byteLength).toBe(50_000);
    // 1 floor probe + 7 bisection iterations = 8 total, the default cap.
    expect(encode).toHaveBeenCalledTimes(8);
  });

  it("returns the largest output that is <= target when no quality lands exactly on it", async () => {
    const { encode, bytesOf } = fakeEncoder();
    const result = await encodeToTargetSize(encode, 42_000);

    expect(result.hitTarget).toBe(true);
    expect(result.bytes.byteLength).toBeLessThanOrEqual(42_000);
    expect(bytesOf(result.quality)).toBe(result.bytes.byteLength);
    // Bisection should have gotten close: within 1% of the target.
    expect(result.bytes.byteLength).toBeGreaterThan(41_000);
  });

  it("returns the min-quality output with hitTarget false when even min overshoots", async () => {
    const { encode } = fakeEncoder();
    const result = await encodeToTargetSize(encode, 1_000, { min: 0.05 });

    expect(result.hitTarget).toBe(false);
    expect(result.quality).toBe(0.05);
    expect(result.bytes.byteLength).toBe(5_000);
    // No bisection needed once the floor probe alone rules the target out.
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it("never calls encode more than maxIterations times", async () => {
    const { encode } = fakeEncoder();
    await encodeToTargetSize(encode, 50_000, { maxIterations: 3 });
    expect(encode).toHaveBeenCalledTimes(3);
  });

  it("respects custom min/max bounds", async () => {
    const { encode, calls } = fakeEncoder();
    await encodeToTargetSize(encode, 99_999, { min: 0.4, max: 0.6 });
    expect(Math.min(...calls)).toBeGreaterThanOrEqual(0.4);
    expect(Math.max(...calls)).toBeLessThanOrEqual(0.6);
  });

  it("throws synchronously-observable rejection when the signal is already aborted", async () => {
    const { encode } = fakeEncoder();
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
