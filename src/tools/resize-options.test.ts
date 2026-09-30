import { describe, expect, it } from "vitest";
import { resizeReady } from "./_resize-options";
import resizeImageJpg from "./image/resize-image-jpg";
import resizeImagePng from "./image/resize-image-png";
import resizeImageWebp from "./image/resize-image-webp";

describe("resize-image-* options", () => {
  for (const tool of [resizeImageJpg, resizeImagePng, resizeImageWebp]) {
    it(`${tool.slug} defaults to 50% and is ready to run on drop`, () => {
      const parsed = tool.options.parse(tool.defaults);
      expect(parsed).toMatchObject({ resizeBy: "percent", percent: 50 });
      expect(tool.readiness?.isReady(tool.defaults)).toBe(true);
    });

    it(`${tool.slug} rejects a percentage outside 10-100`, () => {
      expect(
        tool.options.safeParse({ ...tool.defaults, percent: 5 }).success,
      ).toBe(false);
      expect(
        tool.options.safeParse({ ...tool.defaults, percent: 150 }).success,
      ).toBe(false);
    });
  }
});

describe("resizeReady", () => {
  it("is always ready in percentage mode", () => {
    expect(resizeReady({ resizeBy: "percent" })).toBe(true);
    expect(resizeReady({})).toBe(true);
  });

  it("waits in exact mode until a width or height is set", () => {
    expect(resizeReady({ resizeBy: "exact" })).toBe(false);
    expect(resizeReady({ resizeBy: "exact", width: undefined })).toBe(false);
    expect(resizeReady({ resizeBy: "exact", width: 0 })).toBe(false);
    expect(resizeReady({ resizeBy: "exact", width: 800 })).toBe(true);
    expect(resizeReady({ resizeBy: "exact", height: 600 })).toBe(true);
  });
});
