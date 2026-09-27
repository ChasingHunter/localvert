import { QUALITY_HIGH, QUALITY_LOW, QUALITY_MEDIUM } from "mediabunny";
import { describe, expect, it } from "vitest";
import {
  dimensionsForPreset,
  isVideoContainer,
  qualityForPreset,
  resizeToVideoOptions,
  rotationFor,
  validateTrim,
} from "./video";

describe("isVideoContainer", () => {
  it("accepts exactly the four containers this slice writes", () => {
    expect(isVideoContainer("mp4")).toBe(true);
    expect(isVideoContainer("mov")).toBe(true);
    expect(isVideoContainer("webm")).toBe(true);
    expect(isVideoContainer("mkv")).toBe(true);
    expect(isVideoContainer("jpg")).toBe(false);
    expect(isVideoContainer("raster")).toBe(false);
  });
});

describe("qualityForPreset", () => {
  it("maps each preset to mediabunny's own Quality constant", () => {
    expect(qualityForPreset("low")).toBe(QUALITY_LOW);
    expect(qualityForPreset("medium")).toBe(QUALITY_MEDIUM);
    expect(qualityForPreset("high")).toBe(QUALITY_HIGH);
  });
});

describe("dimensionsForPreset", () => {
  it("maps each preset to its target height", () => {
    expect(dimensionsForPreset("1080p")).toEqual({ height: 1080 });
    expect(dimensionsForPreset("720p")).toEqual({ height: 720 });
    expect(dimensionsForPreset("480p")).toEqual({ height: 480 });
  });
});

describe("resizeToVideoOptions", () => {
  it("expands a preset to its height, defaulting fit to contain", () => {
    expect(resizeToVideoOptions({ preset: "720p" })).toEqual({
      height: 720,
      fit: "contain",
    });
  });

  it("keeps an explicit fit alongside a preset", () => {
    expect(resizeToVideoOptions({ preset: "1080p", fit: "cover" })).toEqual({
      height: 1080,
      fit: "cover",
    });
  });

  it("passes through explicit width/height when no preset is set", () => {
    expect(resizeToVideoOptions({ width: 160, height: 120 })).toEqual({
      width: 160,
      height: 120,
      fit: "contain",
    });
  });
});

describe("validateTrim", () => {
  it("accepts an end strictly greater than start", () => {
    expect(validateTrim(0, 1)).toEqual({ ok: true });
    expect(validateTrim(2, 5)).toEqual({ ok: true });
  });

  it("rejects an end equal to or before start", () => {
    expect(validateTrim(1, 1)).toEqual({
      ok: false,
      message: expect.stringContaining("greater than start"),
    });
    expect(validateTrim(5, 2).ok).toBe(false);
  });
});

describe("rotationFor", () => {
  it("passes the degree value straight through", () => {
    expect(rotationFor(90)).toBe(90);
    expect(rotationFor(180)).toBe(180);
    expect(rotationFor(270)).toBe(270);
  });
});
