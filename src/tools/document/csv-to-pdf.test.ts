import { describe, expect, it } from "vitest";
import { enginesNeedingConsent } from "@/lib/engines/consent";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import csvToPdf from "./csv-to-pdf";

describe("csv-to-pdf", () => {
  it("writes an xlsx with the data engine, then prints it with libreoffice", () => {
    expect(
      csvToPdf.pipeline.map((s) => [
        s.op,
        s.from,
        s.to,
        s.candidates[0]?.engine,
      ]),
    ).toEqual([
      ["transcode", "csv", "xlsx", "data"],
      ["transcode", "xlsx", "pdf", "libreoffice"],
    ]);
  });

  it("asks for the libreoffice download consent", () => {
    expect(enginesNeedingConsent(csvToPdf, ENGINE_MANIFEST)).toEqual([
      "libreoffice",
    ]);
  });

  it("defaults satisfy the csv input options", () => {
    expect(csvToPdf.options.safeParse(csvToPdf.defaults).success).toBe(true);
  });
});
