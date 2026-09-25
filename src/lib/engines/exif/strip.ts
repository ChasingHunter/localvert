import { EngineError } from "../errors";

/**
 * Byte-level, lossless EXIF/metadata stripping for JPEG, PNG and WebP —
 * pure functions, no DOM/wasm/worker dependency (importable from Node tests
 * directly), wrapped for the engine host by `./adapter.ts`. Every function
 * here copies the parts of the input it keeps verbatim; nothing is
 * re-encoded, so image data is bit-for-bit identical to the source.
 */

export interface StripOptions {
  /**
   * Default true. A JPEG's EXIF Orientation tag is the only piece of EXIF
   * that changes how the image *displays* — dropping it outright would make
   * a rotated photo display upright-but-wrong once its EXIF is gone. When
   * true and the source's EXIF orientation isn't 1 (normal), a minimal
   * replacement APP1 carrying only the Orientation tag is written in place
   * of the real one. Meaningless for PNG/WebP, which have no orientation
   * concept in their metadata.
   */
  keepOrientation?: boolean;
}

/** Concatenates byte chunks into one freshly allocated, exactly-sized
 * buffer — every function below builds its output this way so the result's
 * `.buffer` is a real `ArrayBuffer` with no leftover offset/capacity from
 * whatever chunks (subarrays of the input) it was assembled from. */
function concatAll(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function asciiBytes(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) {
    s += String.fromCharCode(bytes[offset + i] ?? 0);
  }
  return s;
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

const JPEG_APP1 = 0xe1; // EXIF or XMP — dropped (rebuilt orientation-only below)
const JPEG_APP13 = 0xed; // IPTC/Photoshop — dropped
const JPEG_COM = 0xfe; // comment — dropped
const JPEG_SOS = 0xda;
const JPEG_EOI = 0xd9;
const JPEG_TEM = 0x01;

/** Markers with no length field and no payload: TEM and the 8 restart
 * markers (RST0-RST7, used only inside entropy-coded scan data, which this
 * module never parses — listed for completeness of `hasNoPayload`). */
function hasNoPayload(marker: number): boolean {
  return marker === JPEG_TEM || (marker >= 0xd0 && marker <= 0xd7);
}

/**
 * Everything that isn't APP1/APP13/COM is kept verbatim — notably APP0
 * (JFIF), APP2 (ICC profile: dropping it would shift the decoded image's
 * colours, not just lose metadata), APP14 (Adobe's colour-transform hint)
 * and every DQT/DHT/SOF segment, none of which describe the photographer or
 * device.
 */
const DROP_JPEG_MARKERS = new Set([JPEG_APP1, JPEG_APP13, JPEG_COM]);

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const ORIENTATION_TAG = 0x0112;
const TYPE_SHORT = 3;

/**
 * Reads the EXIF Orientation tag (0x0112) out of an APP1 segment's payload,
 * if present. Returns `null` for anything that isn't recognizable EXIF, or
 * that doesn't carry an Orientation tag — lenient on purpose: this segment
 * is being dropped either way, so a malformed/unreadable embedded EXIF just
 * means orientation can't be preserved, not a reason to fail the whole strip.
 */
function readExifOrientation(app1Payload: Uint8Array): number | null {
  if (app1Payload.length < 6 + 8) return null;
  for (let i = 0; i < 6; i++) {
    if (app1Payload[i] !== EXIF_HEADER[i]) return null;
  }
  const tiff = app1Payload.subarray(6);

  const b0 = tiff[0];
  const b1 = tiff[1];
  let little: boolean;
  if (b0 === 0x49 && b1 === 0x49)
    little = true; // "II"
  else if (b0 === 0x4d && b1 === 0x4d)
    little = false; // "MM"
  else return null;

  let view: DataView;
  try {
    view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
    if (view.getUint16(2, little) !== 42) return null;

    const ifdOffset = view.getUint32(4, little);
    const entryCount = view.getUint16(ifdOffset, little);
    for (let i = 0; i < entryCount; i++) {
      const entryOffset = ifdOffset + 2 + i * 12;
      if (entryOffset + 12 > tiff.length) break;
      const tag = view.getUint16(entryOffset, little);
      if (tag === ORIENTATION_TAG) {
        const type = view.getUint16(entryOffset + 2, little);
        return type === TYPE_SHORT
          ? view.getUint16(entryOffset + 8, little)
          : null;
      }
    }
  } catch {
    return null; // out-of-bounds read — malformed embedded EXIF, not fatal
  }
  return null;
}

/**
 * Builds a minimal, from-scratch APP1 EXIF segment containing *only* the
 * Orientation tag: `"Exif\0\0"` + a little-endian TIFF header (`II`, magic
 * 42, IFD0 at offset 8) + one IFD0 entry (tag 0x0112, type SHORT, count 1,
 * the orientation value) + a zero "next IFD" offset. 36 bytes total —
 * nothing else from the source's real EXIF (no GPS, no camera make/model,
 * no thumbnail) survives into it.
 */
function buildOrientationApp1(orientation: number): Uint8Array {
  const payload = new Uint8Array(32);
  payload.set(EXIF_HEADER, 0);
  payload.set([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00], 6); // TIFF header, IFD0 @ 8
  const view = new DataView(payload.buffer);
  view.setUint16(14, 1, true); // IFD0 entry count = 1
  view.setUint16(16, ORIENTATION_TAG, true);
  view.setUint16(18, TYPE_SHORT, true);
  view.setUint32(20, 1, true); // count = 1
  view.setUint16(24, orientation, true); // value (SHORT, left-justified in the 4-byte field)
  view.setUint16(26, 0, true); // padding
  view.setUint32(28, 0, true); // next IFD offset = 0 (none)

  const segLen = payload.length + 2; // length field includes itself
  const header = new Uint8Array(4);
  header[0] = 0xff;
  header[1] = JPEG_APP1;
  new DataView(header.buffer).setUint16(2, segLen, false);

  return concatAll([header, payload]);
}

/**
 * Walks a JPEG's marker segments from SOI. Drops APP1 (EXIF/XMP), APP13
 * (IPTC/Photoshop) and COM; keeps APP0, APP2, APP14, DQT/DHT/SOF and every
 * other marker verbatim. Once SOS is reached, the rest of the file (the SOS
 * header, the entropy-coded scan data, and EOI) is copied through
 * unexamined — none of that needs to be parsed to strip metadata, only the
 * header markers before it do. Throws `EngineError("decode-failed")` on
 * anything that doesn't parse as a well-formed marker sequence. Does not
 * tolerate the 0xFF fill bytes the JPEG spec allows between markers (real
 * encoders, including this project's own, don't emit them) — a marker must
 * start immediately at the current position.
 */
export function stripJpeg(
  bytes: Uint8Array,
  options: StripOptions = {},
): Uint8Array {
  const keepOrientation = options.keepOrientation ?? true;
  const fail = (): never => {
    throw new EngineError("decode-failed", "malformed JPEG", {
      engine: "exif",
    });
  };

  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail();

  const kept: Uint8Array[] = [bytes.subarray(0, 2)]; // SOI
  let orientation: number | null = null;
  let pos = 2;

  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    for (;;) {
      if (pos + 2 > bytes.length || bytes[pos] !== 0xff) fail();
      // getUint8 (unlike indexed access) returns a definite `number`, not
      // `number | undefined` — safe here since the bounds check above
      // already guarantees `pos + 1 < bytes.length`.
      const marker = view.getUint8(pos + 1);

      if (marker === JPEG_SOS) {
        kept.push(bytes.subarray(pos)); // SOS header + scan data + EOI, verbatim
        pos = bytes.length;
        break;
      }

      if (marker === JPEG_EOI) {
        kept.push(bytes.subarray(pos, pos + 2));
        pos += 2;
        break;
      }

      if (hasNoPayload(marker)) {
        kept.push(bytes.subarray(pos, pos + 2));
        pos += 2;
        continue;
      }

      const segLen = view.getUint16(pos + 2, false);
      if (segLen < 2) fail();
      const segEnd = pos + 2 + segLen;
      if (segEnd > bytes.length) fail();

      if (marker === JPEG_APP1) {
        if (keepOrientation && orientation === null) {
          orientation = readExifOrientation(bytes.subarray(pos + 4, segEnd));
        }
        // dropped — EXIF or XMP, neither survives
      } else if (!DROP_JPEG_MARKERS.has(marker)) {
        kept.push(bytes.subarray(pos, segEnd));
      }

      pos = segEnd;
    }
  } catch (e) {
    if (e instanceof EngineError) throw e;
    fail();
  }

  if (pos < bytes.length) fail(); // loop exited without reaching SOS or EOI

  if (keepOrientation && orientation !== null && orientation !== 1) {
    // Inserted right after SOI — EXIF conventionally comes first when
    // present, ahead of even a JFIF APP0.
    kept.splice(1, 0, buildOrientationApp1(orientation));
  }

  return concatAll(kept);
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** eXIf (EXIF, incl. GPS), tEXt/zTXt/iTXt (text, may carry a "GPS"/free-text
 * comment) and tIME (last-modified) are dropped. iCCP/sRGB/gAMA/cHRM (colour
 * profile) and pHYs/tRNS (rendering hints) are not metadata about the
 * photographer/device and are kept, same as every chunk this list doesn't
 * name. */
const DROP_PNG_CHUNKS = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

/**
 * Walks a PNG's chunks after its 8-byte signature. Each chunk is
 * length(4 BE) + type(4 ASCII) + data(length bytes) + crc(4) — kept chunks
 * are copied through with their original CRC untouched, since their bytes
 * don't change. Throws `EngineError("decode-failed")` on a truncated chunk
 * or a file that never reaches IEND.
 */
export function stripPng(bytes: Uint8Array): Uint8Array {
  const fail = (): never => {
    throw new EngineError("decode-failed", "malformed PNG", {
      engine: "exif",
    });
  };

  if (bytes.length < 8) fail();
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) fail();
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let pos = 8;
  let sawIend = false;

  while (pos < bytes.length) {
    if (pos + 8 > bytes.length) fail();
    const length = view.getUint32(pos, false);
    const type = asciiAt(bytes, pos + 4, 4);
    const chunkTotal = 8 + length + 4; // length field + type + data + crc
    if (chunkTotal < 12 || pos + chunkTotal > bytes.length) fail();

    if (!DROP_PNG_CHUNKS.has(type)) {
      kept.push(bytes.subarray(pos, pos + chunkTotal));
    }

    pos += chunkTotal;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }

  if (!sawIend) fail();
  return concatAll(kept);
}

// ---------------------------------------------------------------------------
// WebP (RIFF)
// ---------------------------------------------------------------------------

/** VP8X's flags byte (the first byte of its 10-byte payload): bit 3 (0x08)
 * is the EXIF flag, bit 2 (0x04) is the XMP flag — see the WebP container
 * spec's "Extended File Format" chunk layout. */
const VP8X_EXIF_XMP_MASK = 0x0c;

/**
 * Walks a WebP (RIFF) container's chunks after the 12-byte `RIFF`/size/
 * `WEBP` header. Drops `EXIF` and `XMP ` chunks outright; if a `VP8X`
 * (extended format) chunk is present, its flags byte has the EXIF/XMP bits
 * cleared (rather than dropping VP8X itself — it also carries canvas
 * size/alpha/animation flags kept chunks like `ICCP` depend on) and the
 * outer RIFF size is recomputed to match. Throws
 * `EngineError("decode-failed")` on anything that isn't a well-formed
 * RIFF/WEBP chunk sequence.
 */
export function stripWebp(bytes: Uint8Array): Uint8Array {
  const fail = (): never => {
    throw new EngineError("decode-failed", "malformed WebP", {
      engine: "exif",
    });
  };

  if (bytes.length < 12) fail();
  if (asciiAt(bytes, 0, 4) !== "RIFF" || asciiAt(bytes, 8, 4) !== "WEBP") {
    fail();
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Uint8Array[] = [bytes.subarray(8, 12)]; // "WEBP"
  let pos = 12;

  while (pos < bytes.length) {
    if (pos + 8 > bytes.length) fail();
    const fourCC = asciiAt(bytes, pos, 4);
    const size = view.getUint32(pos + 4, true);
    const dataStart = pos + 8;
    const padded = size + (size % 2);
    if (dataStart + padded > bytes.length) fail();
    const chunkEnd = dataStart + padded;

    if (fourCC === "EXIF" || fourCC === "XMP ") {
      // dropped entirely
    } else if (fourCC === "VP8X" && size >= 1) {
      const chunk = bytes.slice(pos, chunkEnd); // copy — the flags byte is edited below
      chunk[8] = (chunk[8] ?? 0) & ~VP8X_EXIF_XMP_MASK;
      chunks.push(chunk);
    } else {
      chunks.push(bytes.subarray(pos, chunkEnd));
    }

    pos = chunkEnd;
  }

  const body = concatAll(chunks); // "WEBP" + every kept chunk
  const header = new Uint8Array(8);
  header.set(asciiBytes("RIFF"), 0);
  new DataView(header.buffer).setUint32(4, body.length, true);

  return concatAll([header, body]);
}
