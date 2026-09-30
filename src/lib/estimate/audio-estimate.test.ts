import { describe, expect, it } from "vitest";
import {
  bestQualityBitrate,
  bitrateForTargetSize,
} from "@/lib/engines/mediabunny/audio-target";
import {
  audioCodecForFormat,
  estimateAudioBestQuality,
  estimateAudioTargetSize,
} from "./audio-estimate";

describe("audioCodecForFormat", () => {
  it("maps compress-audio's accepted formats to their codec", () => {
    expect(audioCodecForFormat("mp3")).toBe("mp3");
    expect(audioCodecForFormat("m4a")).toBe("aac");
    expect(audioCodecForFormat("ogg")).toBe("opus");
    expect(audioCodecForFormat("opus")).toBe("opus");
  });

  it("returns undefined for a format this tool never estimates for", () => {
    expect(audioCodecForFormat("wav")).toBeUndefined();
  });
});

describe("estimateAudioBestQuality", () => {
  it("matches bestQualityBitrate's own bitrate turned into a size", () => {
    const probe = {
      durationSeconds: 100,
      channels: 2,
      sourceBitrateBps: 192_000,
    };
    const text = estimateAudioBestQuality("mp3", probe);
    const bitrate = bestQualityBitrate("mp3", probe.sourceBitrateBps);
    const bytes = (bitrate * probe.durationSeconds) / 8;
    const expectedMB = (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");
    expect(text).toContain("Usually around");
    expect(text).toContain(expectedMB);
  });
});

describe("estimateAudioTargetSize", () => {
  it("reports stereo and a bitrate when the target is comfortably reachable", () => {
    const probe = { durationSeconds: 60, channels: 2 };
    const targetBytes = 10 * 1024 * 1024;
    const text = estimateAudioTargetSize({ codec: "mp3", targetBytes, probe });
    const picked = bitrateForTargetSize({
      codec: "mp3",
      targetBytes,
      durationSec: probe.durationSeconds,
      sourceChannels: probe.channels,
    });
    expect(picked.reachable).toBe(true);
    expect(text).toContain("stereo");
    expect(text).toContain(`${Math.round(picked.bitrateBps / 1000)} kbps`);
  });

  it("reports mono when the target forces a downmix", () => {
    const probe = { durationSeconds: 600, channels: 2 };
    // A small target over a long duration forces the mono floor.
    const targetBytes = 3 * 1024 * 1024;
    const text = estimateAudioTargetSize({ codec: "opus", targetBytes, probe });
    const picked = bitrateForTargetSize({
      codec: "opus",
      targetBytes,
      durationSec: probe.durationSeconds,
      sourceChannels: probe.channels,
    });
    expect(picked.reachable).toBe(true);
    expect(picked.channels).toBe(1);
    expect(text).toContain("mono");
  });

  it("reports unreachable when even the mono floor overshoots", () => {
    const probe = { durationSeconds: 600, channels: 2 };
    const targetBytes = 1024;
    const text = estimateAudioTargetSize({ codec: "mp3", targetBytes, probe });
    expect(text).toContain("smallest we could make it");
  });
});
