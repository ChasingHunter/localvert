/**
 * BMP encode: `RasterImage` -> bytes, pure TS (no wasm, no canvas API) — the
 * browser has nothing that encodes BMP, so unlike jpg/png/webp this can't go
 * through `OffscreenCanvas.convertToBlob`. Kept in its own module rather than
 * inlined in adapter.ts, same reasoning as `mediabunny/gif.ts`'s doc comment:
 * parallel work on `adapter.ts`'s dispatch doesn't collide with this file.
 *
 * 24-bit BI_RGB when every pixel is fully opaque (the common case, and the
 * format any BMP reader supports); 32-bit BI_BITFIELDS with an explicit alpha
 * channel otherwise, so a transparent PNG source round-trips instead of
 * silently losing its alpha. Rows are written bottom-up (positive
 * `biHeight`, the BMP convention every reader expects for BI_RGB/BITFIELDS)
 * and padded to a 4-byte boundary, per the format.
 */
import type { RasterImage } from "../types";

const FILE_HEADER_SIZE = 14;
const INFO_HEADER_SIZE = 40;
/** R/G/B/(unused) 32-bit masks for BI_BITFIELDS — the alpha byte is read
 * implicitly as whatever's left over, the same convention Windows icons and
 * most real-world 32bpp BMPs use rather than a full BITMAPV3+ alpha mask. */
const BITFIELDS_SIZE = 12;
const BI_RGB = 0;
const BI_BITFIELDS = 3;
/** 72 DPI in pixels-per-meter, same nominal resolution every other encoder
 * in this codebase writes (e.g. jsquash defaults) — BMP readers ignore this
 * for anything but print, but a real BMP header always carries some value. */
const PELS_PER_METER = 2835;

function isFullyOpaque(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return false;
  }
  return true;
}

function rowSize(width: number, bitsPerPixel: 24 | 32): number {
  return Math.ceil((width * bitsPerPixel) / 32) * 4;
}

/** `noUncheckedIndexedAccess` makes a typed-array index read `T | undefined`;
 * every index used here is computed from `image.width`/`image.height`
 * themselves, so it's always in range — this just satisfies the type
 * without a forbidden `!` non-null assertion. */
function byteAt(data: Uint8ClampedArray, i: number): number {
  const value = data[i];
  if (value === undefined) {
    throw new RangeError(`bmp encode: pixel byte ${i} out of range`);
  }
  return value;
}

/** Writes the pixel data bottom-up, BGR(A) byte order, each row padded with
 * zero bytes to a 4-byte boundary. */
function writePixels(
  view: DataView,
  offset: number,
  image: RasterImage,
  bitsPerPixel: 24 | 32,
): void {
  const { width, height, data } = image;
  const stride = rowSize(width, bitsPerPixel);
  const bytesPerPixel = bitsPerPixel / 8;

  for (let y = 0; y < height; y++) {
    // Bottom-up: the file's first row is the image's last row.
    const srcRow = height - 1 - y;
    const rowOffset = offset + y * stride;
    for (let x = 0; x < width; x++) {
      const srcI = (srcRow * width + x) * 4;
      const dstI = rowOffset + x * bytesPerPixel;
      view.setUint8(dstI, byteAt(data, srcI + 2)); // B
      view.setUint8(dstI + 1, byteAt(data, srcI + 1)); // G
      view.setUint8(dstI + 2, byteAt(data, srcI)); // R
      if (bitsPerPixel === 32) {
        view.setUint8(dstI + 3, byteAt(data, srcI + 3)); // A
      }
    }
    // Row padding bytes are already zero — `ArrayBuffer` is zero-initialized.
  }
}

/** Encodes a `RasterImage` as a BMP file. */
export function encodeBmp(image: RasterImage): Uint8Array {
  const opaque = isFullyOpaque(image.data);
  const bitsPerPixel: 24 | 32 = opaque ? 24 : 32;
  const compression = opaque ? BI_RGB : BI_BITFIELDS;
  const infoHeaderSize = INFO_HEADER_SIZE + (opaque ? 0 : BITFIELDS_SIZE);
  const pixelDataOffset = FILE_HEADER_SIZE + infoHeaderSize;
  const stride = rowSize(image.width, bitsPerPixel);
  const pixelDataSize = stride * image.height;
  const fileSize = pixelDataOffset + pixelDataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  let o = 0;

  // BITMAPFILEHEADER
  view.setUint8(o, 0x42); // 'B'
  view.setUint8(o + 1, 0x4d); // 'M'
  view.setUint32(o + 2, fileSize, true);
  view.setUint32(o + 6, 0, true); // reserved
  view.setUint32(o + 10, pixelDataOffset, true);
  o += FILE_HEADER_SIZE;

  // BITMAPINFOHEADER
  view.setUint32(o, infoHeaderSize, true);
  view.setInt32(o + 4, image.width, true);
  view.setInt32(o + 8, image.height, true); // positive: bottom-up
  view.setUint16(o + 12, 1, true); // biPlanes
  view.setUint16(o + 14, bitsPerPixel, true);
  view.setUint32(o + 16, compression, true);
  view.setUint32(o + 20, pixelDataSize, true);
  view.setInt32(o + 24, PELS_PER_METER, true);
  view.setInt32(o + 28, PELS_PER_METER, true);
  view.setUint32(o + 32, 0, true); // biClrUsed
  view.setUint32(o + 36, 0, true); // biClrImportant
  o += INFO_HEADER_SIZE;

  if (!opaque) {
    // BI_BITFIELDS color masks, in R/G/B order.
    view.setUint32(o, 0x00ff0000, true);
    view.setUint32(o + 4, 0x0000ff00, true);
    view.setUint32(o + 8, 0x000000ff, true);
    o += BITFIELDS_SIZE;
  }

  writePixels(view, o, image, bitsPerPixel);

  return new Uint8Array(buffer);
}
