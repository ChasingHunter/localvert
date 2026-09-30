import { describe, expect, it } from "vitest";
import {
  bestQualityVideoBitrateBps,
  planTargetSizeBudget,
  smallestSensibleBytes,
  stepDownForBpp,
} from "@/lib/engines/mediabunny/video-planner";
import {
  estimateVideoBestQuality,
  estimateVideoTargetSize,
} from "./video-estimate";

describe("estimateVideoBestQuality", () => {
  it("matches bestQualityVideoBitrateBps's own bitrate turned into a size", () => {
    const probe = {
      durationSeconds: 10,
      width: 1920,
      height: 1080,
      fps: 30,
      videoBitrate: 3_000_000,
      audioBitrate: 128_000,
    };
    const text = estimateVideoBestQuality(probe, "avc");
    const expectedVideoBps = bestQualityVideoBitrateBps({
      sourceBps: probe.videoBitrate,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      codec: "avc",
    });
    const expectedBytes =
      ((expectedVideoBps + probe.audioBitrate) * probe.durationSeconds) / 8;
    const expectedMB = (expectedBytes / (1024 * 1024)).toFixed(1);
    expect(text).toContain("Usually around");
    expect(text).toContain(expectedMB.replace(/\.0$/, ""));
  });
});

describe("estimateVideoTargetSize", () => {
  const probe = {
    durationSeconds: 60,
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: 8_000_000,
    audioBitrate: 128_000,
  };

  it("reports the source resolution when no step-down is needed", () => {
    const targetBytes = 50 * 1024 * 1024; // generous — no downscale needed
    const text = estimateVideoTargetSize({ targetBytes, probe, codec: "avc" });

    const budget = planTargetSizeBudget({
      targetBytes,
      durationSeconds: probe.durationSeconds,
      sourceAudioBps: probe.audioBitrate,
    });
    expect(budget.videoBps).toBeDefined();
    const step = stepDownForBpp({
      videoBps: budget.videoBps as number,
      sourceWidth: probe.width,
      sourceHeight: probe.height,
      sourceFps: probe.fps,
      codec: "avc",
    });
    expect(step.unreachable).toBe(false);
    if (!step.unreachable) {
      expect(text).toContain(`${step.height}p`);
      expect(text).not.toContain("resized");
    }
  });

  it("reports a resized resolution when the budget forces a step-down", () => {
    const targetBytes = 1 * 1024 * 1024; // tight — forces a downscale
    const text = estimateVideoTargetSize({ targetBytes, probe, codec: "avc" });
    expect(text).toMatch(/resized to fit|Too small/);
  });

  it("reports unreachable when even the smallest rung can't hit the target", () => {
    const targetBytes = 1024; // absurdly small
    const text = estimateVideoTargetSize({ targetBytes, probe, codec: "avc" });
    const budget = planTargetSizeBudget({
      targetBytes,
      durationSeconds: probe.durationSeconds,
      sourceAudioBps: probe.audioBitrate,
    });
    const smallest = smallestSensibleBytes({
      durationSeconds: probe.durationSeconds,
      sourceWidth: probe.width,
      sourceHeight: probe.height,
      codec: "avc",
      audioBps: budget.audioBps,
      overheadBytes: budget.overheadBytes,
    });
    expect(text).toContain("Too small for this video");
    const expectedMB = (smallest / (1024 * 1024))
      .toFixed(1)
      .replace(/\.0$/, "");
    expect(text).toContain(expectedMB);
  });

  it("respects maxHeight when deciding whether a resize happened", () => {
    const targetBytes = 30 * 1024 * 1024;
    const text = estimateVideoTargetSize({
      targetBytes,
      probe,
      codec: "avc",
      maxHeight: 720,
    });
    expect(text).toContain("720p");
  });
});
