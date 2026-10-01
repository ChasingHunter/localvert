import { describe, expect, it } from "vitest";
import { resolvePipeline } from "@/lib/router";
import { makeCaps } from "@/test/caps";
import avifToWebp from "./avif-to-webp";
import gifToWebp from "./gif-to-webp";
import heicToWebp from "./heic-to-webp";
import svgToWebp from "./svg-to-webp";

const DECODER = {
  heic: "heic",
  avif: "jsquash-avif",
  gif: "canvas",
  svg: "resvg",
} as const;

describe.each([
  ["heic", heicToWebp],
  ["avif", avifToWebp],
  ["gif", gifToWebp],
  ["svg", svgToWebp],
] as const)("%s-to-webp", (from, tool) => {
  it("is a batch image tool that produces webp from one format", () => {
    expect(tool.slug).toBe(`${from}-to-webp`);
    expect(tool.accepts).toEqual([from]);
    expect(tool.produces).toBe("webp");
    expect(tool.batch).toBe(true);
  });

  it("decodes with the right engine and encodes with jsquash-webp", () => {
    const resolved = resolvePipeline(tool, makeCaps());
    if (resolved instanceof Error) throw resolved;
    expect(resolved.map((s) => [s.op, s.engine])).toEqual([
      ["decode", DECODER[from]],
      ["encode", "jsquash-webp"],
    ]);
  });

  it("defaults satisfy the options schema", () => {
    expect(tool.options.safeParse(tool.defaults).success).toBe(true);
  });
});
