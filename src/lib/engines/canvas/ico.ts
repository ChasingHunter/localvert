/**
 * ICO container: directory parsing + entry picking (decode side) and
 * directory building (encode side) — pure TS, no browser API needed for any
 * of it. Kept in its own module, same reasoning as `bmp.ts`/`gif.ts`.
 *
 * Decoding a chosen entry has two shapes: a PNG-compressed entry (Vista+,
 * the only kind this codebase ever writes — see `buildIcoContainer`) is just
 * PNG bytes, decoded by handing it back through the ordinary PNG path
 * (`adapter.ts`'s `runDecodeIco`, one `createImageBitmap` call); a legacy DIB
 * entry has no such shortcut, so `decodeIcoDib` below decodes it by hand.
 */
import { EngineError } from "../errors";
import type { RasterImage } from "../types";

export interface IcoDirEntry {
  /** 0 in the file means 256 — already resolved here. */
  width: number;
  height: number;
  bitCount: number;
  size: number;
  offset: number;
}

const ICONDIR_SIZE = 6;
const ICONDIRENTRY_SIZE = 16;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function matchesMagic(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

/**
 * Parses an ICO file's ICONDIR + ICONDIRENTRY array. `formats.ts`'s magic
 * bytes already gate reserved=0/type=1 at the sniff layer, but a
 * malformed/truncated file can still reach here, hence the same checks
 * repeated as real validation (throwing `decode-failed`, not just returning
 * garbage).
 */
export function parseIcoDirectory(bytes: Uint8Array): IcoDirEntry[] {
  if (bytes.length < ICONDIR_SIZE) {
    throw new EngineError("decode-failed", "ico file is too short", {
      engine: "canvas",
    });
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const reserved = view.getUint16(0, true);
  const type = view.getUint16(2, true);
  if (reserved !== 0 || type !== 1) {
    throw new EngineError("decode-failed", "not an ICO file (bad ICONDIR)", {
      engine: "canvas",
    });
  }

  const count = view.getUint16(4, true);
  const entries: IcoDirEntry[] = [];
  for (let i = 0; i < count; i++) {
    const base = ICONDIR_SIZE + i * ICONDIRENTRY_SIZE;
    if (base + ICONDIRENTRY_SIZE > bytes.length) {
      throw new EngineError("decode-failed", "ico directory is truncated", {
        engine: "canvas",
      });
    }
    const rawWidth = view.getUint8(base);
    const rawHeight = view.getUint8(base + 1);
    entries.push({
      width: rawWidth === 0 ? 256 : rawWidth,
      height: rawHeight === 0 ? 256 : rawHeight,
      bitCount: view.getUint16(base + 6, true),
      size: view.getUint32(base + 8, true),
      offset: view.getUint32(base + 12, true),
    });
  }
  return entries;
}

/** Picks the highest-resolution entry (by pixel area) — the best single
 * raster to decode out of a multi-size icon. */
export function pickLargestIcoEntry(
  entries: readonly IcoDirEntry[],
): IcoDirEntry {
  if (entries.length === 0) {
    throw new EngineError("decode-failed", "ico file has no entries", {
      engine: "canvas",
    });
  }
  return entries.reduce((best, entry) =>
    entry.width * entry.height > best.width * best.height ? entry : best,
  );
}

/** `noUncheckedIndexedAccess` makes a typed-array index read `T | undefined`;
 * every index used in `decodeIcoDib` is computed from the DIB's own
 * width/height/stride math, so it's always in range — this just satisfies
 * the type without a forbidden `!` non-null assertion. */
function byteAt(bytes: Uint8Array, i: number): number {
  const value = bytes[i];
  if (value === undefined) {
    throw new RangeError(`ico DIB decode: byte ${i} out of range`);
  }
  return value;
}

export function extractIcoEntryBytes(
  bytes: Uint8Array,
  entry: IcoDirEntry,
): Uint8Array {
  return bytes.subarray(entry.offset, entry.offset + entry.size);
}

/** True if an entry's bytes are a PNG (the Vista+ format) rather than a
 * legacy BITMAPINFOHEADER (DIB). */
export function isPngIcoEntry(entryBytes: Uint8Array): boolean {
  return matchesMagic(entryBytes, PNG_MAGIC);
}

/**
 * Decodes a legacy DIB icon entry (BITMAPINFOHEADER + XOR pixel data + a
 * 1bpp AND mask) directly to a `RasterImage` — no canvas involved. Supports
 * 32bpp (BGRA — alpha is already present, so the AND mask is redundant and
 * ignored, the same convention Windows itself uses) and 24bpp (BGR —
 * opacity comes from the AND mask instead, since there's no alpha channel).
 * Other bit depths (1/4/8bpp indexed) are rare in any icon this app would
 * realistically be asked to decode and are rejected outright rather than
 * guessed at.
 */
export function decodeIcoDib(entryBytes: Uint8Array): RasterImage {
  if (entryBytes.length < 40) {
    throw new EngineError("decode-failed", "ico DIB entry is too short", {
      engine: "canvas",
    });
  }
  const view = new DataView(
    entryBytes.buffer,
    entryBytes.byteOffset,
    entryBytes.byteLength,
  );
  const width = view.getInt32(4, true);
  // ICO stores the XOR+AND combined height; the real image height is half.
  const height = view.getInt32(8, true) / 2;
  const bitCount = view.getUint16(14, true);

  if (bitCount !== 32 && bitCount !== 24) {
    throw new EngineError(
      "unsupported",
      `ico DIB entries with ${bitCount}bpp are not supported`,
      { engine: "canvas" },
    );
  }

  const bytesPerPixel = bitCount / 8;
  const xorOffset = 40; // no color table at 24/32bpp
  const xorStride = Math.ceil((width * bitCount) / 32) * 4;
  const andOffset = xorOffset + xorStride * height;
  const andStride = Math.ceil(width / 32) * 4;

  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    // DIB rows are bottom-up; output row 0 is the image's top row.
    const srcRow = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const srcI = xorOffset + srcRow * xorStride + x * bytesPerPixel;
      const dstI = (y * width + x) * 4;
      const b = byteAt(entryBytes, srcI);
      const g = byteAt(entryBytes, srcI + 1);
      const r = byteAt(entryBytes, srcI + 2);
      let a: number;
      if (bitCount === 32) {
        a = byteAt(entryBytes, srcI + 3);
      } else {
        const maskByteI = andOffset + srcRow * andStride + (x >> 3);
        const bit = 7 - (x % 8);
        const masked = ((byteAt(entryBytes, maskByteI) >> bit) & 1) === 1;
        a = masked ? 0 : 255;
      }
      data[dstI] = r;
      data[dstI + 1] = g;
      data[dstI + 2] = b;
      data[dstI + 3] = a;
    }
  }

  return { width, height, data };
}

/** Sizes (px, square) for each `sizes` preset — see `png-to-ico.ts` /
 * `_shared-options.ts`'s `icoOptions`. */
export function icoSizesForPreset(preset: string): readonly number[] {
  switch (preset) {
    case "app":
      return [16, 32, 48, 64, 128, 256];
    case "single":
      return [256];
    default:
      return [16, 32, 48]; // "favicon"
  }
}

export interface IcoEncodeEntry {
  size: number;
  png: Uint8Array;
}

/**
 * Builds an ICO file (ICONDIR + ICONDIRENTRY array + concatenated entry
 * bytes) from already-encoded PNG entries — Vista+ format, one PNG per
 * requested size, the only kind this codebase writes. Pure container
 * assembly: the per-size resize + PNG-encode happens in `adapter.ts`'s
 * `runEncodeIco` (needs `OffscreenCanvas`), kept separate so this part is
 * unit-testable in Node without one.
 */
export function buildIcoContainer(
  entries: readonly IcoEncodeEntry[],
): Uint8Array {
  const directorySize = ICONDIR_SIZE + entries.length * ICONDIRENTRY_SIZE;
  const totalSize =
    directorySize + entries.reduce((sum, e) => sum + e.png.length, 0);

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, entries.length, true);

  let dataOffset = directorySize;
  entries.forEach((entry, i) => {
    const base = ICONDIR_SIZE + i * ICONDIRENTRY_SIZE;
    // 256px wraps to the 1-byte 0 the format uses to mean "256".
    const sizeByte = entry.size === 256 ? 0 : entry.size;
    view.setUint8(base, sizeByte);
    view.setUint8(base + 1, sizeByte);
    view.setUint8(base + 2, 0); // color count: N/A above 8bpp
    view.setUint8(base + 3, 0); // reserved
    view.setUint16(base + 4, 1, true); // planes
    view.setUint16(base + 6, 32, true); // bitCount — informational for PNG entries
    view.setUint32(base + 8, entry.png.length, true);
    view.setUint32(base + 12, dataOffset, true);

    bytes.set(entry.png, dataOffset);
    dataOffset += entry.png.length;
  });

  return bytes;
}
