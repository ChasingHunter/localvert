import { describe, expect, it } from "vitest";
import { normalizeRotation, validatePlan } from "./page-organizer-plan";

describe("normalizeRotation", () => {
  it("adds a delta and wraps at 360", () => {
    expect(normalizeRotation(0, 90)).toBe(90);
    expect(normalizeRotation(270, 90)).toBe(0);
    expect(normalizeRotation(180, 270)).toBe(90);
  });

  it("wraps a negative pre-existing rotation into range", () => {
    expect(normalizeRotation(-90, 0)).toBe(270);
  });

  it("is a no-op with a zero delta", () => {
    expect(normalizeRotation(90, 0)).toBe(90);
  });
});

describe("validatePlan", () => {
  it("rejects a non-array plan", () => {
    const result = validatePlan(null, [3]);
    expect(result.ok).toBe(false);
  });

  it("rejects an empty plan", () => {
    const result = validatePlan([], [3]);
    expect(result.ok).toBe(false);
  });

  it("accepts a plan mixing an existing page, a blank page and an inserted page", () => {
    const result = validatePlan(
      [
        { source: 0, page: 1, rotate: 90 },
        { source: "blank", rotate: 0 },
        { source: 1, page: 0, rotate: 0 },
        { source: 0, page: 0, rotate: 0 },
      ],
      [3, 1],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.plan).toEqual([
      { source: 0, page: 1, rotate: 90 },
      { source: "blank", rotate: 0 },
      { source: 1, page: 0, rotate: 0 },
      { source: 0, page: 0, rotate: 0 },
    ]);
  });

  it("carries a blank page's size through when valid", () => {
    const result = validatePlan(
      [{ source: "blank", rotate: 0, size: { width: 100, height: 200 } }],
      [3],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.plan[0]?.size).toEqual({ width: 100, height: 200 });
  });

  it("rejects an invalid rotate value", () => {
    const result = validatePlan([{ source: 0, page: 0, rotate: 45 }], [3]);
    expect(result.ok).toBe(false);
  });

  it("rejects a source index out of range", () => {
    const result = validatePlan([{ source: 2, page: 0, rotate: 0 }], [3]);
    expect(result.ok).toBe(false);
  });

  it("rejects a page index out of range for its source", () => {
    const result = validatePlan([{ source: 0, page: 3, rotate: 0 }], [3]);
    expect(result.ok).toBe(false);
  });

  it("rejects a missing page index for a non-blank source", () => {
    const result = validatePlan([{ source: 0, rotate: 0 }], [3]);
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid blank page size", () => {
    const result = validatePlan(
      [{ source: "blank", rotate: 0, size: { width: 0, height: 200 } }],
      [3],
    );
    expect(result.ok).toBe(false);
  });
});
