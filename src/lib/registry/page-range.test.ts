import { describe, expect, it } from "vitest";
import { parsePageOrder, parsePageRange } from "./page-range";

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
    expect(() => parsePageRange("0", 5)).toThrow(/isn't in this PDF/);
  });

  it("throws for a page number above pageCount", () => {
    expect(() => parsePageRange("6", 5)).toThrow(/isn't in this PDF/);
  });

  it("throws when a range's end is above pageCount", () => {
    expect(() => parsePageRange("1-9", 5)).toThrow(/isn't in this PDF/);
  });

  it("throws when an open range starts beyond pageCount", () => {
    expect(() => parsePageRange("8-", 3)).toThrow(/isn't in this PDF/);
  });

  it("throws when a range's end is before its start", () => {
    expect(() => parsePageRange("5-1", 5)).toThrow(/runs backwards/);
  });

  it("throws for a malformed token", () => {
    expect(() => parsePageRange("abc", 5)).toThrow(/Couldn't read/);
  });

  it("throws for an empty entry between commas", () => {
    expect(() => parsePageRange("1,,3", 5)).toThrow(/Couldn't read/);
  });

  it("explains a bad token in plain words, with no tag or em dash", () => {
    let message = "";
    try {
      parsePageRange("abc", 5);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe(`Couldn't read "abc". Use page numbers like 1-3, 5.`);
  });

  it("throws when pageCount is less than 1", () => {
    expect(() => parsePageRange("1", 0)).toThrow(
      /pageCount must be at least 1/,
    );
  });
});

describe("parsePageOrder", () => {
  it('treats "" as unchanged — every page, in original order', () => {
    expect(parsePageOrder("", 4)).toEqual([0, 1, 2, 3]);
  });

  it('treats "all" (any case) as unchanged', () => {
    expect(parsePageOrder("ALL", 3)).toEqual([0, 1, 2]);
  });

  it("keeps a mix of numbers and ranges in the order given", () => {
    expect(parsePageOrder("3, 1, 2", 3)).toEqual([2, 0, 1]);
  });

  it("expands a forward range in order", () => {
    expect(parsePageOrder("4-6", 6)).toEqual([3, 4, 5]);
  });

  it("expands a reversed range back to front", () => {
    expect(parsePageOrder("6-4", 6)).toEqual([5, 4, 3]);
  });

  it("keeps duplicates instead of deduping — repeating a page duplicates it", () => {
    expect(parsePageOrder("1, 1, 2", 2)).toEqual([0, 0, 1]);
  });

  it("drops any page left out of the spec", () => {
    expect(parsePageOrder("2", 3)).toEqual([1]);
  });

  it("throws for a page number below 1", () => {
    expect(() => parsePageOrder("0", 5)).toThrow(/isn't in this PDF/);
  });

  it("throws for a page number above pageCount", () => {
    expect(() => parsePageOrder("6", 5)).toThrow(/isn't in this PDF/);
  });

  it("throws when either end of a range is out of range", () => {
    expect(() => parsePageOrder("1-9", 5)).toThrow(/isn't in this PDF/);
    expect(() => parsePageOrder("9-1", 5)).toThrow(/isn't in this PDF/);
  });

  it('rejects an open-ended range ("8-") — every page must be named', () => {
    expect(() => parsePageOrder("8-", 10)).toThrow(/Couldn't read/);
  });

  it("throws for a malformed token", () => {
    expect(() => parsePageOrder("abc", 5)).toThrow(/Couldn't read/);
  });

  it("throws for an empty entry between commas", () => {
    expect(() => parsePageOrder("1,,3", 5)).toThrow(/Couldn't read/);
  });

  it("throws when pageCount is less than 1", () => {
    expect(() => parsePageOrder("1", 0)).toThrow(
      /pageCount must be at least 1/,
    );
  });
});
