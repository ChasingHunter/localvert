import { describe, expect, it } from "vitest";
import {
  bestQualityBitrate,
  bitrateForTargetSize,
  stepDown,
  targetBytesForPercent,
} from "./audio-target";

describe("bitrateForTargetSize", () => {
  it("picks a stereo bitrate when the raw rate clears the stereo floor", () => {
    // 10 MB / 300s ~= 273 kbps raw, well above every stereo floor.
    const result = bitrateForTargetSize({
      codec: "aac",
      targetBytes: 10 * 1024 * 1024,
      durationSec: 300,
      sourceChannels: 2,
    });
    expect(result.reachable).toBe(true);
    expect(result.channels).toBeUndefined(); // keep the source's own channel count
    expect(result.bitrateBps).toBeGreaterThanOrEqual(64_000);
  });

  it("snaps mp3 to the nearest standard bitrate at or below the raw rate", () => {
    // Pick a target that computes to a raw rate strictly between two
    // standard MP3 steps (128 and 160 kbps) so the snap is observable.
    const durationSec = 60;
    const rawTarget = (150_000 * durationSec) / 8 / 0.97 + 8 * 1024;
    const result = bitrateForTargetSize({
      codec: "mp3",
      targetBytes: rawTarget,
      durationSec,
      sourceChannels: 2,
    });
    expect(result.bitrateBps).toBe(128_000);
  });

  it("downmixes to mono when raw rate is below the stereo floor but above the mono floor", () => {
    // Small target, long duration -> raw rate lands under the AAC stereo
    // floor (64 kbps) but over its mono floor (32 kbps).
    const result = bitrateForTargetSize({
      codec: "aac",
      targetBytes: 300_000,
      durationSec: 60,
      sourceChannels: 2,
    });
    expect(result.reachable).toBe(true);
    expect(result.channels).toBe(1);
    expect(result.bitrateBps).toBeGreaterThanOrEqual(32_000);
    expect(result.bitrateBps).toBeLessThan(64_000);
  });

  it("is unreachable below the mono floor", () => {
    const result = bitrateForTargetSize({
      codec: "opus",
      targetBytes: 1000, // tiny target, long clip
      durationSec: 600,
      sourceChannels: 2,
    });
    expect(result.reachable).toBe(false);
    expect(result.channels).toBe(1);
    expect(result.bitrateBps).toBe(24_000); // opus mono floor
  });

  it("only ever checks the mono floor for an already-mono source", () => {
    const result = bitrateForTargetSize({
      codec: "mp3",
      targetBytes: 500_000,
      durationSec: 60,
      sourceChannels: 1,
    });
    // Raw rate here clears mp3's mono floor (32k) — reachable, and channels
    // stays undefined (source is already mono, nothing to downmix).
    expect(result.reachable).toBe(true);
    expect(result.channels).toBeUndefined();
  });

  it("is unreachable with zero duration", () => {
    const result = bitrateForTargetSize({
      codec: "mp3",
      targetBytes: 1_000_000,
      durationSec: 0,
      sourceChannels: 2,
    });
    expect(result.reachable).toBe(false);
  });
});

describe("stepDown", () => {
  it("steps mp3 down to the previous standard bitrate", () => {
    expect(stepDown("mp3", 128_000)).toBe(112_000);
    expect(stepDown("mp3", 96_000)).toBe(80_000);
  });

  it("returns null once mp3 is already at its lowest standard bitrate", () => {
    expect(stepDown("mp3", 32_000)).toBeNull();
  });

  it("steps aac/opus down by 1 kbps", () => {
    expect(stepDown("aac", 64_000)).toBe(63_000);
  });

  it("returns null once aac/opus reaches the bottom of its scale", () => {
    expect(stepDown("aac", 1000)).toBeNull();
  });
});

describe("targetBytesForPercent", () => {
  it("maps percent to a fraction of the source size", () => {
    expect(targetBytesForPercent(10_000_000, 50)).toBe(5_000_000);
    expect(targetBytesForPercent(10_000_000, 10)).toBe(9_000_000);
    expect(targetBytesForPercent(10_000_000, 90)).toBeCloseTo(1_000_000, 5);
  });
});

describe("bestQualityBitrate", () => {
  it("picks the largest ladder step strictly below the source bitrate", () => {
    expect(bestQualityBitrate("mp3", 200_000)).toBe(192_000);
    expect(bestQualityBitrate("aac", 130_000)).toBe(128_000);
  });

  it("never picks a rate at or above the source's own bitrate", () => {
    const chosen = bestQualityBitrate("mp3", 96_000);
    expect(chosen).toBeLessThan(96_000);
  });

  it("falls back to the default when the source bitrate is unknown", () => {
    expect(bestQualityBitrate("aac", undefined)).toBe(96_000);
    expect(bestQualityBitrate("aac", 0)).toBe(96_000);
  });

  it("falls back rather than picking nothing when the source is already tiny", () => {
    expect(bestQualityBitrate("opus", 20_000)).toBe(96_000);
  });
});
