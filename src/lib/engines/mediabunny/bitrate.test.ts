import { describe, expect, it } from "vitest";
import {
  chooseAudioBitrateBps,
  chooseVideoBitrateBps,
  estimateSourceVideoBps,
  presetAudioBitrateBps,
  presetVideoBitrateBps,
} from "./bitrate";

describe("chooseVideoBitrateBps", () => {
  it("caps a well-encoded source's medium-preset target at source × 0.65", () => {
    // 3 Mbps 1080p source — the whole bug this fix exists for: an
    // efficiently-encoded source must never be re-encoded at a HIGHER
    // bitrate just because a preset's own resolution-based ceiling says so.
    const sourceBps = 3_000_000;
    const result = chooseVideoBitrateBps("medium", 1080, sourceBps);
    expect(result).toBeLessThanOrEqual(1_950_000); // 3_000_000 * 0.65
    // And the preset's own ceiling for 1080p must be well above that cap,
    // proving the source cap is what actually won here, not a coincidence.
    expect(presetVideoBitrateBps("medium", 1080)).toBeGreaterThan(1_950_000);
  });

  it("lets the preset's own ceiling win for a high-bitrate source", () => {
    // 20 Mbps source — 20_000_000 * 0.65 = 13,000,000, far above medium's
    // own 1080p ceiling, so the preset's ceiling is the binding constraint.
    const result = chooseVideoBitrateBps("medium", 1080, 20_000_000);
    expect(result).toBe(presetVideoBitrateBps("medium", 1080));
  });

  it("falls back to the preset default when the source bitrate is unknown", () => {
    expect(chooseVideoBitrateBps("high", 720, undefined)).toBe(
      presetVideoBitrateBps("high", 720),
    );
  });

  it("orders presets low < medium < high at the same resolution", () => {
    expect(presetVideoBitrateBps("low", 1080)).toBeLessThan(
      presetVideoBitrateBps("medium", 1080),
    );
    expect(presetVideoBitrateBps("medium", 1080)).toBeLessThan(
      presetVideoBitrateBps("high", 1080),
    );
  });

  it("picks a smaller ceiling for a smaller resolution, same preset", () => {
    expect(presetVideoBitrateBps("medium", 480)).toBeLessThan(
      presetVideoBitrateBps("medium", 1080),
    );
  });
});

describe("chooseAudioBitrateBps", () => {
  it("never exceeds the source's own audio bitrate", () => {
    const result = chooseAudioBitrateBps("high", 64_000);
    expect(result).toBeLessThanOrEqual(64_000);
  });

  it("falls back to the preset default when the source bitrate is unknown", () => {
    expect(chooseAudioBitrateBps("medium", undefined)).toBe(
      presetAudioBitrateBps("medium"),
    );
  });

  it("lets the preset win when the source's audio bitrate is already high", () => {
    expect(chooseAudioBitrateBps("low", 500_000)).toBe(
      presetAudioBitrateBps("low"),
    );
  });

  it("always returns a positive integer, even for a fractional source bitrate", () => {
    // ADR-0017 (2026-09-30): mediabunny's `Quality` constructor rejects a
    // fractional bitrate outright, and `InputTrack.getAverageBitrate()`
    // frequently returns one — this branch used to pass it straight through.
    const result = chooseAudioBitrateBps("high", 64_000.5);
    expect(Number.isInteger(result)).toBe(true);
  });
});

describe("estimateSourceVideoBps", () => {
  it("derives a video bitrate from file size, duration and audio bitrate", () => {
    // 10 MB file, 60s, 128 kbps audio track.
    const fileBytes = 10 * 1024 * 1024;
    const duration = 60;
    const audioBps = 128_000;
    const result = estimateSourceVideoBps(fileBytes, duration, audioBps);
    const expected = (fileBytes * 8 - audioBps * duration) / duration;
    expect(result).toBeCloseTo(expected, 5);
    expect(result).toBeGreaterThan(0);
  });

  it("treats an unknown audio bitrate as zero", () => {
    const fileBytes = 1_000_000;
    const duration = 10;
    const result = estimateSourceVideoBps(fileBytes, duration, undefined);
    expect(result).toBeCloseTo((fileBytes * 8) / duration, 5);
  });

  it("returns undefined for a non-positive duration", () => {
    expect(estimateSourceVideoBps(1_000_000, 0, undefined)).toBeUndefined();
    expect(estimateSourceVideoBps(1_000_000, -5, undefined)).toBeUndefined();
  });

  it("returns undefined when the audio bitrate guess swallows the whole file", () => {
    // A tiny file with an implausibly high assumed audio bitrate — the
    // subtraction goes non-positive, so there's nothing sane to report.
    const result = estimateSourceVideoBps(1000, 10, 10_000_000);
    expect(result).toBeUndefined();
  });
});
