import { describe, expect, it } from "vitest";
import { formatTargetSizeNote } from "./target-size-note";

describe("formatTargetSizeNote", () => {
  it("formats a hit", () => {
    // formatBytes (shared with the UI's own job-card.tsx convention) drops
    // to 0 decimals at 10+ units, so this reads "19 MB" rather than
    // ADR-0017's illustrative "19.4 MB" — same rounding rule as every other
    // size shown in the app, which matters more than matching that example
    // string byte-for-byte.
    const note = formatTargetSizeNote({
      achievedBytes: Math.round(19.4 * 1024 * 1024),
      targetBytes: 20 * 1024 * 1024,
      hitTarget: true,
    });
    expect(note).toBe("19 MB, 97% of your 20 MB target.");
  });

  it("formats a resize compromise, taking priority over hit/miss wording", () => {
    const note = formatTargetSizeNote({
      achievedBytes: 50 * 1024,
      targetBytes: 50 * 1024,
      hitTarget: true,
      resizedTo: { width: 1600, height: 1200 },
    });
    expect(note).toBe("Resized to 1600 × 1200 to fit 50 KB.");
  });

  it("formats an unreachable result", () => {
    const note = formatTargetSizeNote({
      achievedBytes: 23 * 1024 * 1024,
      targetBytes: 20 * 1024 * 1024,
      hitTarget: false,
    });
    expect(note).toBe("The smallest we could make it is 23 MB.");
  });
});
