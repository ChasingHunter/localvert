import { describe, expect, it } from "vitest";
import heicToPdf from "./heic-to-pdf";
import tiffToPdf from "./tiff-to-pdf";

const DECODER = { heic: "heic", tiff: "utif" } as const;

describe.each([
  ["heic", heicToPdf],
  ["tiff", tiffToPdf],
] as const)("%s-to-pdf", (format, tool) => {
  it("decodes, encodes to jpg, then merges into a pdf", () => {
    const steps = tool.pipeline.map((s) => [
      s.op,
      s.from,
      s.to,
      s.candidates[0]?.engine,
    ]);
    expect(steps).toEqual([
      ["decode", format, "raster", DECODER[format]],
      ["encode", "raster", "jpg", "jsquash-jpeg"],
      ["merge", "jpg", "pdf", "pdf-lib"],
    ]);
  });

  it("is a many-to-one tool with the shared images-to-pdf options", () => {
    expect(tool.arity).toBe("many-to-one");
    expect(tool.batch).toBe(false);
    expect(Object.keys(tool.options.shape)).toEqual([
      "pageSize",
      "orientation",
      "margin",
    ]);
  });
});
