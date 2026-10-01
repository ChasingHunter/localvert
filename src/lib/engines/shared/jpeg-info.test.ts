import { describe, expect, it } from "vitest";
import { readJpegInfo } from "./jpeg-info";

/** SOI, an APP0 segment, then SOF0 with the given size and components. */
function jpeg(width: number, height: number, components: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x4a,
    0x46, // APP0, length 4 (2 bytes of payload)
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    components,
    ...new Array(components * 3).fill(0),
    0xff,
    0xd9,
  ]);
}

describe("readJpegInfo", () => {
  it("reads size and components from the first SOF marker", () => {
    expect(readJpegInfo(jpeg(640, 480, 3))).toEqual({
      width: 640,
      height: 480,
      components: 3,
    });
    expect(readJpegInfo(jpeg(10, 20, 1))?.components).toBe(1);
    expect(readJpegInfo(jpeg(10, 20, 4))?.components).toBe(4);
  });

  it("rejects anything that is not a JPEG", () => {
    expect(readJpegInfo(new Uint8Array())).toBeNull();
    expect(readJpegInfo(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it("rejects a truncated file without a frame header", () => {
    expect(
      readJpegInfo(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2])),
    ).toBeNull();
  });
});
