import { describe, expect, it } from "vitest";
import { textBoundsToCssBox } from "./text-edit-layer";

describe("textBoundsToCssBox", () => {
  it("flips PDFium's bottom-left-origin bounds into a top-left CSS box", () => {
    // A 100x200pt page, an object occupying x:[10,50], y:[150,180] from the
    // bottom (PDFium's convention) -- i.e. 20pt tall, sitting 20pt below the
    // top edge (200 - 180).
    const box = textBoundsToCssBox(
      { left: 10, bottom: 150, right: 50, top: 180 },
      200,
      1,
    );
    expect(box).toEqual({ left: 10, top: 20, width: 40, height: 30 });
  });

  it("scales every dimension by the render scale", () => {
    const box = textBoundsToCssBox(
      { left: 10, bottom: 150, right: 50, top: 180 },
      200,
      2,
    );
    expect(box).toEqual({ left: 20, top: 40, width: 80, height: 60 });
  });

  it("never returns a zero-size box for a degenerate (zero-area) bounds", () => {
    const box = textBoundsToCssBox(
      { left: 10, bottom: 100, right: 10, top: 100 },
      200,
      1,
    );
    expect(box.width).toBeGreaterThanOrEqual(1);
    expect(box.height).toBeGreaterThanOrEqual(1);
  });
});
