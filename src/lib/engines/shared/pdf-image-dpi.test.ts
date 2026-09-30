import { parseContentStream } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import {
  largestPlacement,
  multiplyMatrix,
  scanImagePlacements,
  targetDimensionsForImage,
} from "./pdf-image-dpi";

/** Builds a real content stream string and runs it through
 * `@cantoo/pdf-lib`'s own tokenizer — this suite checks `scanImagePlacements`
 * against the real parser's output, not a hand-rolled fixture. */
function ops(contentStream: string) {
  return parseContentStream(new TextEncoder().encode(contentStream));
}

describe("multiplyMatrix", () => {
  it("is the identity when both inputs are identity", () => {
    expect(multiplyMatrix([1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0])).toEqual([
      1, 0, 0, 1, 0, 0,
    ]);
  });

  it("scales", () => {
    // A 2x scale concatenated onto identity is just the scale itself.
    expect(multiplyMatrix([1, 0, 0, 1, 0, 0], [2, 0, 0, 2, 0, 0])).toEqual([
      2, 0, 0, 2, 0, 0,
    ]);
  });
});

describe("scanImagePlacements", () => {
  it("reads the drawn size of an image placed at a simple scale + translate", () => {
    // A 200x100pt placement at (50, 50) — `cm` scales the unit square, `Do`
    // paints /Im1.
    const stream = ops("q 200 0 0 100 50 50 cm /Im1 Do Q");
    const placements = scanImagePlacements(stream, new Map([["Im1", "obj-1"]]));
    const list = placements.get("obj-1");
    expect(list).toHaveLength(1);
    expect(list?.[0]).toEqual({ widthPt: 200, heightPt: 100 });
  });

  it("restores the CTM on Q so a later placement isn't affected by an earlier one", () => {
    const stream = ops("q 400 0 0 400 0 0 cm Q q 100 0 0 50 0 0 cm /Im1 Do Q");
    const placements = scanImagePlacements(stream, new Map([["Im1", "obj-1"]]));
    expect(placements.get("obj-1")?.[0]).toEqual({
      widthPt: 100,
      heightPt: 50,
    });
  });

  it("records every placement of a shared image across multiple Do calls", () => {
    const stream = ops(
      "q 100 0 0 100 0 0 cm /Im1 Do Q q 300 0 0 300 0 0 cm /Im1 Do Q",
    );
    const placements = scanImagePlacements(stream, new Map([["Im1", "obj-1"]]));
    expect(placements.get("obj-1")).toEqual([
      { widthPt: 100, heightPt: 100 },
      { widthPt: 300, heightPt: 300 },
    ]);
  });

  it("ignores a Do for a name not in nameToKey (e.g. a Form XObject)", () => {
    const stream = ops("q 200 0 0 200 0 0 cm /Fm1 Do Q");
    const placements = scanImagePlacements(stream, new Map([["Im1", "obj-1"]]));
    expect(placements.size).toBe(0);
  });

  it("nested q/Q compose the CTM correctly", () => {
    // Outer cm scales by 2, inner cm scales the unit square to 50x50 —
    // combined drawn size is 100x100.
    const stream = ops("q 2 0 0 2 0 0 cm q 50 0 0 50 0 0 cm /Im1 Do Q Q");
    const placements = scanImagePlacements(stream, new Map([["Im1", "obj-1"]]));
    expect(placements.get("obj-1")?.[0]).toEqual({
      widthPt: 100,
      heightPt: 100,
    });
  });
});

describe("largestPlacement", () => {
  it("picks the placement with the largest area", () => {
    expect(
      largestPlacement([
        { widthPt: 100, heightPt: 100 },
        { widthPt: 300, heightPt: 300 },
        { widthPt: 150, heightPt: 150 },
      ]),
    ).toEqual({ widthPt: 300, heightPt: 300 });
  });

  it("is undefined for an empty list", () => {
    expect(largestPlacement([])).toBeUndefined();
  });
});

describe("targetDimensionsForImage", () => {
  it("downsamples a high-DPI image to the target", () => {
    // 3000x2000px drawn at 300x200pt (~4.17x2.78in) -> 720 DPI on both
    // axes. At a 150 DPI target that's a 150/720 scale on each axis.
    const result = targetDimensionsForImage({
      pixelWidth: 3000,
      pixelHeight: 2000,
      drawnWidthPt: 300,
      drawnHeightPt: 200,
      targetDpi: 150,
    });
    expect(result.width).toBeCloseTo(625, -1);
    expect(result.height).toBeCloseTo(417, -1);
  });

  it("never upsamples an image already below the target DPI", () => {
    // 300x200px drawn at 300x200pt (72 DPI) — well under a 150 DPI target.
    const result = targetDimensionsForImage({
      pixelWidth: 300,
      pixelHeight: 200,
      drawnWidthPt: 300,
      drawnHeightPt: 200,
      targetDpi: 150,
    });
    expect(result).toEqual({ width: 300, height: 200 });
  });

  it("scales each axis independently", () => {
    // Drawn twice as tall (relative to its pixels) as it is wide -> the
    // width needs more downsampling than the height.
    const result = targetDimensionsForImage({
      pixelWidth: 1500,
      pixelHeight: 1000,
      drawnWidthPt: 500, // 216 DPI
      drawnHeightPt: 1000, // 72 DPI, already under target
      targetDpi: 150,
    });
    expect(result.width).toBeLessThan(1500);
    expect(result.height).toBe(1000);
  });

  it("treats a zero-size placement as maximally dense (downsamples fully)", () => {
    const result = targetDimensionsForImage({
      pixelWidth: 1000,
      pixelHeight: 1000,
      drawnWidthPt: 0,
      drawnHeightPt: 0,
      targetDpi: 150,
    });
    expect(result).toEqual({ width: 1, height: 1 });
  });
});
