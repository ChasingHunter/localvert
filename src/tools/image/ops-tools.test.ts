import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@/lib/registry";
import { resolvePipeline } from "@/lib/router";
import { makeCaps } from "@/test/caps";
import compressJpg from "./compress-jpg";
import compressWebp from "./compress-webp";
import resizeImageJpg from "./resize-image-jpg";
import resizeImagePng from "./resize-image-png";
import resizeImageWebp from "./resize-image-webp";
import rotateJpg from "./rotate-jpg";
import rotatePng from "./rotate-png";
import rotateWebp from "./rotate-webp";

const CAPS = makeCaps();

/**
 * Every tool `defineTool`-checked (accepts/produces are known formats,
 * defaults satisfy options, every pipeline step has a candidate) just by
 * importing without throwing — this file importing all eight at the top
 * already proves that. These tests additionally check the two things
 * `defineTool` itself doesn't: that `resolvePipeline` picks the *expected*
 * engine per step (not just *some* engine), and that a fresh
 * `options.safeParse(defaults)` round-trip still succeeds and returns the
 * values these tools actually expect their engines to receive.
 */
function expectEngines(
  tool: ToolDefinition,
  expected: readonly { op: string; engine: string }[],
): void {
  const resolved = resolvePipeline(tool, CAPS);
  expect(resolved).toEqual(expected);
}

describe("compress-jpg", () => {
  it("resolves decode + encode to jsquash-jpeg", () => {
    expectEngines(compressJpg, [
      { op: "decode", engine: "jsquash-jpeg" },
      { op: "encode", engine: "jsquash-jpeg" },
    ]);
  });

  it("defaults parse, with quality set and targetSizeKB absent", () => {
    const parsed = compressJpg.options.safeParse(compressJpg.defaults);
    expect(parsed).toMatchObject({
      success: true,
      data: { quality: 0.75, targetSizeKB: undefined },
    });
  });

  it("accepts a valid targetSizeKB alongside the quality default", () => {
    const parsed = compressJpg.options.safeParse({ targetSizeKB: 200 });
    expect(parsed).toMatchObject({
      success: true,
      data: { targetSizeKB: 200, quality: 0.75 },
    });
  });

  it("rejects a targetSizeKB below 1", () => {
    expect(compressJpg.options.safeParse({ targetSizeKB: 0 }).success).toBe(
      false,
    );
  });
});

describe("compress-webp", () => {
  it("resolves decode + encode to jsquash-webp", () => {
    expectEngines(compressWebp, [
      { op: "decode", engine: "jsquash-webp" },
      { op: "encode", engine: "jsquash-webp" },
    ]);
  });

  it("defaults parse", () => {
    expect(compressWebp.options.safeParse(compressWebp.defaults).success).toBe(
      true,
    );
  });
});

describe("resize-image-jpg", () => {
  it("resolves decode -> resize -> encode to jsquash-jpeg / jsquash-resize / jsquash-jpeg", () => {
    expectEngines(resizeImageJpg, [
      { op: "decode", engine: "jsquash-jpeg" },
      { op: "resize", engine: "jsquash-resize" },
      { op: "encode", engine: "jsquash-jpeg" },
    ]);
  });

  it("defaults parse to contain/no-upscale/0.75 quality with width/height unset", () => {
    const parsed = resizeImageJpg.options.safeParse(resizeImageJpg.defaults);
    expect(parsed).toMatchObject({
      success: true,
      data: {
        fit: "contain",
        allowUpscale: false,
        quality: 0.75,
        width: undefined,
        height: undefined,
      },
    });
  });
});

describe("resize-image-png", () => {
  it("resolves decode -> resize -> encode to jsquash-png / jsquash-resize / jsquash-png", () => {
    expectEngines(resizeImagePng, [
      { op: "decode", engine: "jsquash-png" },
      { op: "resize", engine: "jsquash-resize" },
      { op: "encode", engine: "jsquash-png" },
    ]);
  });

  it("defaults parse with no quality field", () => {
    const parsed = resizeImagePng.options.safeParse(resizeImagePng.defaults);
    expect(parsed).toMatchObject({ success: true });
    expect(parsed.success && "quality" in parsed.data).toBe(false);
  });
});

describe("resize-image-webp", () => {
  it("resolves decode -> resize -> encode to jsquash-webp / jsquash-resize / jsquash-webp", () => {
    expectEngines(resizeImageWebp, [
      { op: "decode", engine: "jsquash-webp" },
      { op: "resize", engine: "jsquash-resize" },
      { op: "encode", engine: "jsquash-webp" },
    ]);
  });

  it("defaults parse", () => {
    expect(
      resizeImageWebp.options.safeParse(resizeImageWebp.defaults).success,
    ).toBe(true);
  });
});

describe("rotate-jpg", () => {
  it("resolves decode -> rotate -> encode to jsquash-jpeg / canvas / jsquash-jpeg", () => {
    expectEngines(rotateJpg, [
      { op: "decode", engine: "jsquash-jpeg" },
      { op: "rotate", engine: "canvas" },
      { op: "encode", engine: "jsquash-jpeg" },
    ]);
  });

  it("defaults to rotate '90' as a string (canvas coerces it, see its doc comment)", () => {
    const parsed = rotateJpg.options.safeParse(rotateJpg.defaults);
    expect(parsed).toMatchObject({ success: true, data: { rotate: "90" } });
  });

  it("rejects a rotate value outside the enum", () => {
    expect(rotateJpg.options.safeParse({ rotate: "45" }).success).toBe(false);
    expect(rotateJpg.options.safeParse({ rotate: 90 }).success).toBe(false);
  });
});

describe("rotate-png", () => {
  it("resolves decode -> rotate -> encode to jsquash-png / canvas / jsquash-png", () => {
    expectEngines(rotatePng, [
      { op: "decode", engine: "jsquash-png" },
      { op: "rotate", engine: "canvas" },
      { op: "encode", engine: "jsquash-png" },
    ]);
  });

  it("defaults parse", () => {
    expect(rotatePng.options.safeParse(rotatePng.defaults).success).toBe(true);
  });
});

describe("rotate-webp", () => {
  it("resolves decode -> rotate -> encode to jsquash-webp / canvas / jsquash-webp", () => {
    expectEngines(rotateWebp, [
      { op: "decode", engine: "jsquash-webp" },
      { op: "rotate", engine: "canvas" },
      { op: "encode", engine: "jsquash-webp" },
    ]);
  });

  it("defaults parse", () => {
    expect(rotateWebp.options.safeParse(rotateWebp.defaults).success).toBe(
      true,
    );
  });
});
