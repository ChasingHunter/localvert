import { describe, expect, it } from "vitest";
import type { EngineTask } from "../types";
import {
  bitrateOf,
  chosenOutputFormat,
  numberOfChannelsOf,
  sampleRateOf,
  supportsAudioTranscode,
} from "./audio";

/** Minimal `EngineTask`, just enough for the pure option-mapping helpers
 * below — none of them touch `signal`/`onProgress`/`input` beyond what's
 * declared here. */
function taskWith(
  options: Readonly<Record<string, unknown>>,
  outputFormat: EngineTask["outputFormat"] = "mp3",
): EngineTask {
  return {
    op: "transcode",
    input: { kind: "bytes", bytes: new ArrayBuffer(0) },
    inputFormat: "wav",
    outputFormat,
    options,
    signal: new AbortController().signal,
  };
}

describe("supportsAudioTranscode", () => {
  it("accepts every declared audio conversion pair", () => {
    expect(supportsAudioTranscode("transcode", "wav", "mp3")).toBe(true);
    expect(supportsAudioTranscode("transcode", "mp3", "wav")).toBe(true);
    expect(supportsAudioTranscode("transcode", "flac", "mp3")).toBe(true);
    expect(supportsAudioTranscode("transcode", "m4a", "mp3")).toBe(true);
    expect(supportsAudioTranscode("transcode", "ogg", "mp3")).toBe(true);
    expect(supportsAudioTranscode("transcode", "mp3", "ogg")).toBe(true);
    expect(supportsAudioTranscode("transcode", "wav", "flac")).toBe(true);
    expect(supportsAudioTranscode("transcode", "mp3", "m4a")).toBe(true);
    expect(supportsAudioTranscode("transcode", "mp4", "mp3")).toBe(true);
    expect(supportsAudioTranscode("transcode", "mov", "opus")).toBe(true);
    expect(supportsAudioTranscode("transcode", "webm", "wav")).toBe(true);
    expect(supportsAudioTranscode("transcode", "aac", "mp3")).toBe(true);
    expect(supportsAudioTranscode("transcode", "opus", "mp3")).toBe(true);
  });

  it("rejects a non-transcode op", () => {
    expect(supportsAudioTranscode("decode", "wav", "mp3")).toBe(false);
  });

  it("rejects an output format this file doesn't produce", () => {
    expect(supportsAudioTranscode("transcode", "wav", "webm")).toBe(false);
  });

  it("rejects an input format this file doesn't read", () => {
    expect(supportsAudioTranscode("transcode", "png", "mp3")).toBe(false);
  });
});

describe("bitrateOf", () => {
  it("converts a kbps select value to bits per second", () => {
    expect(bitrateOf({ bitrate: "192" })).toBe(192_000);
    expect(bitrateOf({ bitrate: "320" })).toBe(320_000);
    expect(bitrateOf({ bitrate: "96" })).toBe(96_000);
  });

  it("is undefined when the field is absent (a lossless-target tool)", () => {
    expect(bitrateOf({})).toBeUndefined();
  });

  it("is undefined for a non-string value", () => {
    expect(bitrateOf({ bitrate: 192 })).toBeUndefined();
  });
});

describe("sampleRateOf", () => {
  it("parses an explicit sample rate", () => {
    expect(sampleRateOf({ sampleRate: "44100" })).toBe(44_100);
    expect(sampleRateOf({ sampleRate: "48000" })).toBe(48_000);
  });

  it('is undefined for "keep" — pass the source\'s own rate through', () => {
    expect(sampleRateOf({ sampleRate: "keep" })).toBeUndefined();
  });

  it("is undefined when absent", () => {
    expect(sampleRateOf({})).toBeUndefined();
  });
});

describe("numberOfChannelsOf", () => {
  it("maps mono/stereo to 1/2", () => {
    expect(numberOfChannelsOf({ channels: "mono" })).toBe(1);
    expect(numberOfChannelsOf({ channels: "stereo" })).toBe(2);
  });

  it('is undefined for "keep" or absent', () => {
    expect(numberOfChannelsOf({ channels: "keep" })).toBeUndefined();
    expect(numberOfChannelsOf({})).toBeUndefined();
  });
});

describe("chosenOutputFormat", () => {
  it("falls back to task.outputFormat when no format option is set", () => {
    expect(chosenOutputFormat(taskWith({}, "mp3"))).toBe("mp3");
  });

  it("prefers a valid options.format over task.outputFormat — extract-audio's escape hatch", () => {
    expect(chosenOutputFormat(taskWith({ format: "wav" }, "mp3"))).toBe("wav");
    expect(chosenOutputFormat(taskWith({ format: "opus" }, "mp3"))).toBe(
      "opus",
    );
  });

  it("ignores an options.format that isn't a real FormatId", () => {
    expect(
      chosenOutputFormat(taskWith({ format: "not-a-format" }, "mp3")),
    ).toBe("mp3");
    expect(chosenOutputFormat(taskWith({ format: 42 }, "mp3"))).toBe("mp3");
  });
});
