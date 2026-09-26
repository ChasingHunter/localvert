import { describe, expect, it } from "vitest";
import { rectToCssBox } from "./form-layer";
import { cssBoxToRect } from "./redaction-layer";

describe("cssBoxToRect", () => {
  it("is the inverse of rectToCssBox at an arbitrary scale", () => {
    const rect = { origin: { x: 10, y: 20 }, size: { width: 100, height: 40 } };
    const box = rectToCssBox(rect, 1.5);
    expect(cssBoxToRect(box, 1.5)).toEqual(rect);
  });

  it("is the identity mapping at scale 1", () => {
    const box = { left: 5, top: 6, width: 7, height: 8 };
    expect(cssBoxToRect(box, 1)).toEqual({
      origin: { x: 5, y: 6 },
      size: { width: 7, height: 8 },
    });
  });
});
