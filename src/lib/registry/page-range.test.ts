import { describe, expect, it } from "vitest";
import { parsePageRange } from "./page-range";

describe("parsePageRange", () => {
  it('treats "" as every page', () => {
    expect(parsePageRange("", 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it('treats "all" (any case) as every page', () => {
    expect(parsePageRange("all", 3)).toEqual([0, 1, 2]);
    expect(parsePageRange("ALL", 3)).toEqual([0, 1, 2]);
  });

  it("parses a bare page number", () => {
    expect(parsePageRange("2", 5)).toEqual([1]);
  });

  it("parses a closed range", () => {
    expect(parsePageRange("1-3", 5)).toEqual([0, 1, 2]);
  });

  it("parses an open-ended range through the last page", () => {
    expect(parsePageRange("8-", 10)).toEqual([7, 8, 9]);
  });

  it("parses a mix of numbers and ranges, in the order given", () => {
    expect(parsePageRange("1-3, 5, 8-", 10)).toEqual([0, 1, 2, 4, 7, 8, 9]);
  });

  it("dedupes overlapping tokens, keeping first occurrence order", () => {
    expect(parsePageRange("3, 1-3", 5)).toEqual([2, 0, 1]);
  });

  it("trims whitespace around tokens", () => {
    expect(parsePageRange(" 1 - 3 , 5 ", 5)).toEqual([0, 1, 2, 4]);
  });

  it("throws for a page number below 1", () => {
    expect(() => parsePageRange("0", 5)).toThrow(/out of range/);
  });

  it("throws for a page number above pageCount", () => {
    expect(() => parsePageRange("6", 5)).toThrow(/out of range/);
  });

  it("throws when a range's end is above pageCount", () => {
    expect(() => parsePageRange("1-9", 5)).toThrow(/out of range/);
  });

  it("throws when an open range starts beyond pageCount", () => {
    expect(() => parsePageRange("8-", 3)).toThrow(/out of range/);
  });

  it("throws when a range's end is before its start", () => {
    expect(() => parsePageRange("5-1", 5)).toThrow(/end is before start/);
  });

  it("throws for a malformed token", () => {
    expect(() => parsePageRange("abc", 5)).toThrow(/invalid page range/);
  });

  it("throws for an empty entry between commas", () => {
    expect(() => parsePageRange("1,,3", 5)).toThrow(/invalid page range/);
  });

  it("throws when pageCount is less than 1", () => {
    expect(() => parsePageRange("1", 0)).toThrow(
      /pageCount must be at least 1/,
    );
  });
});
