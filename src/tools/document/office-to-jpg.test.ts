import { describe, expect, it } from "vitest";
import { enginesNeedingConsent } from "@/lib/engines/consent";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import type { ToolDefinition } from "@/lib/registry";
import excelToJpg from "./excel-to-jpg";
import excelToPdf from "./excel-to-pdf";
import powerpointToJpg from "./powerpoint-to-jpg";
import powerpointToPdf from "./powerpoint-to-pdf";
import wordToJpg from "./word-to-jpg";
import wordToPdf from "./word-to-pdf";

/** office file -> pdf (libreoffice) -> one jpg per page (pdfjs). */
const PAIRS: readonly [string, ToolDefinition, ToolDefinition][] = [
  ["word-to-jpg", wordToJpg, wordToPdf],
  ["powerpoint-to-jpg", powerpointToJpg, powerpointToPdf],
  ["excel-to-jpg", excelToJpg, excelToPdf],
];

describe.each(PAIRS)("%s", (slug, tool, pdfTool) => {
  it("slug matches its file basename", () => {
    expect(tool.slug).toBe(slug);
  });

  it("accepts exactly what the matching to-pdf tool accepts", () => {
    expect(tool.accepts).toEqual(pdfTool.accepts);
  });

  it("runs libreoffice to pdf, then pdfjs render to jpg", () => {
    expect(
      tool.pipeline.map((s) => [s.op, s.from, s.to, s.candidates[0]?.engine]),
    ).toEqual([
      ["transcode", undefined, "pdf", "libreoffice"],
      ["render", "pdf", "jpg", "pdfjs"],
    ]);
  });

  it("is one-to-many and not batch", () => {
    expect(tool.arity).toBe("one-to-many");
    expect(tool.batch).toBe(false);
    expect(tool.produces).toBe("jpg");
  });

  it("asks for the libreoffice download consent", () => {
    expect(enginesNeedingConsent(tool, ENGINE_MANIFEST)).toEqual([
      "libreoffice",
    ]);
  });

  it("exposes resolution and quality, defaults valid", () => {
    expect(Object.keys(tool.options.shape).sort()).toEqual(["dpi", "quality"]);
    expect(tool.options.safeParse(tool.defaults).success).toBe(true);
  });
});
