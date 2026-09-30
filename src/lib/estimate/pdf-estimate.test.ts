import { describe, expect, it } from "vitest";
import { estimatePdfTargetSize } from "./pdf-estimate";

describe("estimatePdfTargetSize", () => {
  it("says the target isn't possible when non-image bytes alone exceed it", () => {
    const text = estimatePdfTargetSize({
      targetBytes: 1 * 1024 * 1024,
      probe: { imageBytes: 500_000, nonImageBytes: 2 * 1024 * 1024 },
    });
    expect(text).toContain("Too small");
    expect(text).toContain("isn't possible");
  });

  it("warns the target may not be reachable when even the strongest rung is unlikely to fit", () => {
    const text = estimatePdfTargetSize({
      targetBytes: 1 * 1024 * 1024,
      probe: { imageBytes: 20 * 1024 * 1024, nonImageBytes: 500_000 },
    });
    expect(text).toContain("may not be reachable");
  });

  it("says the target looks reachable when the strongest rung has plenty of room", () => {
    const text = estimatePdfTargetSize({
      targetBytes: 10 * 1024 * 1024,
      probe: { imageBytes: 5 * 1024 * 1024, nonImageBytes: 500_000 },
    });
    expect(text).toContain("looks reachable");
  });
});
