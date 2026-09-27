import { describe, expect, it } from "vitest";
import type { RasterImage } from "../types";
import { encodeBmp } from "./bmp";

/** Builds a raster with a known, checkable pixel layout: (0,0) is red,
 * everything else is blue, optionally with a given alpha for every pixel. */
function rasterOf(width: number, height: number, alpha: number): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (i === 0) {
      data[o] = 255;
      data[o + 1] = 0;
      data[o + 2] = 0;
    } else {
      data[o] = 0;
      data[o + 1] = 0;
      data[o + 2] = 255;
    }
    data[o + 3] = alpha;
  }
  return { width, height, data };
}

describe("encodeBmp", () => {
  it("writes a 24-bit BI_RGB header for a fully opaque image", () => {
    const bmp = encodeBmp(rasterOf(3, 2, 255));
    const view = new DataView(bmp.buffer);

    expect(bmp[0]).toBe(0x42); // 'B'
    expect(bmp[1]).toBe(0x4d); // 'M'
    expect(view.getUint32(10, true)).toBe(54); // pixel data offset: 14 + 40
    expect(view.getUint32(14, true)).toBe(40); // biSize
    expect(view.getInt32(18, true)).toBe(3); // biWidth
    expect(view.getInt32(22, true)).toBe(2); // biHeight, positive = bottom-up
    expect(view.getUint16(26, true)).toBe(1); // biPlanes
    expect(view.getUint16(28, true)).toBe(24); // biBitCount
    expect(view.getUint32(30, true)).toBe(0); // biCompression: BI_RGB

    // Row size: ceil(3px * 24bpp / 32) * 4 = 12 bytes/row (9 data + 3 padding).
    const rowSize = 12;
    expect(view.getUint32(34, true)).toBe(rowSize * 2); // biSizeImage
    expect(bmp.length).toBe(54 + rowSize * 2);
  });

  it("writes a 32-bit BI_BITFIELDS header with a color mask when not fully opaque", () => {
    const bmp = encodeBmp(rasterOf(2, 2, 128));
    const view = new DataView(bmp.buffer);

    expect(view.getUint32(14, true)).toBe(52); // biSize: 40 + 12-byte bitfields
    expect(view.getUint16(28, true)).toBe(32); // biBitCount
    expect(view.getUint32(30, true)).toBe(3); // biCompression: BI_BITFIELDS
    expect(view.getUint32(10, true)).toBe(14 + 52); // pixel data offset

    // R/G/B masks immediately follow the 40-byte BITMAPINFOHEADER.
    expect(view.getUint32(54, true)).toBe(0x00ff0000);
    expect(view.getUint32(58, true)).toBe(0x0000ff00);
    expect(view.getUint32(62, true)).toBe(0x000000ff);
  });

  it("pads each 24-bit row to a 4-byte boundary", () => {
    // width=1 -> 3 data bytes/row, padded to 4.
    const bmp = encodeBmp(rasterOf(1, 1, 255));
    expect(bmp.length).toBe(54 + 4);
  });

  it("writes rows bottom-up in BGR order, with the top-left source pixel last", () => {
    const bmp = encodeBmp(rasterOf(2, 2, 255));
    const rowSize = 8; // ceil(2*24/32)*4 = 8
    const pixelDataOffset = 54;

    // Source (0,0) is red; it should land in the *last* file row (bottom-up),
    // at its own row's first pixel, in B/G/R order.
    const lastRowOffset = pixelDataOffset + rowSize * 1;
    expect(bmp[lastRowOffset]).toBe(0); // B
    expect(bmp[lastRowOffset + 1]).toBe(0); // G
    expect(bmp[lastRowOffset + 2]).toBe(255); // R
  });
});
