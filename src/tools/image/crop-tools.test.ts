import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@/lib/registry";
import { resolvePipeline } from "@/lib/router";
import { makeCaps } from "@/test/caps";
import cropJpg from "./crop-jpg";
import cropPng from "./crop-png";
import cropWebp from "./crop-webp";

const CAPS = makeCaps();

/**
 * Same reasoning as `ops-tools.test.ts`: importing all three tools at the
 * top already proves `defineTool`'s own checks pass (accepts/produces are
 * known formats, defaults satisfy options, every pipeline step has a
 * candidate). These tests additionally check that `resolvePipeline` picks
 * the *expected* engine per step, that `crop` resolves to `canvas` (its
 * only candidate — `TRANSFORM_PREFERENCE.crop` in
 * `src/lib/registry/image-pipeline.ts`), and that the options schema
 * accepts/rejects `crop` values the way `CropEditor` and the `canvas`
 * engine's `runCrop` expect.
 */
function expectEngines(
  tool: ToolDefinition,
  expected: readonly { op: string; engine: string }[],
): void {
  const resolved = resolvePipeline(tool, CAPS);
  expect(resolved).toEqual(expected);
}

describe("crop-jpg", () => {
  it("resolves decode -> crop -> encode to jsquash-jpeg / canvas / jsquash-jpeg", () => {
    expectEngines(cropJpg, [
      { op: "decode", engine: "jsquash-jpeg" },
      { op: "crop", engine: "canvas" },
      { op: "encode", engine: "jsquash-jpeg" },
    ]);
  });

  it("is not a batch tool", () => {
    expect(cropJpg.batch).toBe(false);
  });

  it("defaults parse with crop absent", () => {
    const parsed = cropJpg.options.safeParse(cropJpg.defaults);
    expect(parsed).toMatchObject({
      success: true,
      data: { quality: 0.85, background: "#ffffff" },
    });
    expect(parsed.success && "crop" in parsed.data).toBe(false);
  });

  it("accepts a valid crop rectangle alongside the quality default", () => {
    const parsed = cropJpg.options.safeParse({
      crop: { x: 10, y: 20, width: 100, height: 50 },
    });
    expect(parsed).toMatchObject({
      success: true,
      data: { crop: { x: 10, y: 20, width: 100, height: 50 }, quality: 0.85 },
    });
  });

  it("rejects a non-integer or negative crop field", () => {
    expect(
      cropJpg.options.safeParse({
        crop: { x: 0.5, y: 0, width: 10, height: 10 },
      }).success,
    ).toBe(false);
    expect(
      cropJpg.options.safeParse({
        crop: { x: -1, y: 0, width: 10, height: 10 },
      }).success,
    ).toBe(false);
  });
});

describe("crop-png", () => {
  it("resolves decode -> crop -> encode to jsquash-png / canvas / jsquash-png", () => {
    expectEngines(cropPng, [
      { op: "decode", engine: "jsquash-png" },
      { op: "crop", engine: "canvas" },
      { op: "encode", engine: "jsquash-png" },
    ]);
  });

  it("is not a batch tool", () => {
    expect(cropPng.batch).toBe(false);
  });

  it("defaults parse with no quality field and crop absent", () => {
    const parsed = cropPng.options.safeParse(cropPng.defaults);
    expect(parsed).toMatchObject({ success: true });
    expect(
      parsed.success &&
        "quality" in parsed.data === false &&
        "crop" in parsed.data === false,
    ).toBe(true);
  });
});

describe("crop-webp", () => {
  it("resolves decode -> crop -> encode to jsquash-webp / canvas / jsquash-webp", () => {
    expectEngines(cropWebp, [
      { op: "decode", engine: "jsquash-webp" },
      { op: "crop", engine: "canvas" },
      { op: "encode", engine: "jsquash-webp" },
    ]);
  });

  it("is not a batch tool", () => {
    expect(cropWebp.batch).toBe(false);
  });

  it("defaults parse with crop absent", () => {
    const parsed = cropWebp.options.safeParse(cropWebp.defaults);
    expect(parsed).toMatchObject({
      success: true,
      data: { quality: 0.85, lossless: false },
    });
    expect(parsed.success && "crop" in parsed.data).toBe(false);
  });
});
