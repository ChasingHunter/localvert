import { PdfStandardFont } from "@embedpdf/models";
import { describe, expect, it } from "vitest";
import {
  matchDocumentFont,
  nearestStandardFont,
  nearestTextObject,
} from "./font-match";
import type { TextObjectInfo } from "./text-edit-protocol";

describe("nearestStandardFont", () => {
  it("maps a subset-prefixed bold Times name to Times-Bold", () => {
    expect(nearestStandardFont("ABCDEE+TimesNewRomanPS-BoldMT").font).toBe(
      PdfStandardFont.Times_Bold,
    );
  });

  it("maps an italic Arial to Helvetica-Oblique", () => {
    expect(nearestStandardFont("Arial-ItalicMT").font).toBe(
      PdfStandardFont.Helvetica_Oblique,
    );
  });

  it("maps CourierNewPSMT to plain Courier", () => {
    expect(nearestStandardFont("CourierNewPSMT").font).toBe(
      PdfStandardFont.Courier,
    );
  });

  it("maps an unrecognized sans name (Calibri) to plain Helvetica", () => {
    expect(nearestStandardFont("Calibri").font).toBe(PdfStandardFont.Helvetica);
  });

  it("maps a bold Garamond to Times-Bold (Garamond is a serif hint)", () => {
    expect(nearestStandardFont("Garamond-Bold").font).toBe(
      PdfStandardFont.Times_Bold,
    );
    expect(nearestStandardFont("Garamond-Bold").familyLabel).toBe(
      "Serif (Times)",
    );
  });

  it("maps a mono family name (DejaVuSansMono) to plain Courier", () => {
    expect(nearestStandardFont("DejaVuSansMono").font).toBe(
      PdfStandardFont.Courier,
    );
  });

  it("maps plain Helvetica to itself", () => {
    expect(nearestStandardFont("Helvetica").font).toBe(
      PdfStandardFont.Helvetica,
    );
    expect(nearestStandardFont("Helvetica").familyLabel).toBe(
      "Sans (Helvetica)",
    );
  });
});

function textObject(
  objectIndex: number,
  bounds: TextObjectInfo["bounds"],
  baseFontName = "Helvetica",
): TextObjectInfo {
  return {
    objectIndex,
    text: "sample",
    bounds,
    fontSize: 12,
    baseFontName,
    fill: { r: 0, g: 0, b: 0, a: 1 },
  };
}

describe("nearestTextObject", () => {
  it("returns null for an empty page", () => {
    expect(nearestTextObject([], { x: 0, y: 0 })).toBeNull();
  });

  it("picks the closer of two text objects", () => {
    const near = textObject(0, { left: 0, bottom: 0, right: 10, top: 10 });
    const far = textObject(1, { left: 500, bottom: 500, right: 510, top: 510 });
    expect(nearestTextObject([far, near], { x: 5, y: 5 })).toBe(near);
  });

  it("compares by bounds center, not by the nearest corner", () => {
    // Object A's corner is closer to the point than object B's corner, but
    // B's CENTER is closer -- this only passes if centers are what's compared.
    const a = textObject(0, { left: 9, bottom: -100, right: 11, top: 100 });
    const b = textObject(1, { left: 0, bottom: 0, right: 20, top: 20 });
    expect(nearestTextObject([a, b], { x: 10, y: 10 })).toBe(b);
  });
});

describe("matchDocumentFont", () => {
  it("returns null when the page has no other text", () => {
    expect(matchDocumentFont([], { x: 0, y: 0 })).toBeNull();
  });

  it("resolves the fixture's Helvetica text with no hint (already exact)", () => {
    const objects = [
      textObject(0, { left: 0, bottom: 0, right: 100, top: 20 }, "Helvetica"),
    ];
    const result = matchDocumentFont(objects, { x: 50, y: 10 });
    expect(result).not.toBeNull();
    expect(result?.font).toBe(PdfStandardFont.Helvetica);
    expect(result?.hint).toBeNull();
  });

  it("gives an honest hint when the nearest text is an embedded/approximated font", () => {
    const objects = [
      textObject(
        0,
        { left: 0, bottom: 0, right: 100, top: 20 },
        "Garamond-Bold",
      ),
    ];
    const result = matchDocumentFont(objects, { x: 50, y: 10 });
    expect(result?.font).toBe(PdfStandardFont.Times_Bold);
    expect(result?.hint).toBe(
      "Closest match to this document's Garamond-Bold: Serif (Times).",
    );
  });
});
