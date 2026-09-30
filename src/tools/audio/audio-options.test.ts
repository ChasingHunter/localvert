import { describe, expect, it } from "vitest";
import { sampleRateOf } from "@/lib/engines/mediabunny/audio";
import { TOOLS_BY_SLUG } from "../index";

const PLAIN_CONVERTERS = [
  "aac-to-mp3",
  "flac-to-mp3",
  "flac-to-wav",
  "m4a-to-mp3",
  "m4a-to-wav",
  "mov-to-mp3",
  "mp3-to-m4a",
  "mp3-to-ogg",
  "mp3-to-wav",
  "mp4-to-mp3",
  "ogg-to-mp3",
  "opus-to-mp3",
  "wav-to-flac",
  "wav-to-mp3",
  "webm-to-mp3",
  "wma-to-mp3",
  "extract-audio",
];

describe("audio converters", () => {
  it("plain format converters offer no sample rate or channels", () => {
    for (const slug of PLAIN_CONVERTERS) {
      const tool = TOOLS_BY_SLUG.get(slug);
      if (!tool) throw new Error(`missing tool ${slug}`);
      expect(Object.keys(tool.options.shape), slug).not.toContain("sampleRate");
      expect(Object.keys(tool.options.shape), slug).not.toContain("channels");
    }
  });

  it("lossy converters still offer bitrate, and defaults parse", () => {
    for (const slug of ["mp4-to-mp3", "mp3-to-m4a", "extract-audio"]) {
      const tool = TOOLS_BY_SLUG.get(slug);
      if (!tool) throw new Error(`missing tool ${slug}`);
      expect(Object.keys(tool.options.shape), slug).toContain("bitrate");
      expect(tool.options.safeParse(tool.defaults).success, slug).toBe(true);
    }
  });

  it("compress-audio keeps its channels option", () => {
    const tool = TOOLS_BY_SLUG.get("compress-audio");
    expect(Object.keys(tool?.options.shape ?? {})).toContain("channels");
  });

  it("an absent sample rate means keep the source's own", () => {
    expect(sampleRateOf({})).toBeUndefined();
  });
});
