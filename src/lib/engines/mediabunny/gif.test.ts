import { describe, expect, it } from "vitest";
import { isEngineError } from "../errors";
import {
  frameTimestamps,
  MAX_DURATION_SECONDS,
  MAX_FPS,
  MAX_WIDTH,
  scaledDimensions,
  validateToGifOptions,
} from "./gif";

describe("frameTimestamps", () => {
  it("samples one timestamp per 1/fps interval starting at `start`", () => {
    // Rounded to sidestep float noise (e.g. 0.6000000000000001) — the
    // schedule's exact spacing, not its float representation, is the thing
    // under test.
    const rounded = frameTimestamps(0, 1, 5).map((t) => Math.round(t * 1e6));
    expect(rounded).toEqual([0, 200000, 400000, 600000, 800000]);
  });

  it("offsets the schedule by a non-zero start", () => {
    expect(frameTimestamps(2, 0.5, 4)).toEqual([2, 2.25]);
  });

  it("is half-open at the end — an exact-multiple duration doesn't sample one past it", () => {
    // 10 frames at 10fps over 1s: [0, 0.1, ..., 0.9], never 1.0.
    const timestamps = frameTimestamps(0, 1, 10);
    expect(timestamps).toHaveLength(10);
    expect(timestamps[timestamps.length - 1]).toBeCloseTo(0.9);
  });

  it("always yields at least one timestamp for a positive duration", () => {
    expect(frameTimestamps(0, 0.01, 5)).toEqual([0]);
  });
});

describe("scaledDimensions", () => {
  it("scales height to keep the source aspect ratio", () => {
    expect(scaledDimensions(1920, 1080, 480)).toEqual({
      width: 480,
      height: 270,
    });
  });

  it("rounds both dimensions to the nearest even number", () => {
    // 101x51 at target width 101 (1:1 scale): raw 101/51 both round up to
    // the next even number (102/52).
    expect(scaledDimensions(101, 51, 101)).toEqual({
      width: 102,
      height: 52,
    });
  });

  it("never upscales past the source width", () => {
    expect(scaledDimensions(240, 180, 480)).toEqual({
      width: 240,
      height: 180,
    });
  });

  it("floors dimensions at 2px", () => {
    expect(scaledDimensions(10000, 1, 2)).toEqual({ width: 2, height: 2 });
  });
});

describe("validateToGifOptions", () => {
  const valid = {
    start: 0,
    duration: 5,
    fps: 10,
    width: 480,
    colors: 256,
    loop: true,
  };

  it("accepts options within the documented limits", () => {
    expect(() => validateToGifOptions(valid, "mediabunny")).not.toThrow();
  });

  it("rejects a duration beyond the cap", () => {
    expect(() =>
      validateToGifOptions(
        { ...valid, duration: MAX_DURATION_SECONDS + 1 },
        "mediabunny",
      ),
    ).toThrow();
  });

  it("rejects a non-positive duration", () => {
    expect(() =>
      validateToGifOptions({ ...valid, duration: 0 }, "mediabunny"),
    ).toThrow();
  });

  it("rejects a negative start", () => {
    expect(() =>
      validateToGifOptions({ ...valid, start: -1 }, "mediabunny"),
    ).toThrow();
  });

  it("rejects fps beyond the cap", () => {
    expect(() =>
      validateToGifOptions({ ...valid, fps: MAX_FPS + 1 }, "mediabunny"),
    ).toThrow();
  });

  it("rejects width beyond the cap", () => {
    expect(() =>
      validateToGifOptions({ ...valid, width: MAX_WIDTH + 1 }, "mediabunny"),
    ).toThrow();
  });

  it("throws an EngineError with code unsupported", () => {
    try {
      validateToGifOptions({ ...valid, fps: 0 }, "mediabunny");
      throw new Error("expected validateToGifOptions to throw");
    } catch (e) {
      expect(isEngineError(e) && e.code === "unsupported").toBe(true);
    }
  });
});
