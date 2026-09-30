import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@/lib/registry/types";
import { computeEstimateText, shouldStageForEstimate } from "./index";

describe("shouldStageForEstimate", () => {
  it("stages video's target-size/reduce-percent modes only", () => {
    expect(shouldStageForEstimate("video", { mode: "target-size" })).toBe(true);
    expect(shouldStageForEstimate("video", { mode: "reduce-percent" })).toBe(
      true,
    );
    expect(shouldStageForEstimate("video", { mode: "best-quality" })).toBe(
      false,
    );
    expect(shouldStageForEstimate("video", { mode: "custom" })).toBe(false);
  });

  it("stages audio's target-size/percent modes only", () => {
    expect(shouldStageForEstimate("audio", { mode: "target-size" })).toBe(true);
    expect(shouldStageForEstimate("audio", { mode: "percent" })).toBe(true);
    expect(shouldStageForEstimate("audio", { mode: "best" })).toBe(false);
  });

  it("stages pdf's target-size/percent modes only", () => {
    expect(shouldStageForEstimate("pdf", { mode: "target-size" })).toBe(true);
    expect(shouldStageForEstimate("pdf", { mode: "lossless" })).toBe(false);
  });

  it("never stages a tool with no estimateKind", () => {
    expect(shouldStageForEstimate(undefined, { mode: "target-size" })).toBe(
      false,
    );
  });
});

describe("computeEstimateText", () => {
  const videoTool = { estimateKind: "video" } as ToolDefinition;
  const audioTool = { estimateKind: "audio" } as ToolDefinition;
  const pdfTool = { estimateKind: "pdf" } as ToolDefinition;

  it("returns undefined for a fixed-preset mode (no target to estimate)", () => {
    const text = computeEstimateText(
      videoTool,
      { mode: "custom" },
      { durationSeconds: 10, width: 1920, height: 1080, fps: 30 },
      1_000_000,
      "mp4",
    );
    expect(text).toBeUndefined();
  });

  it("computes a video target-size estimate end to end", () => {
    const text = computeEstimateText(
      videoTool,
      { mode: "target-size", targetSizeMB: 20 },
      {
        durationSeconds: 30,
        width: 1920,
        height: 1080,
        fps: 30,
        videoBitrate: 8_000_000,
        audioBitrate: 128_000,
      },
      50_000_000,
      "mp4",
    );
    expect(text).toMatch(/About 20 MB/);
  });

  it("computes an audio best-quality estimate end to end", () => {
    const text = computeEstimateText(
      audioTool,
      { mode: "best" },
      { durationSeconds: 60, audioChannels: 2 },
      2_000_000,
      "mp3",
    );
    expect(text).toMatch(/Usually around/);
  });

  it("computes a pdf percent estimate end to end", () => {
    const text = computeEstimateText(
      pdfTool,
      { mode: "percent", percent: 50 },
      { pageCount: 5, imageBytes: 8 * 1024 * 1024, nonImageBytes: 200_000 },
      10 * 1024 * 1024,
      "pdf",
    );
    expect(text).toBeDefined();
  });
});
