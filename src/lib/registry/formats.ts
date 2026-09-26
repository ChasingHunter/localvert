import type { Category } from "./categories";

/**
 * A dropped file's extension is a claim; its first bytes are the fact. Every
 * `FormatSpec` in `FORMATS` below carries `magic` — the byte signature that
 * proves what a file actually is, independent of its name. `sniffFormat` /
 * `sniffFile` are the only functions allowed to answer "what format is this
 * file" for real; `formatFromFilename` is a hint only (pre-filling a UI
 * before the bytes are read), never a substitute.
 *
 * See docs/ARCHITECTURE.md "Formats are sniffed, not trusted".
 */

export interface MagicPattern {
  offset: number;
  bytes: readonly number[];
}

export interface FormatSpec {
  label: string;
  /** Lowercase, no leading dot. First entry is the canonical output ext. */
  ext: readonly string[];
  mime: string;
  category: Category;
  /**
   * OR of alternatives; each alternative is an AND of patterns. A format
   * matches if any alternative's patterns all match.
   */
  magic: readonly (readonly MagicPattern[])[];
}

/** Byte values of an ASCII string, for signatures like "RIFF" or "%PDF-". */
function ascii(s: string): readonly number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}

export const FORMATS = {
  jpg: {
    label: "JPEG",
    ext: ["jpg", "jpeg"],
    mime: "image/jpeg",
    category: "image",
    magic: [[{ offset: 0, bytes: [0xff, 0xd8, 0xff] }]],
  },
  png: {
    label: "PNG",
    ext: ["png"],
    mime: "image/png",
    category: "image",
    magic: [
      [
        {
          offset: 0,
          bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
        },
      ],
    ],
  },
  gif: {
    label: "GIF",
    ext: ["gif"],
    mime: "image/gif",
    category: "image",
    magic: [
      [{ offset: 0, bytes: ascii("GIF87a") }],
      [{ offset: 0, bytes: ascii("GIF89a") }],
    ],
  },
  webp: {
    label: "WebP",
    ext: ["webp"],
    mime: "image/webp",
    category: "image",
    magic: [
      [
        { offset: 0, bytes: ascii("RIFF") },
        { offset: 8, bytes: ascii("WEBP") },
      ],
    ],
  },
  bmp: {
    label: "BMP",
    ext: ["bmp"],
    mime: "image/bmp",
    category: "image",
    magic: [[{ offset: 0, bytes: ascii("BM") }]],
  },
  raw: {
    label: "Camera RAW",
    ext: [
      "cr2",
      "cr3",
      "nef",
      "nrw",
      "arw",
      "srf",
      "sr2",
      "dng",
      "raf",
      "orf",
      "rw2",
      "pef",
      "srw",
      "3fr",
      "iiq",
      "rwl",
      "mrw",
      "x3f",
      "erf",
      "kdc",
      "mos",
      "raw",
    ],
    mime: "image/x-raw",
    category: "image",
    // Only the non-TIFF-based raw formats can be told apart by magic bytes
    // here. CR2, NEF, ARW, DNG, PEF, SRW and others are themselves valid
    // TIFF/EP files — every raw format built on TIFF shares TIFF's own
    // signature byte-for-byte — so they sniff as `tiff` below and are only
    // reclassified to `raw` afterwards, by extension: see `refineFormat`.
    // Declared before `tiff` (and therefore before `heic`, which comes
    // later still) so these unambiguous signatures always win over either.
    magic: [
      [{ offset: 0, bytes: ascii("FUJIFILMCCD-RAW") }], // RAF (Fujifilm)
      [{ offset: 0, bytes: ascii("IIRO") }], // ORF (Olympus), variant 1
      [{ offset: 0, bytes: ascii("IIRS") }], // ORF (Olympus), variant 2
      [{ offset: 0, bytes: ascii("MMOR") }], // ORF (Olympus), variant 3
      [{ offset: 0, bytes: ascii("IIU\0") }], // RW2 (Panasonic)
      [
        { offset: 4, bytes: ascii("ftyp") },
        { offset: 8, bytes: ascii("crx ") },
      ], // CR3 (Canon) — an ISO-BMFF "ftyp" box, like AVIF/HEIC.
    ],
  },
  tiff: {
    label: "TIFF",
    ext: ["tiff", "tif"],
    mime: "image/tiff",
    category: "image",
    magic: [
      [{ offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] }],
      [{ offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a] }],
    ],
  },
  avif: {
    label: "AVIF",
    ext: ["avif"],
    mime: "image/avif",
    category: "image",
    // ISO base media "ftyp" box at offset 4, major brand at offset 8.
    magic: [
      [
        { offset: 4, bytes: ascii("ftyp") },
        { offset: 8, bytes: ascii("avif") },
      ],
      [
        { offset: 4, bytes: ascii("ftyp") },
        { offset: 8, bytes: ascii("avis") },
      ],
    ],
  },
  jxl: {
    label: "JPEG XL",
    ext: ["jxl"],
    mime: "image/jxl",
    category: "image",
    // Two on-disk shapes: a bare codestream (the 0xFF 0x0A marker) or the
    // ISO BMFF "JXL " container signature, both defined by the JPEG XL spec.
    magic: [
      [{ offset: 0, bytes: [0xff, 0x0a] }],
      [
        {
          offset: 0,
          bytes: [
            0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87,
            0x0a,
          ],
        },
      ],
    ],
  },
  heic: {
    label: "HEIC",
    ext: ["heic", "heif"],
    mime: "image/heic",
    category: "image",
    // Same "ftyp" box shape as AVIF, one alternative per known HEIF major
    // brand. An AVIF with the generic major brand "mif1" would sniff as
    // HEIC here — accepted limitation; full ftyp compatible-brand list
    // parsing (rather than just the major brand) is future work.
    magic: ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].map(
      (brand) => [
        { offset: 4, bytes: ascii("ftyp") },
        { offset: 8, bytes: ascii(brand) },
      ],
    ),
  },
  svg: {
    label: "SVG",
    ext: ["svg"],
    mime: "image/svg+xml",
    category: "image",
    // Any XML document sniffs as SVG here — a bare "<svg" root, or an
    // "<?xml" prolog with or without a leading UTF-8 BOM. That's broader
    // than real SVG (an arbitrary XML file matches too), but the resvg
    // decoder itself rejects anything that isn't actually SVG once decoded,
    // so this is a coarse pre-filter, not the final word.
    magic: [
      [{ offset: 0, bytes: ascii("<svg") }],
      [{ offset: 0, bytes: ascii("<?xml") }],
      [
        { offset: 0, bytes: [0xef, 0xbb, 0xbf] },
        { offset: 3, bytes: ascii("<svg") },
      ],
      [
        { offset: 0, bytes: [0xef, 0xbb, 0xbf] },
        { offset: 3, bytes: ascii("<?xml") },
      ],
    ],
  },
  psd: {
    label: "PSD",
    ext: ["psd"],
    mime: "image/vnd.adobe.photoshop",
    category: "image",
    magic: [[{ offset: 0, bytes: ascii("8BPS") }]],
  },
  pdf: {
    label: "PDF",
    ext: ["pdf"],
    mime: "application/pdf",
    category: "pdf",
    magic: [[{ offset: 0, bytes: ascii("%PDF-") }]],
  },
  zip: {
    label: "ZIP",
    ext: ["zip"],
    mime: "application/zip",
    category: "archive",
    magic: [
      [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }],
      [{ offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] }],
    ],
  },
  txt: {
    label: "Text",
    ext: ["txt"],
    mime: "text/plain",
    category: "document",
    // Output-only: plain text has no magic bytes of its own to sniff, so no
    // dropped file can ever be identified as this format. `sniffFormat`'s
    // `.some()` over an empty `magic` array is always `false`, which is
    // exactly the "never matches" behavior an output-only format needs —
    // see the OCR tools (`src/tools/image/image-to-text.ts`) that `produce`
    // this format but never `accept` it.
    magic: [],
  },
} as const satisfies Record<string, FormatSpec>;

export type FormatId = keyof typeof FORMATS;

/** Bytes read from the head of a file to sniff its format. */
export const SNIFF_BYTES = 32;

function matchesPattern(head: Uint8Array, pattern: MagicPattern): boolean {
  if (head.length < pattern.offset + pattern.bytes.length) return false;
  for (let i = 0; i < pattern.bytes.length; i++) {
    if (head[pattern.offset + i] !== pattern.bytes[i]) return false;
  }
  return true;
}

/**
 * Pure. Returns the first `FormatId` (in `FORMATS` declaration order) whose
 * magic bytes match `head`. Order matters — AVIF is checked before HEIC so
 * the `mif1` overlap (see the HEIC comment above) resolves to AVIF when the
 * brand says so. Never throws; a short or empty input just fails to match.
 */
export function sniffFormat(head: Uint8Array): FormatId | null {
  for (const [id, spec] of Object.entries(FORMATS) as [
    FormatId,
    FormatSpec,
  ][]) {
    const matches = spec.magic.some((alternative) =>
      alternative.every((pattern) => matchesPattern(head, pattern)),
    );
    if (matches) return id;
  }
  return null;
}

/** Sniffs a file's format from its first `SNIFF_BYTES` bytes only. */
export async function sniffFile(file: Blob): Promise<FormatId | null> {
  const head = await file.slice(0, SNIFF_BYTES).arrayBuffer();
  return sniffFormat(new Uint8Array(head));
}

/** Lowercase extension with no leading dot, or `null` if `name` has none. */
function extOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot === -1 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Case-insensitive extension lookup. A hint for pre-filling UI before a
 * file's bytes are read — never a substitute for `sniffFormat`/`sniffFile`.
 */
export function formatFromFilename(name: string): FormatId | null {
  const ext = extOf(name);
  if (ext === null) return null;
  for (const [id, spec] of Object.entries(FORMATS) as [
    FormatId,
    FormatSpec,
  ][]) {
    if ((spec.ext as readonly string[]).includes(ext)) return id;
  }
  return null;
}

/**
 * Upgrades a `sniffFormat`/`sniffFile` result from `"tiff"` to `"raw"` when
 * the filename's extension names one of the TIFF-based raw formats (CR2,
 * NEF, ARW, DNG, PEF, SRW, …) — see the `raw` format's magic comment above
 * for why bytes alone can't tell them apart. Called *after* sniffing, never
 * instead of it: every other format is returned unchanged, sniffed or not.
 *
 * This is a best-effort fallback, not a guarantee. A plain TIFF file
 * mislabelled with a raw extension (e.g. renamed to "photo.dng") gets
 * refined to `"raw"` here and is then handed to the libraw decoder, which
 * rejects it with a clear "decode-failed" rather than silently
 * mis-converting it — an accepted, narrow failure mode in exchange for not
 * having to parse TIFF IFD tags just to tell a camera raw from a scan.
 */
export function refineFormat(
  sniffed: FormatId | null,
  filename: string,
): FormatId | null {
  if (sniffed !== "tiff") return sniffed;
  const ext = extOf(filename);
  if (ext === null) return sniffed;
  return (FORMATS.raw.ext as readonly string[]).includes(ext) ? "raw" : sniffed;
}
