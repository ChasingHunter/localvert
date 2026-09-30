import { describe, expect, it } from "vitest";
import { fitClipToDuration, formatSeconds } from "./trim-range";

describe("fitClipToDuration", () => {
  it("fails with a plain message when start is past the end of the video", () => {
    expect(fitClipToDuration(50, 60, 12.3)).toEqual({
      ok: false,
      message: "Start (50 s) is after the end of the video (12.3 s).",
    });
  });

  it("fails when start equals the duration", () => {
    expect(fitClipToDuration(12.3, 20, 12.3).ok).toBe(false);
  });

  it("clamps an end past the duration without complaint", () => {
    expect(fitClipToDuration(1, 60, 12.3)).toEqual({
      ok: true,
      start: 1,
      end: 12.3,
    });
  });

  it("leaves an in-range clip alone", () => {
    expect(fitClipToDuration(1, 5, 12.3)).toEqual({
      ok: true,
      start: 1,
      end: 5,
    });
    expect(fitClipToDuration(0, undefined, 12.3)).toEqual({
      ok: true,
      start: 0,
      end: undefined,
    });
  });

  it("leaves the range alone when the duration is unknown", () => {
    expect(fitClipToDuration(50, 60, undefined)).toEqual({
      ok: true,
      start: 50,
      end: 60,
    });
    expect(fitClipToDuration(50, 60, 0).ok).toBe(true);
  });
});

describe("formatSeconds", () => {
  it("rounds to one decimal and drops a trailing .0", () => {
    expect(formatSeconds(12.34)).toBe("12.3");
    expect(formatSeconds(50)).toBe("50");
    expect(formatSeconds(2.04)).toBe("2");
  });
});
