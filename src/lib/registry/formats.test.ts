import { describe, expect, it, vi } from "vitest";
import {
  FORMATS,
  type FormatId,
  type FormatSpec,
  formatFromFilename,
  looksLikeText,
  type MagicPattern,
  refineFormat,
  SNIFF_BYTES,
  sniffFile,
  sniffFormat,
  textFormatFromExtension,
} from "./formats";

/** Builds a header buffer that satisfies every pattern in one alternative. */
function headerFor(patterns: readonly MagicPattern[]): Uint8Array<ArrayBuffer> {
  const size = Math.max(
    SNIFF_BYTES,
    ...patterns.map((p) => p.offset + p.bytes.length),
  );
  const head = new Uint8Array(size);
  for (const pattern of patterns) {
    head.set(pattern.bytes, pattern.offset);
  }
  return head;
}

/**
 * `opus` deliberately shares its only magic alternative with `ogg` (see
 * that format's comment in formats.ts — telling them apart needs bytes
 * this offset+exact-match scheme can't locate) and is refined by extension
 * instead. Its bytes therefore sniff as `ogg`, the earlier-declared format,
 * not itself — this map is the generic test's escape hatch for that one
 * intentional exception, the same shape as `OUTPUT_ONLY` further down.
 */
const RESOLVES_AS: Partial<Record<FormatId, FormatId>> = {
  opus: "ogg",
};

/**
 * One row per magic alternative across every format, so each OR branch —
 * both GIF versions, both TIFF byte orders, both ZIP signatures, every HEIC
 * brand, both AVIF brands — gets its own assertion, not just one per format.
 */
const ALTERNATIVES = (
  Object.entries(FORMATS) as [FormatId, (typeof FORMATS)[FormatId]][]
)
  .flatMap(([id, spec]) =>
    spec.magic.map((alternative, i) => ({
      name: `${id} (alternative ${i})`,
      id,
      alternative,
    })),
  )
  // mkv shares webm's EBML magic byte-for-byte (see mkv's own comment in
  // formats.ts) — sniffFormat always resolves it to "webm" (declared
  // first), by design. The mkv-specific upgrade path is covered by
  // `refineFormat`'s own describe block below instead.
  .filter(({ id }) => id !== "mkv")
  // Same shape as mkv/webm above: xlsx shares zip's magic byte-for-byte
  // (see xlsx's own comment in formats.ts) and always sniffs as "zip"
  // (declared first); its upgrade path is covered by `refineFormat`'s own
  // describe block instead.
  .filter(({ id }) => id !== "xlsx");

describe("sniffFormat", () => {
  it.each(ALTERNATIVES)("matches $name", ({ id, alternative }) => {
    expect(sniffFormat(headerFor(alternative))).toBe(RESOLVES_AS[id] ?? id);
  });

  it("returns null for input shorter than any matching signature", () => {
    // jpg's signature is 3 bytes (FF D8 FF); this supplies only 2.
    expect(sniffFormat(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(sniffFormat(new Uint8Array(0))).toBeNull();
  });

  it("returns null for random bytes matching no signature", () => {
    expect(
      sniffFormat(new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06])),
    ).toBeNull();
  });

  it("never throws on malformed input", () => {
    expect(() => sniffFormat(new Uint8Array(0))).not.toThrow();
    expect(() => sniffFormat(new Uint8Array(1))).not.toThrow();
  });
});

describe("formatFromFilename", () => {
  it("is a hint only — magic bytes win when a file lies about its extension", () => {
    const jpgBytesNamedPng = headerFor(FORMATS.jpg.magic[0]);
    expect(sniffFormat(jpgBytesNamedPng)).toBe("jpg");
    expect(formatFromFilename("photo.png")).toBe("png");
  });

  it("is case-insensitive", () => {
    expect(formatFromFilename("PHOTO.PNG")).toBe("png");
  });

  it("returns null for a name with no extension", () => {
    expect(formatFromFilename("noext")).toBeNull();
  });

  it("returns null for an unknown extension", () => {
    expect(formatFromFilename("file.xyz")).toBeNull();
  });
});

describe("refineFormat", () => {
  it("upgrades a tiff sniff to raw when the filename has a raw extension (CR2-like)", () => {
    // CR2 (and every TIFF-based raw) is byte-for-byte a TIFF file, so this
    // is exactly what sniffFormat itself returns for one.
    expect(sniffFormat(headerFor(FORMATS.tiff.magic[0]))).toBe("tiff");
    expect(refineFormat("tiff", "photo.cr2")).toBe("raw");
  });

  it("leaves a tiff sniff alone for a plain .tif/.tiff name", () => {
    expect(refineFormat("tiff", "scan.tif")).toBe("tiff");
    expect(refineFormat("tiff", "scan.tiff")).toBe("tiff");
  });

  it("leaves a tiff sniff alone for an unrelated or missing extension", () => {
    expect(refineFormat("tiff", "photo.jpg")).toBe("tiff");
    expect(refineFormat("tiff", "noext")).toBe("tiff");
  });

  it("passes a non-tiff sniff through unchanged, e.g. RAF bytes regardless of name", () => {
    const raf = headerFor([FORMATS.raw.magic[0]?.[0] as MagicPattern]);
    expect(sniffFormat(raf)).toBe("raw");
    expect(refineFormat("raw", "whatever.xyz")).toBe("raw");
    expect(refineFormat("png", "photo.cr2")).toBe("png");
  });

  it("passes null through unchanged", () => {
    expect(refineFormat(null, "photo.cr2")).toBeNull();
  });

  it("upgrades a webm sniff to mkv when the filename has a .mkv extension", () => {
    // mkv is byte-for-byte a webm file per this scheme's magic (both share
    // the Matroska family's EBML header), so this is exactly what
    // sniffFormat itself returns for one.
    expect(sniffFormat(headerFor(FORMATS.mkv.magic[0]))).toBe("webm");
    expect(refineFormat("webm", "clip.mkv")).toBe("mkv");
  });

  it("leaves a webm sniff alone for a plain .webm name or an unrelated one", () => {
    expect(refineFormat("webm", "clip.webm")).toBe("webm");
    expect(refineFormat("webm", "clip.mp4")).toBe("webm");
    expect(refineFormat("webm", "noext")).toBe("webm");
  });

  it("upgrades an ogg sniff to opus for a .opus filename", () => {
    expect(sniffFormat(headerFor(FORMATS.ogg.magic[0]))).toBe("ogg");
    expect(refineFormat("ogg", "clip.opus")).toBe("opus");
  });

  it("leaves an ogg sniff alone for a plain .ogg/.oga name", () => {
    expect(refineFormat("ogg", "clip.ogg")).toBe("ogg");
    expect(refineFormat("ogg", "clip.oga")).toBe("ogg");
  });

  it("upgrades a zip sniff to xlsx for an .xlsx filename", () => {
    // xlsx is byte-for-byte a zip file per this scheme's magic (OOXML is a
    // ZIP container), so this is exactly what sniffFormat itself returns.
    expect(sniffFormat(headerFor(FORMATS.xlsx.magic[0]))).toBe("zip");
    expect(refineFormat("zip", "book.xlsx")).toBe("xlsx");
  });

  it("leaves a zip sniff alone for a plain .zip name or an unrelated one", () => {
    expect(refineFormat("zip", "archive.zip")).toBe("zip");
    expect(refineFormat("zip", "archive.docx")).toBe("zip");
    expect(refineFormat("zip", "noext")).toBe("zip");
  });
});

describe("sniffFile", () => {
  it("sniffs a Blob built from raw bytes", async () => {
    const bytes = headerFor(FORMATS.png.magic[0]);
    await expect(sniffFile(new Blob([bytes]))).resolves.toBe("png");
  });

  it("reads no more than SNIFF_BYTES, even from a large blob", async () => {
    const bytes = new Uint8Array(1024 * 1024);
    bytes.set(headerFor(FORMATS.jpg.magic[0]), 0);
    const blob = new Blob([bytes]);
    const sliceSpy = vi.spyOn(blob, "slice");

    await expect(sniffFile(blob)).resolves.toBe("jpg");
    expect(sliceSpy).toHaveBeenCalledWith(0, SNIFF_BYTES);
  });
});

describe("FORMATS table shape", () => {
  /**
   * Formats with no magic bytes of their own — never sniffable, so a tool
   * may only ever `produce` one, never `accept` it. Exactly `txt` today
   * (OCR's plain-text output); a new output-only format joins this list on
   * purpose rather than silently exempting itself.
   */
  const OUTPUT_ONLY: readonly FormatId[] = ["txt"];

  it("every accepted format has a magic alternative or is a text format", () => {
    for (const [id, spec] of Object.entries(FORMATS) as [
      FormatId,
      FormatSpec,
    ][]) {
      if (OUTPUT_ONLY.includes(id)) continue;
      expect(spec.magic.length > 0 || spec.text === true).toBe(true);
    }
  });

  it("a text format declares no magic and at least one extension", () => {
    for (const spec of Object.values(FORMATS) as FormatSpec[]) {
      if (!spec.text) continue;
      expect(spec.magic.length).toBe(0);
      expect(spec.ext.length).toBeGreaterThan(0);
    }
  });

  it("an output-only format has no magic bytes and never sniffs", () => {
    for (const id of OUTPUT_ONLY) {
      expect(FORMATS[id].magic.length).toBe(0);
    }
    // A file full of the "txt" format's own bytes still can't sniff as
    // "txt" — there's nothing to match, by construction.
    expect(sniffFormat(new TextEncoder().encode("plain text file"))).toBeNull();
  });

  it("every extension is lowercase with no leading dot", () => {
    for (const spec of Object.values(FORMATS)) {
      for (const ext of spec.ext) {
        expect(ext).toBe(ext.toLowerCase());
        expect(ext.startsWith(".")).toBe(false);
      }
    }
  });

  it("extensions are unique across formats", () => {
    const seen = new Set<string>();
    for (const spec of Object.values(FORMATS)) {
      for (const ext of spec.ext) {
        expect(seen.has(ext)).toBe(false);
        seen.add(ext);
      }
    }
  });
});

describe("textFormatFromExtension", () => {
  it("maps a text format's extension to its FormatId", () => {
    expect(textFormatFromExtension("data.csv")).toBe("csv");
    expect(textFormatFromExtension("data.json")).toBe("json");
    expect(textFormatFromExtension("data.yaml")).toBe("yaml");
    expect(textFormatFromExtension("data.yml")).toBe("yaml");
  });

  it("returns null for a non-text format's extension", () => {
    expect(textFormatFromExtension("photo.png")).toBeNull();
  });

  it("returns null for an unknown or missing extension", () => {
    expect(textFormatFromExtension("noext")).toBeNull();
    expect(textFormatFromExtension("file.xyz")).toBeNull();
  });
});

describe("looksLikeText", () => {
  it("is true for real text with no NUL byte", () => {
    expect(looksLikeText(new TextEncoder().encode("a,b,c\n1,2,3\n"))).toBe(
      true,
    );
  });

  it("is true for text opening with a UTF-8 BOM or leading whitespace", () => {
    const bom = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode('{"a":1}'),
    ]);
    expect(looksLikeText(bom)).toBe(true);
    expect(looksLikeText(new TextEncoder().encode("   \n{}"))).toBe(true);
  });

  it("is true for YAML with no '---' document marker", () => {
    expect(looksLikeText(new TextEncoder().encode("a: 1\nb: 2\n"))).toBe(true);
  });

  it("is false when a NUL byte is present anywhere in the head", () => {
    expect(looksLikeText(new Uint8Array([0x61, 0x00, 0x62]))).toBe(false);
  });

  it("is true for an empty buffer", () => {
    expect(looksLikeText(new Uint8Array(0))).toBe(true);
  });
});
