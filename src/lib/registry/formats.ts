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

/**
 * Case-insensitive extension lookup. A hint for pre-filling UI before a
 * file's bytes are read — never a substitute for `sniffFormat`/`sniffFile`.
 */
export function formatFromFilename(name: string): FormatId | null {
  const dot = name.lastIndexOf(".");
  if (dot === -1 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  for (const [id, spec] of Object.entries(FORMATS) as [
    FormatId,
    FormatSpec,
  ][]) {
    if ((spec.ext as readonly string[]).includes(ext)) return id;
  }
  return null;
}
