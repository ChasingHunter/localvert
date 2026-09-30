import { describe, expect, it } from "vitest";
import {
  audioReserveBps,
  bestQualityVideoBitrateBps,
  bppCeiling,
  bppFloor,
  containerOverheadBytes,
  nextTargetSizeRetry,
  planTargetSizeBudget,
  runWithSizeRetries,
  smallestSensibleBytes,
  stepDownForBpp,
  targetBytesFromPercent,
  targetSizeResultNote,
} from "./video-planner";

describe("bestQualityVideoBitrateBps", () => {
  it("caps at 0.7x source when the source is already efficient", () => {
    // 1080p30 H.264 bpp ceiling is 0.15*1920*1080*30 ≈ 9.33 Mbps — a 3 Mbps
    // source is nowhere near it, so 0.7x source must win.
    const result = bestQualityVideoBitrateBps({
      sourceBps: 3_000_000,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "avc",
    });
    expect(result).toBeCloseTo(3_000_000 * 0.7, 0);
  });

  it("caps at the bpp ceiling when the source is dense", () => {
    const ceilingBps = bppCeiling("avc") * 1920 * 1080 * 30;
    const result = bestQualityVideoBitrateBps({
      sourceBps: 50_000_000, // 0.7x would be 35 Mbps, far above the ceiling
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "avc",
    });
    expect(result).toBeCloseTo(ceilingBps, 0);
  });

  it("never returns more than the bpp ceiling when the source is unknown", () => {
    const ceilingBps = bppCeiling("vp9") * 1280 * 720 * 30;
    const result = bestQualityVideoBitrateBps({
      sourceBps: undefined,
      width: 1280,
      height: 720,
      fps: 30,
      codec: "vp9",
    });
    expect(result).toBe(Math.round(ceilingBps));
  });

  it("uses the vp9 (lower) ceiling for vp9 output", () => {
    const params = { width: 1920, height: 1080, fps: 30, sourceBps: undefined };
    expect(
      bestQualityVideoBitrateBps({ ...params, codec: "vp9" }),
    ).toBeLessThan(bestQualityVideoBitrateBps({ ...params, codec: "avc" }));
  });

  it("always returns a positive integer, even for a fractional source bitrate", () => {
    // A real regression: mediabunny's `Quality` constructor rejects a
    // fractional bitrate outright ("must be a positive integer or a
    // quality"), and `InputTrack.getAverageBitrate()` frequently returns
    // one — caught by the e2e suite (compress-video's default "best
    // quality" mode threw on every real browser run before this was fixed).
    const result = bestQualityVideoBitrateBps({
      sourceBps: 3_000_000.7,
      width: 1921,
      height: 817,
      fps: 29.97,
      codec: "avc",
    });
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThan(0);
  });
});

describe("targetBytesFromPercent", () => {
  it("maps 50% to half the source size", () => {
    expect(targetBytesFromPercent(100_000_000, 50)).toBe(50_000_000);
  });

  it("maps 10% (least aggressive) to 90% of the source", () => {
    expect(targetBytesFromPercent(100_000_000, 10)).toBeCloseTo(90_000_000, 5);
  });

  it("maps 90% (most aggressive) to 10% of the source", () => {
    expect(targetBytesFromPercent(100_000_000, 90)).toBeCloseTo(10_000_000, 5);
  });
});

describe("audioReserveBps", () => {
  it("picks the top tier for a generous budget", () => {
    // 5 minutes at a target that gives >2000 kbps total.
    const result = audioReserveBps({
      targetBytes: 200_000_000,
      durationSeconds: 300,
      sourceAudioBps: undefined,
    });
    expect(result).toBe(128_000);
  });

  it("picks the bottom tier for a tight budget", () => {
    const result = audioReserveBps({
      targetBytes: 2_000_000,
      durationSeconds: 300,
      sourceAudioBps: undefined,
    });
    expect(result).toBe(48_000);
  });

  it("never exceeds the source's own audio bitrate", () => {
    const result = audioReserveBps({
      targetBytes: 200_000_000,
      durationSeconds: 300,
      sourceAudioBps: 64_000,
    });
    expect(result).toBe(64_000);
  });

  it("always returns a positive integer, even for a fractional source bitrate", () => {
    const result = audioReserveBps({
      targetBytes: 200_000_000,
      durationSeconds: 300,
      sourceAudioBps: 64_000.3,
    });
    expect(Number.isInteger(result)).toBe(true);
  });
});

describe("containerOverheadBytes", () => {
  it("is 2% of the target plus 32 KB", () => {
    const target = 20 * 1024 * 1024;
    expect(containerOverheadBytes(target)).toBeCloseTo(
      0.02 * target + 32 * 1024,
      5,
    );
  });
});

describe("planTargetSizeBudget", () => {
  it("splits a generous 20 MB / 60s budget into audio + overhead + video", () => {
    const targetBytes = 20 * 1024 * 1024;
    const budget = planTargetSizeBudget({
      targetBytes,
      durationSeconds: 60,
      sourceAudioBps: undefined,
    });
    expect(budget.videoBps).toBeDefined();
    // video_bps = (0.95*T - audioBytes - overhead) * 8 / duration
    const audioBytes = (budget.audioBps * 60) / 8;
    const expectedVideoBps =
      ((0.95 * targetBytes - audioBytes - budget.overheadBytes) * 8) / 60;
    expect(budget.videoBps).toBeCloseTo(expectedVideoBps, 0);
  });

  it("returns undefined videoBps when audio+overhead alone exhaust the target", () => {
    const budget = planTargetSizeBudget({
      targetBytes: 10_000, // 10 KB for a whole minute — impossible
      durationSeconds: 60,
      sourceAudioBps: undefined,
    });
    expect(budget.videoBps).toBeUndefined();
  });
});

describe("nextTargetSizeRetry", () => {
  it("rescales downward by 0.97*T/actual when over target", () => {
    const decision = nextTargetSizeRetry({
      actualBytes: 22_000_000,
      targetBytes: 20_000_000,
      currentBitrateBps: 5_000_000,
      durationSeconds: 60,
      passesUsed: 1,
    });
    expect(decision.done).toBe(false);
    expect(decision.nextBitrateBps).toBeCloseTo(
      5_000_000 * ((0.97 * 20_000_000) / 22_000_000),
      0,
    );
  });

  it("gives up after 2 retries for a short clip", () => {
    const decision = nextTargetSizeRetry({
      actualBytes: 22_000_000,
      targetBytes: 20_000_000,
      currentBitrateBps: 5_000_000,
      durationSeconds: 60,
      passesUsed: 3, // already used the initial pass + 2 retries
    });
    expect(decision.done).toBe(true);
  });

  it("gives up after 1 retry for a clip over 10 minutes", () => {
    const decision = nextTargetSizeRetry({
      actualBytes: 22_000_000,
      targetBytes: 20_000_000,
      currentBitrateBps: 5_000_000,
      durationSeconds: 700,
      passesUsed: 2,
    });
    expect(decision.done).toBe(true);
  });

  it("accepts a result inside the target window", () => {
    const decision = nextTargetSizeRetry({
      actualBytes: 19_500_000,
      targetBytes: 20_000_000,
      currentBitrateBps: 5_000_000,
      durationSeconds: 60,
      passesUsed: 1,
    });
    expect(decision.done).toBe(true);
  });

  it("retries upward for a short clip that undershoots by more than 15%", () => {
    const decision = nextTargetSizeRetry({
      actualBytes: 15_000_000, // 75% of target, and clip is short
      targetBytes: 20_000_000,
      currentBitrateBps: 5_000_000,
      durationSeconds: 90,
      passesUsed: 1,
    });
    expect(decision.done).toBe(false);
    expect(decision.nextBitrateBps).toBeGreaterThan(5_000_000);
  });

  it("does not retry upward for a long clip that undershoots", () => {
    const decision = nextTargetSizeRetry({
      actualBytes: 15_000_000,
      targetBytes: 20_000_000,
      currentBitrateBps: 5_000_000,
      durationSeconds: 400, // over the 3-minute upward-retry cutoff
      passesUsed: 1,
    });
    expect(decision.done).toBe(true);
  });
});

describe("runWithSizeRetries", () => {
  it("retries once when the first pass overshoots, then accepts a fitting pass", async () => {
    const cleaned: number[] = [];
    let calls = 0;
    const result = await runWithSizeRetries({
      targetBytes: 20_000_000,
      durationSeconds: 60,
      initialBitrateBps: 5_000_000,
      encode: async (bitrateBps) => {
        calls++;
        // First pass overshoots (proportional to bitrate); second pass, at
        // the rescaled (lower) bitrate, fits.
        const sizeBytes = calls === 1 ? 22_000_000 : 19_600_000;
        return { sizeBytes, result: { bitrateBps, pass: calls } };
      },
      cleanup: (pass) => {
        cleaned.push(pass.result.pass);
      },
    });
    expect(calls).toBe(2);
    expect(result.passes).toBe(2);
    expect(result.final.result.pass).toBe(2);
    expect(result.final.sizeBytes).toBeLessThanOrEqual(20_000_000);
    // The first (superseded) pass was cleaned up; the final one was not.
    expect(cleaned).toEqual([1]);
  });

  it("needs no retry when the first pass already fits", async () => {
    const result = await runWithSizeRetries({
      targetBytes: 20_000_000,
      durationSeconds: 60,
      initialBitrateBps: 4_000_000,
      encode: async () => ({ sizeBytes: 19_800_000, result: "ok" }),
    });
    expect(result.passes).toBe(1);
    expect(result.final.result).toBe("ok");
  });
});

describe("stepDownForBpp", () => {
  it("keeps the source resolution/fps when the budget already clears the floor", () => {
    // 1080p30 H.264 floor is 0.07*1920*1080*30 ≈ 4.35 Mbps.
    const result = stepDownForBpp({
      videoBps: 6_000_000,
      sourceWidth: 1920,
      sourceHeight: 1080,
      sourceFps: 30,
      codec: "avc",
    });
    expect(result.unreachable).toBe(false);
    if (!result.unreachable) {
      expect(result.height).toBe(1080);
      expect(result.fps).toBe(30);
    }
  });

  it("steps down resolution when the budget is too low at the source size", () => {
    // Way below the 1080p floor, but plenty for 480p or 360p.
    const result = stepDownForBpp({
      videoBps: 700_000,
      sourceWidth: 1920,
      sourceHeight: 1080,
      sourceFps: 30,
      codec: "avc",
    });
    expect(result.unreachable).toBe(false);
    if (!result.unreachable) {
      expect(result.height).toBeLessThan(1080);
      expect(result.bpp).toBeGreaterThanOrEqual(bppFloor("avc"));
    }
  });

  it("caps fps at 360p before giving up", () => {
    // Choose a bitrate that clears the floor at 360p/24fps but not 360p/30fps
    // (fps only enters the denominator, so 24/30 of the 30fps floor bitrate
    // sits just above the floor at 24fps and just below it at 30fps).
    const floor = bppFloor("avc");
    const videoBps = floor * 640 * 360 * 24 * 1.05;
    const result = stepDownForBpp({
      videoBps,
      sourceWidth: 1920,
      sourceHeight: 1080,
      sourceFps: 30,
      codec: "avc",
    });
    expect(result.unreachable).toBe(false);
    if (!result.unreachable) {
      expect(result.height).toBe(360);
      expect(result.fps).toBe(24);
    }
  });

  it("respects maxHeight even when the source is taller", () => {
    const result = stepDownForBpp({
      videoBps: 6_000_000,
      sourceWidth: 1920,
      sourceHeight: 1080,
      sourceFps: 30,
      codec: "avc",
      maxHeight: 720,
    });
    expect(result.unreachable).toBe(false);
    if (!result.unreachable) {
      expect(result.height).toBeLessThanOrEqual(720);
    }
  });

  it("is unreachable below half the floor even at 360p/24fps", () => {
    const floor = bppFloor("avc");
    const videoBps = (floor / 2) * 640 * 360 * 24 * 0.5; // well under half-floor
    const result = stepDownForBpp({
      videoBps,
      sourceWidth: 1920,
      sourceHeight: 1080,
      sourceFps: 30,
      codec: "avc",
    });
    expect(result.unreachable).toBe(true);
    if (result.unreachable) {
      expect(result.smallest.height).toBe(360);
      expect(result.smallest.fps).toBe(24);
    }
  });
});

describe("smallestSensibleBytes", () => {
  it("grows with duration", () => {
    const params = {
      sourceWidth: 1920,
      sourceHeight: 1080,
      codec: "avc" as const,
      audioBps: 48_000,
      overheadBytes: 32 * 1024,
    };
    const short = smallestSensibleBytes({ ...params, durationSeconds: 60 });
    const long = smallestSensibleBytes({ ...params, durationSeconds: 600 });
    expect(long).toBeGreaterThan(short);
  });
});

describe("targetSizeResultNote", () => {
  it("formats a hit outcome with size and percent of target", () => {
    const note = targetSizeResultNote({
      kind: "hit",
      actualBytes: 19.4 * 1024 * 1024,
      targetBytes: 20 * 1024 * 1024,
    });
    expect(note).toBe("19.4 MB, 97% of your 20 MB target.");
  });

  it("formats a resized outcome", () => {
    const note = targetSizeResultNote({
      kind: "resized",
      actualBytes: 19 * 1024 * 1024,
      targetBytes: 20 * 1024 * 1024,
      resizedToHeight: 720,
    });
    expect(note).toBe("Resized to 720p to fit your 20 MB target (19 MB).");
  });

  it("formats an unreachable outcome", () => {
    const note = targetSizeResultNote({
      kind: "unreachable",
      actualBytes: 23 * 1024 * 1024,
    });
    expect(note).toBe("The smallest we could make it is 23 MB.");
  });
});
