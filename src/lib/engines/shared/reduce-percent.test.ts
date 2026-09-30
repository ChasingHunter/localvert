import { describe, expect, it } from "vitest";
import { percentToTargetBytes } from "./reduce-percent";

describe("percentToTargetBytes", () => {
  it("maps 50% to half the source size", () => {
    expect(percentToTargetBytes(1_000_000, 50)).toBe(500_000);
  });

  it("maps 10% to a small reduction", () => {
    expect(percentToTargetBytes(1_000_000, 10)).toBe(900_000);
  });

  it("maps 90% to a large reduction", () => {
    expect(percentToTargetBytes(1_000_000, 90)).toBe(100_000);
  });

  it("clamps below 10 and above 90", () => {
    expect(percentToTargetBytes(1_000_000, 1)).toBe(
      percentToTargetBytes(1_000_000, 10),
    );
    expect(percentToTargetBytes(1_000_000, 200)).toBe(
      percentToTargetBytes(1_000_000, 90),
    );
  });

  it("never returns less than 1 byte", () => {
    expect(percentToTargetBytes(1, 90)).toBeGreaterThanOrEqual(1);
  });
});
