import { describe, expect, it } from "vitest";
import {
  buildIcoContainer,
  decodeIcoDib,
  extractIcoEntryBytes,
  icoSizesForPreset,
  isPngIcoEntry,
  parseIcoDirectory,
  pickLargestIcoEntry,
} from "./ico";

const ICONDIR_SIZE = 6;
const ICONDIRENTRY_SIZE = 16;

/** Assembles a real ICO byte layout (ICONDIR + ICONDIRENTRY array + entry
 * data) from a list of entries, so directory-parsing tests exercise the
 * exact on-disk shape rather than a stand-in. */
function buildTestIco(
  entries: readonly { width: number; height: number; data: Uint8Array }[],
): Uint8Array {
  const directorySize = ICONDIR_SIZE + entries.length * ICONDIRENTRY_SIZE;
  const totalSize =
    directorySize + entries.reduce((sum, e) => sum + e.data.length, 0);
  const bytes = new Uint8Array(totalSize);
  const view = new DataView(bytes.buffer);

  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, entries.length, true);

  let dataOffset = directorySize;
  entries.forEach((entry, i) => {
    const base = ICONDIR_SIZE + i * ICONDIRENTRY_SIZE;
    view.setUint8(base, entry.width === 256 ? 0 : entry.width);
    view.setUint8(base + 1, entry.height === 256 ? 0 : entry.height);
    view.setUint16(base + 6, 32, true); // bitCount
    view.setUint32(base + 8, entry.data.length, true);
    view.setUint32(base + 12, dataOffset, true);
    bytes.set(entry.data, dataOffset);
    dataOffset += entry.data.length;
  });

  return bytes;
}

describe("parseIcoDirectory", () => {
  it("parses ICONDIR + every ICONDIRENTRY, resolving 0 to 256", () => {
    const ico = buildTestIco([
      { width: 16, height: 16, data: new Uint8Array([1, 2, 3]) },
      { width: 256, height: 256, data: new Uint8Array([4, 5]) },
    ]);
    const entries = parseIcoDirectory(ico);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      width: 16,
      height: 16,
      size: 3,
      offset: ICONDIR_SIZE + 2 * ICONDIRENTRY_SIZE,
    });
    expect(entries[1]).toMatchObject({
      width: 256,
      height: 256,
      size: 2,
      offset: ICONDIR_SIZE + 2 * ICONDIRENTRY_SIZE + 3,
    });
  });

  it("throws decode-failed for a file missing the ICONDIR signature", () => {
    expect(() => parseIcoDirectory(new Uint8Array([1, 2, 3, 4, 5, 6]))).toThrow(
      /not an ico file/i,
    );
  });

  it("throws decode-failed for a truncated directory", () => {
    const ico = buildTestIco([
      { width: 16, height: 16, data: new Uint8Array([1]) },
    ]);
    expect(() => parseIcoDirectory(ico.subarray(0, 10))).toThrow(/truncated/i);
  });
});

describe("pickLargestIcoEntry", () => {
  it("picks the entry with the largest pixel area", () => {
    const ico = buildTestIco([
      { width: 16, height: 16, data: new Uint8Array([1]) },
      { width: 48, height: 48, data: new Uint8Array([2]) },
      { width: 32, height: 32, data: new Uint8Array([3]) },
    ]);
    const entries = parseIcoDirectory(ico);
    expect(pickLargestIcoEntry(entries).width).toBe(48);
  });

  it("throws for an empty entry list", () => {
    expect(() => pickLargestIcoEntry([])).toThrow(/no entries/i);
  });
});

describe("extractIcoEntryBytes", () => {
  it("slices exactly the entry's own bytes out of the file", () => {
    const ico = buildTestIco([
      { width: 16, height: 16, data: new Uint8Array([9, 8, 7]) },
    ]);
    const entries = parseIcoDirectory(ico);
    expect([...extractIcoEntryBytes(ico, entries[0])]).toEqual([9, 8, 7]);
  });
});

describe("isPngIcoEntry", () => {
  it("recognizes the PNG signature", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0,
    ]);
    expect(isPngIcoEntry(png)).toBe(true);
  });

  it("rejects a non-PNG (DIB) entry", () => {
    const dib = new Uint8Array(40); // a bare BITMAPINFOHEADER, biSize=0 here
    expect(isPngIcoEntry(dib)).toBe(false);
  });
});

describe("decodeIcoDib", () => {
  it("decodes a 32bpp DIB entry: bottom-up rows, BGRA -> RGBA", () => {
    const buffer = new ArrayBuffer(40 + 16); // header + 2 rows * 8 bytes
    const view = new DataView(buffer);
    view.setInt32(4, 2, true); // biWidth
    view.setInt32(8, 4, true); // biHeight (doubled: 2 * actual height 2)
    view.setUint16(14, 32, true); // biBitCount

    const bytes = new Uint8Array(buffer);
    // File row 0 (bottom of image): blue, then white.
    bytes.set([255, 0, 0, 255, 255, 255, 255, 255], 40);
    // File row 1 (top of image): red, then green.
    bytes.set([0, 0, 255, 255, 0, 255, 0, 255], 48);

    const image = decodeIcoDib(bytes);
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);

    const px = (x: number, y: number) => {
      const i = (y * 2 + x) * 4;
      return [...image.data.slice(i, i + 4)];
    };
    expect(px(0, 0)).toEqual([255, 0, 0, 255]); // top-left: red
    expect(px(1, 0)).toEqual([0, 255, 0, 255]); // top-right: green
    expect(px(0, 1)).toEqual([0, 0, 255, 255]); // bottom-left: blue
    expect(px(1, 1)).toEqual([255, 255, 255, 255]); // bottom-right: white
  });

  it("rejects unsupported bit depths", () => {
    const buffer = new ArrayBuffer(40);
    const view = new DataView(buffer);
    view.setInt32(4, 1, true);
    view.setInt32(8, 2, true);
    view.setUint16(14, 8, true); // 8bpp indexed — not supported
    expect(() => decodeIcoDib(new Uint8Array(buffer))).toThrow(/8bpp/);
  });
});

describe("icoSizesForPreset", () => {
  it("maps favicon/app/single and defaults unknown presets to favicon", () => {
    expect(icoSizesForPreset("favicon")).toEqual([16, 32, 48]);
    expect(icoSizesForPreset("app")).toEqual([16, 32, 48, 64, 128, 256]);
    expect(icoSizesForPreset("single")).toEqual([256]);
    expect(icoSizesForPreset("unknown")).toEqual([16, 32, 48]);
  });
});

describe("buildIcoContainer", () => {
  it("writes ICONDIR, one ICONDIRENTRY per size, and concatenated PNG bytes", () => {
    const png16 = new Uint8Array([1, 1, 1]);
    const png256 = new Uint8Array([2, 2]);
    const ico = buildIcoContainer([
      { size: 16, png: png16 },
      { size: 256, png: png256 },
    ]);
    const view = new DataView(ico.buffer);

    expect(view.getUint16(0, true)).toBe(0); // reserved
    expect(view.getUint16(2, true)).toBe(1); // type
    expect(view.getUint16(4, true)).toBe(2); // count

    const directorySize = ICONDIR_SIZE + 2 * ICONDIRENTRY_SIZE;
    // Entry 0: 16px.
    expect(view.getUint8(ICONDIR_SIZE)).toBe(16);
    expect(view.getUint8(ICONDIR_SIZE + 1)).toBe(16);
    expect(view.getUint32(ICONDIR_SIZE + 8, true)).toBe(png16.length);
    expect(view.getUint32(ICONDIR_SIZE + 12, true)).toBe(directorySize);

    // Entry 1: 256px wraps to byte 0.
    const base1 = ICONDIR_SIZE + ICONDIRENTRY_SIZE;
    expect(view.getUint8(base1)).toBe(0);
    expect(view.getUint8(base1 + 1)).toBe(0);
    expect(view.getUint32(base1 + 8, true)).toBe(png256.length);
    expect(view.getUint32(base1 + 12, true)).toBe(directorySize + png16.length);

    expect([...ico.slice(directorySize, directorySize + png16.length)]).toEqual(
      [...png16],
    );
    expect([
      ...ico.slice(
        directorySize + png16.length,
        directorySize + png16.length + png256.length,
      ),
    ]).toEqual([...png256]);
    expect(ico.length).toBe(directorySize + png16.length + png256.length);
  });
});
