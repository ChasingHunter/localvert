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
  /**
   * Plain text with no fixed byte signature of its own (csv, json, yaml —
   * unlike an image/video/archive container, there is nothing at a fixed
   * offset that reliably proves the format rather than just describing a
   * loose grammar). `magic` is always `[]` for one of these. Identified by
   * extension instead, gated on the file containing no NUL byte in its
   * first `TEXT_SNIFF_BYTES` — see `textFormatFromExtension`/`looksLikeText`
   * and `classifyFiles`' fallback path. A `text` format must declare at
   * least one `ext` (enforced in formats.test.ts) or the fallback could
   * never find it.
   */
  text?: boolean;
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
  ico: {
    label: "ICO",
    // "image/x-icon" is the mime this format is served/sniffed under.
    // "image/vnd.microsoft.icon" is a real IANA-registered alternative some
    // encoders use, but `FormatSpec.mime` only carries one value, and
    // neither sniffing nor encoding here reads it for anything but the
    // outgoing Blob's `type` — which one is "canonical" doesn't affect
    // behavior.
    ext: ["ico"],
    mime: "image/x-icon",
    category: "image",
    // ICONDIR header: reserved (2 bytes, always 0) + type (2 bytes, 1 = icon).
    magic: [[{ offset: 0, bytes: [0x00, 0x00, 0x01, 0x00] }]],
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
  mp4: {
    label: "MP4",
    ext: ["mp4", "m4v"],
    mime: "video/mp4",
    category: "video",
    // ISO-BMFF "ftyp" box, same shape as avif/heic above — one alternative
    // per common MP4 major brand. Brands vary by encoder (isom/mp42 are the
    // usual ones; M4V and avc1 show up from some cameras/exporters); an
    // unlisted brand is an accepted gap, same as heic's own note above.
    magic: ["isom", "iso2", "mp41", "mp42", "M4V ", "avc1"].map((brand) => [
      { offset: 4, bytes: ascii("ftyp") },
      { offset: 8, bytes: ascii(brand) },
    ]),
  },
  mov: {
    label: "QuickTime",
    ext: ["mov"],
    mime: "video/quicktime",
    category: "video",
    // Same ISO-BMFF "ftyp" box, major brand "qt  " (note the trailing
    // spaces — QuickTime's own brand code, padded to 4 bytes).
    magic: [
      [
        { offset: 4, bytes: ascii("ftyp") },
        { offset: 8, bytes: ascii("qt  ") },
      ],
    ],
  },
  webm: {
    label: "WebM",
    ext: ["webm"],
    mime: "video/webm",
    category: "video",
    // The EBML header signature webm shares with every Matroska-family
    // container. Telling webm apart from a plain .mkv needs the EBML
    // `DocType` element a few bytes in, which this offset+bytes-only magic
    // scheme can't express — accepted gap, same shape as raw/tiff above:
    // an .mkv dropped here sniffs as "webm" and is refined by extension
    // where it matters, or simply isn't a format any tool accepts yet.
    magic: [[{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }]],
  },
  mkv: {
    label: "Matroska",
    ext: ["mkv"],
    mime: "video/x-matroska",
    category: "video",
    // Same EBML header as webm above — Matroska and WebM are the same
    // container family and share this exact byte signature; only the EBML
    // `DocType` element a few bytes in tells them apart, which this
    // offset+bytes-only magic scheme can't express (same accepted gap noted
    // on `webm`). A dropped .mkv sniffs as "webm" today; tools that need to
    // tell them apart do so by extension, not by magic.
    magic: [[{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }]],
  },
  avi: {
    label: "AVI",
    ext: ["avi"],
    mime: "video/x-msvideo",
    category: "video",
    // RIFF container, "AVI " form type at offset 8 — same shape as wav's
    // RIFF/WAVE check above.
    magic: [
      [
        { offset: 0, bytes: ascii("RIFF") },
        { offset: 8, bytes: ascii("AVI ") },
      ],
    ],
  },
  wmv: {
    label: "WMV",
    ext: ["wmv"],
    mime: "video/x-ms-wmv",
    category: "video",
    // ASF header GUID (Microsoft's Advanced Systems Format container, which
    // WMV/WMA are both built on) — a fixed 16-byte GUID at offset 0, the
    // same signature for every ASF file. wmv is declared first, so
    // `sniffFormat` resolves any ASF file to "wmv"; a real .wma file is
    // upgraded from there by extension — see `wma` below and its own
    // `refineFormat` branch (same extension-assisted pattern as
    // webm/mkv and ogg/opus elsewhere in this table).
    magic: [
      [
        {
          offset: 0,
          bytes: [
            0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00,
            0xaa, 0x00, 0x62, 0xce, 0x6c,
          ],
        },
      ],
    ],
  },
  flv: {
    label: "FLV",
    ext: ["flv"],
    mime: "video/x-flv",
    category: "video",
    magic: [[{ offset: 0, bytes: ascii("FLV") }]],
  },
  mp3: {
    label: "MP3",
    ext: ["mp3"],
    mime: "audio/mpeg",
    category: "audio",
    // An ID3v2 tag (most encoders write one) or a bare MPEG frame header —
    // the frame sync is 11 set bits (0xFF + top 3 bits of the next byte),
    // which this offset+exact-bytes scheme can't express as a mask, so each
    // alternative below pins one common MPEG-1 Layer III sync byte pair
    // instead (0xFF 0xFB/0xF3/0xF2/0xFA/0xE3/0xE2 cover the sync + version/
    // layer/protection combinations real encoders actually emit). An
    // untagged file using a byte pair not listed here is an accepted gap,
    // same shape as the raw/tiff/webm notes above.
    magic: [
      [{ offset: 0, bytes: ascii("ID3") }],
      [{ offset: 0, bytes: [0xff, 0xfb] }],
      [{ offset: 0, bytes: [0xff, 0xf3] }],
      [{ offset: 0, bytes: [0xff, 0xf2] }],
      [{ offset: 0, bytes: [0xff, 0xfa] }],
      [{ offset: 0, bytes: [0xff, 0xe3] }],
      [{ offset: 0, bytes: [0xff, 0xe2] }],
    ],
  },
  wav: {
    label: "WAV",
    ext: ["wav"],
    mime: "audio/wav",
    category: "audio",
    // RIFF container, "WAVE" form type at offset 8 — same shape as webp's
    // RIFF/WEBP check above.
    magic: [
      [
        { offset: 0, bytes: ascii("RIFF") },
        { offset: 8, bytes: ascii("WAVE") },
      ],
    ],
  },
  flac: {
    label: "FLAC",
    ext: ["flac"],
    mime: "audio/flac",
    category: "audio",
    magic: [[{ offset: 0, bytes: ascii("fLaC") }]],
  },
  ogg: {
    label: "Ogg Vorbis",
    ext: ["ogg", "oga"],
    mime: "audio/ogg",
    category: "audio",
    // The "OggS" page header is shared by every codec Ogg can carry
    // (Vorbis, Opus, …) — telling them apart needs the codec identifier a
    // variable number of bytes into the first page's payload, which this
    // offset+exact-bytes scheme can't locate reliably. A dropped `.opus`
    // file therefore also sniffs as `ogg` here; `refineFormat` below
    // upgrades it to `opus` by extension, the same pattern as raw/tiff.
    magic: [[{ offset: 0, bytes: ascii("OggS") }]],
  },
  opus: {
    label: "Opus",
    ext: ["opus"],
    mime: "audio/opus",
    category: "audio",
    // Same "OggS" container signature as `ogg` above — see that format's
    // comment. Declared after `ogg` so a real Opus file's raw sniff always
    // resolves to `ogg` first; `refineFormat` is what actually promotes it
    // to `opus` for a file named `*.opus`.
    magic: [[{ offset: 0, bytes: ascii("OggS") }]],
  },
  m4a: {
    label: "M4A",
    ext: ["m4a"],
    mime: "audio/mp4",
    category: "audio",
    // ISO-BMFF "ftyp" box, same shape as mp4/mov above, major brand "M4A "
    // (Apple's own tag for an audio-only MP4 container). mediabunny's
    // `Mp4OutputFormat` never writes it on its own, so the audio engine
    // stamps it on every m4a it produces (`patchFtypMajorBrand` in
    // src/lib/engines/mediabunny/output.ts). An m4a from elsewhere with a
    // generic "isom"/"mp42" brand sniffs as `mp4`; `refineFormat` promotes
    // it back to m4a by its .m4a extension.
    magic: [
      [
        { offset: 4, bytes: ascii("ftyp") },
        { offset: 8, bytes: ascii("M4A ") },
      ],
    ],
  },
  aac: {
    label: "AAC",
    ext: ["aac"],
    mime: "audio/aac",
    category: "audio",
    // Raw ADTS bitstream: 12-bit sync word 0xFFF, then MPEG version/layer/
    // protection-absence bits. 0xFF 0xF1 (MPEG-4, no CRC) and 0xFF 0xF9
    // (MPEG-2, no CRC) are the pair real encoders emit; other protection/
    // version combinations are an accepted gap, same shape as mp3 above.
    magic: [
      [{ offset: 0, bytes: [0xff, 0xf1] }],
      [{ offset: 0, bytes: [0xff, 0xf9] }],
    ],
  },
  wma: {
    label: "WMA",
    ext: ["wma"],
    mime: "audio/x-ms-wma",
    category: "audio",
    // Same ASF header GUID as `wmv` above — WMA and WMV are both built on
    // Microsoft's Advanced Systems Format container and share this exact
    // 16-byte signature. Declared after `wmv` so a real ASF file's raw sniff
    // always resolves to `wmv` first; `refineFormat` is what actually
    // promotes it to `wma` for a file named `*.wma` (and, symmetrically,
    // leaves an ASF file named `*.wmv` — or with an unrecognized extension —
    // as `wmv`, today's existing behavior).
    magic: [
      [
        {
          offset: 0,
          bytes: [
            0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00,
            0xaa, 0x00, 0x62, 0xce, 0x6c,
          ],
        },
      ],
    ],
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
    // Plain text has no magic bytes of its own — same reasoning as
    // csv/json/yaml above — so this is a `text` format, identified by
    // extension via `classifyFiles`' fallback. Historically output-only (the
    // OCR tools, `src/tools/image/image-to-text.ts`, `produce` this format);
    // `txt-to-pdf` (ADR-0012's LibreOffice addendum) is the first tool that
    // also `accepts` it, which is what makes the extension fallback matter
    // here rather than just documenting a shape nothing reads.
    magic: [],
    text: true,
  },
  json: {
    label: "JSON",
    ext: ["json"],
    mime: "application/json",
    category: "data",
    // A JSON document has no fixed container signature — it's whatever text
    // its own grammar allows (a leading BOM, whitespace, or a bare scalar
    // are all legal and would defeat any fixed-offset byte check) — so this
    // is a `text` format, identified by extension, not magic. See `text`'s
    // doc comment on `FormatSpec` and `classifyFiles`' extension fallback.
    magic: [],
    text: true,
  },
  yaml: {
    label: "YAML",
    ext: ["yaml", "yml"],
    mime: "application/yaml",
    category: "data",
    // Same reasoning as JSON above: no container signature of its own (the
    // "---" document-start marker some files open with is common but far
    // from universal), so this is a `text` format too.
    magic: [],
    text: true,
  },
  csv: {
    label: "CSV",
    ext: ["csv"],
    mime: "text/csv",
    category: "data",
    // Arbitrary delimited text — no signature at all, not even a loose one
    // like JSON's `{`/`[` opener. `text` format, identified by extension.
    magic: [],
    text: true,
  },
  md: {
    label: "Markdown",
    ext: ["md", "markdown"],
    mime: "text/markdown",
    category: "document",
    // Plain text, same reasoning as csv/json/yaml above: no container
    // signature of its own, identified by extension.
    magic: [],
    text: true,
  },
  html: {
    label: "HTML",
    ext: ["html", "htm"],
    mime: "text/html",
    category: "document",
    // Same reasoning as md above: no fixed container signature (a real
    // browser accepts HTML missing its "<!doctype" / "<html" opener
    // entirely), so this is a `text` format, identified by extension.
    // `svg`'s own magic (above) matches a bare "<?xml" prolog too, but svg
    // is declared first, so an actual .html file starting with one would
    // never reach here anyway — moot, since this format never sniffs by
    // magic at all.
    magic: [],
    text: true,
  },
  epub: {
    label: "EPUB",
    ext: ["epub"],
    mime: "application/epub+zip",
    category: "document",
    // EPUB is a ZIP container (the OCF/"EPUB as zip" packaging spec) — same
    // signature as xlsx/docx/etc above. `sniffFormat` resolves a real .epub
    // to `zip` first (`zip` is declared earlier); `refineFormat` promotes it
    // by extension, same pattern as the other zip-based office formats.
    magic: [
      [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }],
      [{ offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] }],
    ],
  },
  xlsx: {
    label: "Excel Workbook",
    ext: ["xlsx"],
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    category: "data",
    // XLSX is a ZIP container (same signature as `zip` above, and as every
    // other zip-based Office/OOXML format) — `sniffFormat` resolves a real
    // .xlsx to `zip` first since `zip` is declared earlier in this table;
    // `refineFormat` promotes it to `xlsx` by extension, the same pattern
    // used for mkv/webm and opus/ogg above.
    magic: [
      [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }],
      [{ offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] }],
    ],
  },
  docx: {
    label: "Word Document",
    ext: ["docx"],
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    category: "document",
    // Same ZIP-container signature as xlsx above — every OOXML format
    // shares it. `sniffFormat` resolves a real .docx to `zip` first (`zip`
    // is declared earlier); `refineFormat` promotes it by extension.
    magic: [
      [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }],
      [{ offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] }],
    ],
  },
  pptx: {
    label: "PowerPoint Presentation",
    ext: ["pptx"],
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    category: "document",
    // Same ZIP-container signature — see docx above.
    magic: [
      [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }],
      [{ offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] }],
    ],
  },
  odt: {
    label: "OpenDocument Text",
    ext: ["odt"],
    mime: "application/vnd.oasis.opendocument.text",
    category: "document",
    // ODF documents are ZIP containers too — same signature, same
    // extension-refine pattern as the OOXML formats above.
    magic: [
      [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }],
      [{ offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] }],
    ],
  },
  ods: {
    label: "OpenDocument Spreadsheet",
    ext: ["ods"],
    mime: "application/vnd.oasis.opendocument.spreadsheet",
    category: "document",
    magic: [
      [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }],
      [{ offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] }],
    ],
  },
  odp: {
    label: "OpenDocument Presentation",
    ext: ["odp"],
    mime: "application/vnd.oasis.opendocument.presentation",
    category: "document",
    magic: [
      [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }],
      [{ offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] }],
    ],
  },
  doc: {
    label: "Word 97-2003 Document",
    ext: ["doc"],
    mime: "application/msword",
    category: "document",
    // Legacy Office formats (doc/xls/ppt) are all OLE Compound File Binary
    // containers — the same fixed CFB signature for every one of them; the
    // stream inside names the real format, which this offset+bytes-only
    // scheme can't read. `sniffFormat` resolves a real .doc/.xls/.ppt to
    // `doc` first (declared earliest of the three); `refineFormat` promotes
    // it by extension, same pattern as the ZIP-based formats above.
    magic: [
      [
        {
          offset: 0,
          bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
        },
      ],
    ],
  },
  xls: {
    label: "Excel 97-2003 Workbook",
    ext: ["xls"],
    mime: "application/vnd.ms-excel",
    category: "document",
    // Same CFB signature as doc above — see that format's comment.
    magic: [
      [
        {
          offset: 0,
          bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
        },
      ],
    ],
  },
  ppt: {
    label: "PowerPoint 97-2003 Presentation",
    ext: ["ppt"],
    mime: "application/vnd.ms-powerpoint",
    category: "document",
    // Same CFB signature as doc above — see that format's comment.
    magic: [
      [
        {
          offset: 0,
          bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
        },
      ],
    ],
  },
  rtf: {
    label: "Rich Text Format",
    ext: ["rtf"],
    mime: "application/rtf",
    category: "document",
    // RTF's own control-word header, unambiguous among this table's other
    // formats.
    magic: [[{ offset: 0, bytes: ascii("{\\rtf") }]],
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
 * Extension-only fallback for `text` formats (see `FormatSpec.text`'s doc
 * comment): a real csv/json/yaml file has no fixed byte signature, so
 * `sniffFormat` returns `null` for one and `classifyFiles` falls back to
 * this before giving up. Returns `null` unless the extension names a
 * `FORMATS` entry with `text: true` — a binary file named `photo.json`
 * still isn't treated as one just because of its name; see `looksLikeText`
 * for the other half of that guard.
 */
export function textFormatFromExtension(name: string): FormatId | null {
  const id = formatFromFilename(name);
  return id !== null && (FORMATS[id] as FormatSpec).text === true ? id : null;
}

/** Bytes read from the head of a file when guarding the `text`-format
 * extension fallback above — larger than `SNIFF_BYTES` because a NUL byte
 * (this check's whole signal) can sit anywhere in a binary file's opening
 * run of otherwise plausible-looking bytes, not just its first 32.
 */
export const TEXT_SNIFF_BYTES = 4096;

/**
 * True if `head` contains no NUL byte. A coarse but effective binary/text
 * discriminator: no real text file, in any encoding this project's tools
 * read (UTF-8, UTF-8 with BOM, ASCII), ever embeds one, while binary junk
 * renamed to `.csv`/`.json`/`.yaml` almost always does within its first few
 * KiB. Pure, so it's directly unit-testable without a real file read.
 */
export function looksLikeText(head: Uint8Array): boolean {
  return !head.includes(0);
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
  const ext = extOf(filename);
  if (ext === null) return sniffed;
  if (sniffed === "tiff") {
    return (FORMATS.raw.ext as readonly string[]).includes(ext)
      ? "raw"
      : sniffed;
  }
  // webm and mkv share the EBML header byte-for-byte, so `sniffFormat`
  // resolves to "webm" (declared first); an .mkv extension upgrades it.
  if (sniffed === "webm") {
    return (FORMATS.mkv.ext as readonly string[]).includes(ext)
      ? "mkv"
      : sniffed;
  }
  // See the `wmv`/`wma` format comments above: both share the ASF header
  // GUID, so a real .wma file always sniffs as `wmv` first.
  if (sniffed === "wmv") {
    return (FORMATS.wma.ext as readonly string[]).includes(ext)
      ? "wma"
      : sniffed;
  }
  // See the `m4a` format comment above: an m4a written with a generic
  // "isom"/"mp42" major brand (common outside Apple's own tools) sniffs as
  // `mp4`; a .m4a extension promotes it.
  if (sniffed === "mp4") {
    return (FORMATS.m4a.ext as readonly string[]).includes(ext)
      ? "m4a"
      : sniffed;
  }
  // See the `ogg`/`opus` format comments above: both share the "OggS"
  // signature, so a real .opus file always sniffs as `ogg` first.
  if (sniffed === "ogg") {
    return (FORMATS.opus.ext as readonly string[]).includes(ext)
      ? "opus"
      : sniffed;
  }
  // See the `xlsx` format comment above: it's a ZIP container, so a real
  // .xlsx file always sniffs as `zip` first. Every other OOXML/ODF office
  // format shares the same signature — promote by extension the same way.
  if (sniffed === "zip") {
    const zipFormats = [
      "xlsx",
      "docx",
      "pptx",
      "odt",
      "ods",
      "odp",
      "epub",
    ] as const;
    for (const id of zipFormats) {
      if ((FORMATS[id].ext as readonly string[]).includes(ext)) return id;
    }
    return sniffed;
  }
  // See the `doc` format comment above: doc/xls/ppt share the same OLE CFB
  // signature, so a real .xls/.ppt file always sniffs as `doc` first.
  if (sniffed === "doc") {
    if ((FORMATS.xls.ext as readonly string[]).includes(ext)) return "xls";
    if ((FORMATS.ppt.ext as readonly string[]).includes(ext)) return "ppt";
    return sniffed;
  }
  return sniffed;
}
