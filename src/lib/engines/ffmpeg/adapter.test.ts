import { describe, expect, it } from "vitest";
import ffmpeg, { MAX_INPUT_BYTES } from "./adapter";

/**
 * Node-safe unit coverage only — `load()`'s dynamic import of the runtime
 * wasm glue needs a real browser (or vitest's browser mode); that's
 * `adapter.browser.test.ts` territory, same split as `../libraw/adapter.ts`.
 * This file covers what doesn't need the wasm module at all: capability
 * matching and the input-size cap.
 */
describe("ffmpeg adapter", () => {
  it("supports transcode from each legacy video container to mp4", () => {
    expect(ffmpeg.supports("transcode", "avi", "mp4")).toBe(true);
    expect(ffmpeg.supports("transcode", "wmv", "mp4")).toBe(true);
    expect(ffmpeg.supports("transcode", "flv", "mp4")).toBe(true);
  });

  it("supports transcode from wma to mp3 only (audio-only, no video track)", () => {
    expect(ffmpeg.supports("transcode", "wma", "mp3")).toBe(true);
    expect(ffmpeg.supports("transcode", "wma", "mp4")).toBe(false);
  });

  it("also extracts mp3 audio from the legacy video containers", () => {
    expect(ffmpeg.supports("transcode", "avi", "mp3")).toBe(true);
    expect(ffmpeg.supports("transcode", "wmv", "mp3")).toBe(true);
    expect(ffmpeg.supports("transcode", "flv", "mp3")).toBe(true);
  });

  it("does not support other ops, inputs, or outputs", () => {
    expect(ffmpeg.supports("transcode", "avi", "webm")).toBe(false);
    expect(ffmpeg.supports("transcode", "mp4", "mp4")).toBe(false);
    expect(ffmpeg.supports("decode", "avi", "mp4")).toBe(false);
  });

  it("caps input at 1 GiB", () => {
    expect(MAX_INPUT_BYTES).toBe(1024 * 1024 * 1024);
  });

  it("declares itself as a heavy, r2-hosted, GPL engine", () => {
    expect(ffmpeg.heavy).toBe(true);
    expect(ffmpeg.location).toBe("r2");
    expect(ffmpeg.license).toContain("GPL-2.0");
    expect(ffmpeg.marker).toBe("localvert-engine:ffmpeg");
  });
});
