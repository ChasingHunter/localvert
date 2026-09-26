import { describe, expect, it } from "vitest";
import { resolvePipeline } from "@/lib/router";
import { makeCaps } from "@/test/caps";
import sanitizePdf from "./sanitize-pdf";

const CAPS = makeCaps();

describe("sanitize-pdf", () => {
  it("resolves sanitize to pdf-lib", () => {
    expect(resolvePipeline(sanitizePdf, CAPS)).toEqual([
      { op: "sanitize", engine: "pdf-lib" },
    ]);
  });

  it("defaults parse: metadata/javascript/attachments on, links off", () => {
    const parsed = sanitizePdf.options.safeParse(sanitizePdf.defaults);
    expect(parsed).toMatchObject({
      success: true,
      data: {
        metadata: true,
        javascript: true,
        attachments: true,
        links: false,
      },
    });
  });

  it("accepts every switch flipped the other way", () => {
    const parsed = sanitizePdf.options.safeParse({
      metadata: false,
      javascript: false,
      attachments: false,
      links: true,
    });
    expect(parsed).toMatchObject({
      success: true,
      data: {
        metadata: false,
        javascript: false,
        attachments: false,
        links: true,
      },
    });
  });

  it("rejects a non-boolean value for a switch option", () => {
    expect(
      sanitizePdf.options.safeParse({
        ...sanitizePdf.defaults,
        metadata: "yes",
      }).success,
    ).toBe(false);
  });
});
