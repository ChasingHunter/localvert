import { describe, expect, it } from "vitest";
import {
  currentEnd,
  formatLength,
  initialRange,
  roundTenth,
  setEndHere,
  setStartHere,
} from "./video-range-logic";

describe("formatLength", () => {
  it("formats minutes and seconds", () => {
    expect(formatLength(83)).toBe("1:23");
    expect(formatLength(5)).toBe("0:05");
    expect(formatLength(12.4)).toBe("0:12");
  });

  it("adds hours when needed", () => {
    expect(formatLength(3725)).toBe("1:02:05");
  });
});

describe("roundTenth", () => {
  it("rounds to 0.1 s", () => {
    expect(roundTenth(3.14)).toBe(3.1);
    expect(roundTenth(3.96)).toBe(4);
  });
});

describe("initialRange", () => {
  it("trim starts at 0 and ends at the full duration", () => {
    expect(initialRange("trim", 83.04)).toEqual({ start: 0, end: 83 });
    expect(initialRange("trim", 2)).toEqual({ start: 0, end: 2 });
  });

  it("gif starts at 0 and caps at the 5 s default", () => {
    expect(initialRange("gif", 83)).toEqual({ start: 0, duration: 5 });
    expect(initialRange("gif", 2.04)).toEqual({ start: 0, duration: 2 });
  });
});

describe("setStartHere", () => {
  it("writes the rounded current time and keeps the end", () => {
    expect(setStartHere("trim", 3.14, { start: 0, end: 10 }, 20)).toEqual({
      patch: { start: 3.1, end: 10 },
    });
  });

  it("moves the end to the video end when start passes it", () => {
    expect(setStartHere("trim", 12, { start: 0, end: 10 }, 20)).toEqual({
      patch: { start: 12, end: 20 },
    });
  });

  it("refuses a start at the very end of the video", () => {
    const result = setStartHere("trim", 20, { start: 0, end: 10 }, 20);
    expect(result.patch).toBeNull();
    expect(result.message).toBeDefined();
  });

  it("gif keeps the end fixed by shortening the duration", () => {
    expect(setStartHere("gif", 2, { start: 0, duration: 5 }, 30).patch).toEqual(
      { start: 2, duration: 3 },
    );
  });

  it("gif caps at 30 s and says so", () => {
    const result = setStartHere("gif", 0, { start: 0, duration: 5 }, 100);
    expect(result.patch).toEqual({ start: 0, duration: 5 });
    const long = setStartHere("gif", 0, { start: 10, duration: 50 }, 100);
    expect(long.patch).toEqual({ start: 0, duration: 30 });
    expect(long.message).toMatch(/30 s/);
  });
});

describe("setEndHere", () => {
  it("trim writes the rounded time as end", () => {
    expect(setEndHere("trim", 7.26, { start: 2, end: 10 }, 20)).toEqual({
      patch: { end: 7.3 },
    });
  });

  it("clamps to the video duration", () => {
    expect(setEndHere("trim", 25, { start: 0, end: 10 }, 20).patch).toEqual({
      end: 20,
    });
  });

  it("refuses an end at or before the start", () => {
    const result = setEndHere("trim", 2, { start: 2, end: 10 }, 20);
    expect(result.patch).toBeNull();
    expect(result.message).toBeDefined();
  });

  it("gif turns the end into a duration from the start", () => {
    expect(setEndHere("gif", 6.5, { start: 2, duration: 5 }, 30).patch).toEqual(
      { duration: 4.5 },
    );
  });

  it("gif caps at 30 s and says so", () => {
    const result = setEndHere("gif", 90, { start: 0, duration: 5 }, 100);
    expect(result.patch).toEqual({ duration: 30 });
    expect(result.message).toMatch(/30 s/);
  });
});

describe("currentEnd", () => {
  it("reads end for trim and start + duration for gif", () => {
    expect(currentEnd("trim", { start: 1, end: 9 }, 20)).toBe(9);
    expect(currentEnd("gif", { start: 1, duration: 5 }, 20)).toBe(6);
  });
});
