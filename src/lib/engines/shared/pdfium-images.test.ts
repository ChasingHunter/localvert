import { describe, expect, it } from "vitest";
import { fitsMediaBudget, MAX_MEDIA_BYTES } from "./pdfium-images";

describe("fitsMediaBudget", () => {
  const MB = 1024 * 1024;

  it("allows pictures while the total stays within the limit", () => {
    expect(fitsMediaBudget(10 * MB, 20 * MB, 100 * MB)).toBe(true);
    expect(fitsMediaBudget(80 * MB, 20 * MB, 100 * MB)).toBe(true);
  });

  it("refuses the picture that would pass the limit", () => {
    expect(fitsMediaBudget(80 * MB, 20 * MB + 1, 100 * MB)).toBe(false);
    expect(fitsMediaBudget(100 * MB, 1, 100 * MB)).toBe(false);
  });

  it("always keeps the first picture, however big", () => {
    expect(fitsMediaBudget(0, 500 * MB, 100 * MB)).toBe(true);
  });

  it("defaults to about 150 MB", () => {
    expect(MAX_MEDIA_BYTES).toBe(150 * MB);
    expect(fitsMediaBudget(149 * MB, 2 * MB)).toBe(false);
  });
});
