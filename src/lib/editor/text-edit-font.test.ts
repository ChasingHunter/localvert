import { describe, expect, it } from "vitest";
import { needsFallbackFont, pickStandardFontName } from "./text-edit-font";

describe("pickStandardFontName", () => {
  it("picks a plain Helvetica for an unrecognized base font", () => {
    expect(pickStandardFontName("ABCDEF+SomeSubsetFont")).toBe("Helvetica");
  });

  it("picks Times-Roman for a Times family name", () => {
    expect(pickStandardFontName("TimesNewRomanPSMT")).toBe("Times-Roman");
  });

  it("picks Times-Bold for a bold Times family name", () => {
    expect(pickStandardFontName("Times New Roman Bold")).toBe("Times-Bold");
  });

  it("picks Times-Italic for an italic Times family name", () => {
    expect(pickStandardFontName("Times-Italic")).toBe("Times-Italic");
  });

  it("picks Times-BoldItalic when both bold and italic are named", () => {
    expect(pickStandardFontName("Times New Roman Bold Italic")).toBe(
      "Times-BoldItalic",
    );
  });

  it("picks Courier for a Courier family name", () => {
    expect(pickStandardFontName("CourierNewPSMT")).toBe("Courier");
  });

  it("picks Courier-BoldOblique for a bold+oblique Courier name", () => {
    expect(pickStandardFontName("Courier-BoldOblique")).toBe(
      "Courier-BoldOblique",
    );
  });

  it("picks Helvetica-Bold for a bold non-Times/Courier name", () => {
    expect(pickStandardFontName("Arial-Bold")).toBe("Helvetica-Bold");
  });

  it("picks Helvetica-Oblique for an oblique non-Times/Courier name", () => {
    expect(pickStandardFontName("Arial-Oblique")).toBe("Helvetica-Oblique");
  });

  it("picks Helvetica-BoldOblique when both are named", () => {
    expect(pickStandardFontName("Arial-BoldOblique")).toBe(
      "Helvetica-BoldOblique",
    );
  });

  it("is case-insensitive", () => {
    expect(pickStandardFontName("TIMES BOLD")).toBe("Times-Bold");
  });
});

describe("needsFallbackFont", () => {
  it("is false when every new character already appeared in the old text", () => {
    expect(needsFallbackFont("Hello World", "Well Hold")).toBe(false);
  });

  it("is true when the new text has a character the old text never had", () => {
    expect(needsFallbackFont("Hello", "Hello!")).toBe(true);
  });

  it("is true for a completely different alphabet", () => {
    expect(needsFallbackFont("Hello", "Bonjour")).toBe(true);
  });

  it("is false for an exact match", () => {
    expect(needsFallbackFont("Sample", "Sample")).toBe(false);
  });

  it("is false when the new text is a subset of the old text's characters", () => {
    expect(needsFallbackFont("Sample", "Sam")).toBe(false);
  });

  it("is false for an empty new text", () => {
    expect(needsFallbackFont("Sample", "")).toBe(false);
  });

  it("is true when the old text is empty and the new text is not", () => {
    expect(needsFallbackFont("", "X")).toBe(true);
  });
});
