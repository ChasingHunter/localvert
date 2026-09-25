import { describe, expect, it } from "vitest";
import { computeResizeDims, parseResizeOptions } from "./resize-box";

describe("parseResizeOptions", () => {
  it("defaults fit to contain and allowUpscale to false", () => {
    expect(parseResizeOptions({})).toEqual({
      width: undefined,
      height: undefined,
      fit: "contain",
      allowUpscale: false,
    });
  });

  it("reads width/height/fit/allowUpscale from raw options", () => {
    expect(
      parseResizeOptions({
        width: 100,
        height: 50,
        fit: "cover",
        allowUpscale: true,
      }),
    ).toEqual({ width: 100, height: 50, fit: "cover", allowUpscale: true });
  });

  it("falls back to contain for an unrecognized fit value", () => {
    expect(parseResizeOptions({ fit: "bogus" }).fit).toBe("contain");
  });

  it("ignores non-number width/height", () => {
    expect(parseResizeOptions({ width: "100", height: null })).toMatchObject({
      width: undefined,
      height: undefined,
    });
  });
});

describe("computeResizeDims", () => {
  it("passes through unchanged when neither width nor height is given", () => {
    expect(
      computeResizeDims(40, 30, {
        fit: "contain",
        allowUpscale: false,
      }),
    ).toEqual({ width: 40, height: 30 });
  });

  it("fit=contain scales down to fit within the box, preserving aspect ratio", () => {
    expect(
      computeResizeDims(100, 50, {
        width: 50,
        height: 50,
        fit: "contain",
        allowUpscale: false,
      }),
    ).toEqual({ width: 50, height: 25 });
  });

  it("fit=cover scales to cover the box, preserving aspect ratio", () => {
    expect(
      computeResizeDims(100, 50, {
        width: 50,
        height: 50,
        fit: "cover",
        allowUpscale: false,
      }),
    ).toEqual({ width: 100, height: 50 });
  });

  it("fit=fill stretches independently on both axes", () => {
    expect(
      computeResizeDims(100, 50, {
        width: 40,
        height: 40,
        fit: "fill",
        allowUpscale: true,
      }),
    ).toEqual({ width: 40, height: 40 });
  });

  it("never upscales past the source size unless allowUpscale is set", () => {
    expect(
      computeResizeDims(20, 20, {
        width: 100,
        height: 100,
        fit: "contain",
        allowUpscale: false,
      }),
    ).toEqual({ width: 20, height: 20 });

    expect(
      computeResizeDims(20, 20, {
        width: 100,
        height: 100,
        fit: "contain",
        allowUpscale: true,
      }),
    ).toEqual({ width: 100, height: 100 });
  });

  it("fit=fill also clamps each axis independently when allowUpscale is false", () => {
    expect(
      computeResizeDims(20, 20, {
        width: 100,
        height: 10,
        fit: "fill",
        allowUpscale: false,
      }),
    ).toEqual({ width: 20, height: 10 });
  });

  it("degenerates to scaling by the one axis given", () => {
    expect(
      computeResizeDims(100, 50, {
        width: 50,
        fit: "contain",
        allowUpscale: false,
      }),
    ).toEqual({ width: 50, height: 25 });

    expect(
      computeResizeDims(100, 50, {
        height: 25,
        fit: "contain",
        allowUpscale: false,
      }),
    ).toEqual({ width: 50, height: 25 });
  });

  it("rounds to whole pixels and never produces a zero dimension", () => {
    const dims = computeResizeDims(3, 1, {
      width: 1,
      fit: "contain",
      allowUpscale: false,
    });
    expect(dims.width).toBe(1);
    expect(dims.height).toBeGreaterThanOrEqual(1);
  });
});
