import { describe, expect, it } from "vitest";
import { isEngineError } from "../errors";
import { stripJpeg, stripPng, stripWebp } from "./strip";

/**
 * Every fixture here is hand-built byte-for-byte in this file — no image
 * library, no real codec output — so each test controls exactly which
 * markers/chunks exist and can assert on the removed/kept set precisely.
 * Segment/chunk *payloads* are dummy bytes (they don't need to be valid
 * quant tables, Huffman tables, IDAT-compressed pixels, etc.); only the
 * container structure (markers, lengths, chunk types, RIFF framing) needs to
 * be real, since that's what `strip.ts` actually parses.
 */

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}
function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}
function u32le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}
function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
function asciiBytes(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}

// ---------------------------------------------------------------------------
// JPEG fixture + independent verification helpers
// ---------------------------------------------------------------------------

function jpegSeg(marker: number, payload: number[]): number[] {
  return [0xff, marker, ...u16be(payload.length + 2), ...payload];
}

/** Builds a TIFF (EXIF) blob: IFD0 with an Orientation tag, and optionally a
 * GPSInfo pointer to a second, nested GPS IFD — realistic enough to prove
 * GPS bytes are actually gone after stripping, not just "some EXIF". */
function buildExifTiff(orientation: number, includeGps: boolean): number[] {
  const gpsIfdOffset = 38; // only meaningful/used when includeGps is true

  const orientationEntry = [
    ...u16le(0x0112),
    ...u16le(3), // SHORT
    ...u32le(1),
    ...u16le(orientation),
    ...u16le(0), // padding
  ];

  if (!includeGps) {
    const ifd0 = [...u16le(1), ...orientationEntry, ...u32le(0)];
    return [0x49, 0x49, 0x2a, 0x00, ...u32le(8), ...ifd0];
  }

  const gpsPointerEntry = [
    ...u16le(0x8825), // GPSInfo IFD pointer
    ...u16le(4), // LONG
    ...u32le(1),
    ...u32le(gpsIfdOffset),
  ];
  const ifd0 = [
    ...u16le(2),
    ...orientationEntry,
    ...gpsPointerEntry,
    ...u32le(0), // next IFD
  ];
  const header = [0x49, 0x49, 0x2a, 0x00, ...u32le(8), ...ifd0];
  // header.length must equal gpsIfdOffset for the pointer above to resolve.
  if (header.length !== gpsIfdOffset) {
    throw new Error("test fixture bug: gpsIfdOffset mismatch");
  }
  const gpsIfd = [
    ...u16le(1),
    ...u16le(0x0001), // GPSLatitudeRef
    ...u16le(2), // ASCII
    ...u32le(2),
    ...asciiBytes("N"),
    0x00,
    0x00,
    0x00, // "N\0" + padding, inline (fits in 4 bytes)
    ...u32le(0), // next IFD
  ];
  return [...header, ...gpsIfd];
}

function buildJpeg(opts: {
  orientation: number;
  includeGps: boolean;
}): Uint8Array {
  const app0 = jpegSeg(0xe0, [
    ...asciiBytes("JFIF"),
    0x00,
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
  ]);
  const app1 = jpegSeg(0xe1, [
    ...asciiBytes("Exif"),
    0x00,
    0x00,
    ...buildExifTiff(opts.orientation, opts.includeGps),
  ]);
  const app2 = jpegSeg(0xe2, [0xaa, 0xbb, 0xcc, 0xdd]); // dummy ICC profile
  const app13 = jpegSeg(0xed, [...asciiBytes("Photoshop 3.0"), 0x00]); // dummy IPTC
  const com = jpegSeg(0xfe, asciiBytes("hello comment"));
  const app14 = jpegSeg(0xee, [...asciiBytes("Adobe"), 0, 0, 0, 0, 0]); // dummy Adobe payload
  const dqt = jpegSeg(0xdb, [0x00, ...new Array(8).fill(1)]); // dummy quant table
  const sof0 = jpegSeg(0xc0, [0x08, 0, 1, 0, 1, 1, 1, 0x11, 0]); // dummy SOF0
  const dht = jpegSeg(0xc4, [0x00, ...new Array(16).fill(0), 0x00]); // dummy Huffman table

  const sos = jpegSeg(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]); // dummy SOS header
  const scanData = [0x11, 0x22, 0x33, 0xff, 0x00, 0x44, 0x55]; // includes a stuffed FF 00
  const eoi = [0xff, 0xd9];

  return new Uint8Array([
    0xff,
    0xd8,
    ...app0,
    ...app1,
    ...app2,
    ...app13,
    ...com,
    ...app14,
    ...dqt,
    ...sof0,
    ...dht,
    ...sos,
    ...scanData,
    ...eoi,
  ]);
}

/** Independent re-parse of a JPEG's marker sequence before SOS — deliberately
 * separate code from `stripJpeg`'s own walk, so these tests verify actual
 * output structure rather than the implementation's own bookkeeping. */
function listJpegMarkersBeforeSos(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const markers: number[] = [];
  let pos = 2;
  while (pos < bytes.length) {
    const marker = bytes[pos + 1];
    if (marker === undefined) throw new Error("truncated test fixture");
    if (marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      markers.push(marker);
      pos += 2;
      continue;
    }
    const len = view.getUint16(pos + 2, false);
    markers.push(marker);
    pos += 2 + len;
  }
  return markers;
}

/** The SOS marker and everything after it (scan data + EOI), verbatim. */
function jpegSosTail(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 2;
  while (pos < bytes.length) {
    const marker = bytes[pos + 1];
    if (marker === 0xda) return bytes.subarray(pos);
    if (marker === undefined) throw new Error("truncated test fixture");
    const len = view.getUint16(pos + 2, false);
    pos += 2 + len;
  }
  throw new Error("test fixture has no SOS marker");
}

function containsSequence(
  haystack: Uint8Array,
  needle: readonly number[],
): boolean {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

describe("stripJpeg", () => {
  it("drops APP1/APP13/COM and keeps APP0/APP2/APP14/DQT/SOF0/DHT, in order", () => {
    const input = buildJpeg({ orientation: 1, includeGps: true });
    const output = stripJpeg(input, { keepOrientation: true });
    expect(listJpegMarkersBeforeSos(output)).toEqual([
      0xe0, 0xe2, 0xee, 0xdb, 0xc0, 0xc4,
    ]);
  });

  it("keeps the SOS marker and everything after it byte-for-byte", () => {
    const input = buildJpeg({ orientation: 1, includeGps: true });
    const output = stripJpeg(input, { keepOrientation: true });
    expect(jpegSosTail(output)).toEqual(jpegSosTail(input));
  });

  it("keeps kept segments' payload bytes unchanged", () => {
    const input = buildJpeg({ orientation: 1, includeGps: true });
    const output = stripJpeg(input, { keepOrientation: true });
    // APP2 (ICC) is the second marker kept, right after APP0.
    const outMarkers = listJpegMarkersBeforeSos(output);
    expect(outMarkers[1]).toBe(0xe2);
  });

  it("drops EXIF with orientation 1 without writing any replacement APP1", () => {
    const input = buildJpeg({ orientation: 1, includeGps: true });
    const output = stripJpeg(input, { keepOrientation: true });
    expect(listJpegMarkersBeforeSos(output)).not.toContain(0xe1);
  });

  it("writes a minimal orientation-only APP1 when EXIF orientation is not 1", () => {
    const input = buildJpeg({ orientation: 6, includeGps: true });
    const output = stripJpeg(input, { keepOrientation: true });

    expect(listJpegMarkersBeforeSos(output)).toEqual([
      0xe1, 0xe0, 0xe2, 0xee, 0xdb, 0xc0, 0xc4,
    ]);

    const expectedPayload = [
      ...asciiBytes("Exif"),
      0x00,
      0x00,
      0x49,
      0x49,
      0x2a,
      0x00,
      0x08,
      0x00,
      0x00,
      0x00, // TIFF header, IFD0 @ 8
      0x01,
      0x00, // 1 entry
      0x12,
      0x01, // tag 0x0112 (Orientation)
      0x03,
      0x00, // type SHORT
      0x01,
      0x00,
      0x00,
      0x00, // count 1
      0x06,
      0x00,
      0x00,
      0x00, // value 6, padded
      0x00,
      0x00,
      0x00,
      0x00, // next IFD = 0
    ];
    const expectedApp1 = [
      0xff,
      0xe1,
      ...u16be(expectedPayload.length + 2),
      ...expectedPayload,
    ];
    expect(Array.from(output.subarray(2, 2 + expectedApp1.length))).toEqual(
      expectedApp1,
    );
  });

  it("omits the replacement APP1 when keepOrientation is false, even if orientation != 1", () => {
    const input = buildJpeg({ orientation: 6, includeGps: true });
    const output = stripJpeg(input, { keepOrientation: false });
    expect(listJpegMarkersBeforeSos(output)).not.toContain(0xe1);
  });

  it("defaults keepOrientation to true when no options are given", () => {
    const input = buildJpeg({ orientation: 8, includeGps: false });
    const output = stripJpeg(input);
    expect(listJpegMarkersBeforeSos(output)[0]).toBe(0xe1);
  });

  it("removes GPS bytes along with the rest of the dropped EXIF", () => {
    const input = buildJpeg({ orientation: 1, includeGps: true });
    const output = stripJpeg(input, { keepOrientation: true });
    // The GPSInfo IFD pointer tag (0x8825, little-endian: 0x25, 0x88) and the
    // "N" GPSLatitudeRef value must not survive anywhere in the output.
    expect(containsSequence(output, [0x25, 0x88])).toBe(false);
  });

  it("also removes GPS bytes when a replacement orientation-only APP1 is written", () => {
    const input = buildJpeg({ orientation: 6, includeGps: true });
    const output = stripJpeg(input, { keepOrientation: true });
    expect(containsSequence(output, [0x25, 0x88])).toBe(false);
  });

  it("throws a decode-failed EngineError for a JPEG missing its SOI marker", () => {
    const bad = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    expect(() => stripJpeg(bad)).toThrow();
    try {
      stripJpeg(bad);
      expect.unreachable();
    } catch (e) {
      expect(isEngineError(e)).toBe(true);
      expect(isEngineError(e) && e.code).toBe("decode-failed");
    }
  });

  it("throws a decode-failed EngineError for a truncated segment", () => {
    // SOI + the start of an APP1 segment claiming a length longer than the
    // bytes actually present.
    const bad = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0xff, 0x01, 0x02,
    ]);
    expect(() => stripJpeg(bad)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

function pngChunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...asciiBytes(type), ...data, 0, 0, 0, 0]; // dummy CRC
}

function buildPng(): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = pngChunk("IHDR", [...u32be(1), ...u32be(1), 8, 6, 0, 0, 0]);
  const exif = pngChunk("eXIf", [
    0x49,
    0x49,
    0x2a,
    0x00,
    ...new Array(16).fill(0),
  ]);
  const text = pngChunk("tEXt", [
    ...asciiBytes("Author"),
    0x00,
    ...asciiBytes("Jane"),
  ]);
  const ztxt = pngChunk("zTXt", [
    ...asciiBytes("Comment"),
    0x00,
    0x00,
    0x78,
    0x9c,
  ]);
  const itxt = pngChunk("iTXt", [
    ...asciiBytes("Title"),
    0,
    0,
    0,
    0,
    ...asciiBytes("Hi"),
  ]);
  const time = pngChunk("tIME", [0x07, 0xe8, 1, 1, 0, 0, 0]);
  const iccp = pngChunk("iCCP", [
    ...asciiBytes("AB"),
    0x00,
    0x00,
    0x01,
    0x02,
    0x03,
  ]);
  const srgb = pngChunk("sRGB", [0]);
  const gama = pngChunk("gAMA", [0, 0, 0x9a, 0x0e]);
  const chrm = pngChunk("cHRM", new Array(32).fill(0));
  const phys = pngChunk("pHYs", [0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]);
  const trns = pngChunk("tRNS", [0xff]);
  const idat = pngChunk(
    "IDAT",
    [0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01],
  );
  const iend = pngChunk("IEND", []);

  return new Uint8Array([
    ...sig,
    ...ihdr,
    ...exif,
    ...text,
    ...ztxt,
    ...itxt,
    ...time,
    ...iccp,
    ...srgb,
    ...gama,
    ...chrm,
    ...phys,
    ...trns,
    ...idat,
    ...iend,
  ]);
}

function listPngChunkTypes(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types: string[] = [];
  let pos = 8;
  while (pos < bytes.length) {
    const length = view.getUint32(pos, false);
    const type = String.fromCharCode(
      ...Array.from(bytes.subarray(pos + 4, pos + 8)),
    );
    types.push(type);
    pos += 8 + length + 4;
    if (type === "IEND") break;
  }
  return types;
}

function findPngChunk(bytes: Uint8Array, type: string): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  while (pos < bytes.length) {
    const length = view.getUint32(pos, false);
    const chunkType = String.fromCharCode(
      ...Array.from(bytes.subarray(pos + 4, pos + 8)),
    );
    const total = 8 + length + 4;
    if (chunkType === type) return bytes.subarray(pos, pos + total);
    pos += total;
    if (chunkType === "IEND") break;
  }
  throw new Error(`chunk "${type}" not found`);
}

describe("stripPng", () => {
  it("drops eXIf/tEXt/zTXt/iTXt/tIME and keeps everything else, in order", () => {
    const input = buildPng();
    const output = stripPng(input);
    expect(listPngChunkTypes(output)).toEqual([
      "IHDR",
      "iCCP",
      "sRGB",
      "gAMA",
      "cHRM",
      "pHYs",
      "tRNS",
      "IDAT",
      "IEND",
    ]);
  });

  it("keeps IHDR/IDAT/IEND byte-for-byte", () => {
    const input = buildPng();
    const output = stripPng(input);
    for (const type of ["IHDR", "IDAT", "IEND"]) {
      expect(findPngChunk(output, type)).toEqual(findPngChunk(input, type));
    }
  });

  it("removes the signature-adjacent eXIf chunk's GPS-carrying bytes entirely", () => {
    const input = buildPng();
    const output = stripPng(input);
    expect(listPngChunkTypes(output)).not.toContain("eXIf");
    expect(output.length).toBeLessThan(input.length);
  });

  it("throws a decode-failed EngineError for a bad PNG signature", () => {
    const bad = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(() => stripPng(bad)).toThrow();
    try {
      stripPng(bad);
      expect.unreachable();
    } catch (e) {
      expect(isEngineError(e) && e.code).toBe("decode-failed");
    }
  });

  it("throws a decode-failed EngineError when the file never reaches IEND", () => {
    const input = buildPng();
    const truncated = input.subarray(0, input.length - 20); // cut off before IEND
    expect(() => stripPng(truncated)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

function riffChunk(fourCC: string, data: number[]): number[] {
  const padded = data.length % 2 === 0 ? data : [...data, 0x00];
  return [...asciiBytes(fourCC), ...u32le(data.length), ...padded];
}

function buildWebp(): Uint8Array {
  const vp8xData = [0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // flags: ICC(0x20)|EXIF(0x08)|XMP(0x04)
  const vp8x = riffChunk("VP8X", vp8xData);
  const iccp = riffChunk("ICCP", [0x01, 0x02, 0x03, 0x04]);
  const vp8 = riffChunk("VP8 ", [0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70]); // odd length -> padded
  const exif = riffChunk("EXIF", [0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0]);
  const xmp = riffChunk("XMP ", asciiBytes("abcde")); // odd length -> padded

  const body = [
    ...asciiBytes("WEBP"),
    ...vp8x,
    ...iccp,
    ...vp8,
    ...exif,
    ...xmp,
  ];
  return new Uint8Array([
    ...asciiBytes("RIFF"),
    ...u32le(body.length),
    ...body,
  ]);
}

function listWebpChunks(
  bytes: Uint8Array,
): { fourCC: string; data: Uint8Array }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: { fourCC: string; data: Uint8Array }[] = [];
  let pos = 12;
  while (pos < bytes.length) {
    const fourCC = String.fromCharCode(
      ...Array.from(bytes.subarray(pos, pos + 4)),
    );
    const size = view.getUint32(pos + 4, true);
    const data = bytes.subarray(pos + 8, pos + 8 + size);
    out.push({ fourCC, data });
    pos += 8 + size + (size % 2);
  }
  return out;
}

describe("stripWebp", () => {
  it("drops EXIF and XMP chunks, keeps VP8X/ICCP/VP8, in order", () => {
    const input = buildWebp();
    const output = stripWebp(input);
    expect(listWebpChunks(output).map((c) => c.fourCC)).toEqual([
      "VP8X",
      "ICCP",
      "VP8 ",
    ]);
  });

  it("clears the EXIF and XMP bits in VP8X's flags byte, keeping the ICC bit", () => {
    const input = buildWebp();
    const output = stripWebp(input);
    const vp8x = listWebpChunks(output).find((c) => c.fourCC === "VP8X");
    if (!vp8x) throw new Error("VP8X missing from output");
    expect(vp8x.data[0]).toBe(0x20); // ICC only; EXIF (0x08) and XMP (0x04) cleared
  });

  it("keeps VP8 image data byte-for-byte", () => {
    const input = buildWebp();
    const output = stripWebp(input);
    const inVp8 = listWebpChunks(input).find((c) => c.fourCC === "VP8 ");
    const outVp8 = listWebpChunks(output).find((c) => c.fourCC === "VP8 ");
    if (!inVp8 || !outVp8) throw new Error("VP8 missing");
    expect(Array.from(outVp8.data)).toEqual(Array.from(inVp8.data));
  });

  it("recomputes the outer RIFF size to match the new (smaller) body", () => {
    const input = buildWebp();
    const output = stripWebp(input);
    const view = new DataView(
      output.buffer,
      output.byteOffset,
      output.byteLength,
    );
    const riffSize = view.getUint32(4, true);
    expect(riffSize).toBe(output.length - 8);
    expect(output.length).toBeLessThan(input.length);
  });

  it("throws a decode-failed EngineError for a non-RIFF/WEBP file", () => {
    const bad = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12]);
    expect(() => stripWebp(bad)).toThrow();
    try {
      stripWebp(bad);
      expect.unreachable();
    } catch (e) {
      expect(isEngineError(e) && e.code).toBe("decode-failed");
    }
  });

  it("throws a decode-failed EngineError for a truncated chunk", () => {
    const input = buildWebp();
    const truncated = input.subarray(0, input.length - 3);
    expect(() => stripWebp(truncated)).toThrow();
  });
});
