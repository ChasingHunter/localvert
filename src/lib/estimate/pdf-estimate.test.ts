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

  it("does not promise a size the photos.pdf fixture missed (557 KB against a 0.5 MB target)", () => {
    const text = estimatePdfTargetSize({
      targetBytes: 0.5 * 1024 * 1024,
      probe: { imageBytes: 1_246_853, nonImageBytes: 1_093 },
    });
    expect(text).not.toContain("looks reachable");
    expect(text).toContain("may not be reachable");
  });

  it("says it might land a little over when the likely floor is just under the target", () => {
    const text = estimatePdfTargetSize({
      targetBytes: 1_000_000,
      // floor = 100_000 + 2_000_000 * 0.45 = 1_000_000 * 0.9 => in the margin band
      probe: { imageBytes: 1_777_778, nonImageBytes: 100_000 },
    });
    expect(text).toContain("Might land a little over");
    expect(text).not.toContain("looks reachable");
  });
});
