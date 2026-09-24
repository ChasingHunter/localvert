import { describe, expect, it, vi } from "vitest";
import {
  FORMATS,
  type FormatId,
  formatFromFilename,
  type MagicPattern,
  SNIFF_BYTES,
  sniffFile,
  sniffFormat,
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
 * One row per magic alternative across every format, so each OR branch —
 * both GIF versions, both TIFF byte orders, both ZIP signatures, every HEIC
 * brand, both AVIF brands — gets its own assertion, not just one per format.
 */
const ALTERNATIVES = (
  Object.entries(FORMATS) as [FormatId, (typeof FORMATS)[FormatId]][]
).flatMap(([id, spec]) =>
  spec.magic.map((alternative, i) => ({
    name: `${id} (alternative ${i})`,
    id,
    alternative,
  })),
);

describe("sniffFormat", () => {
  it.each(ALTERNATIVES)("matches $name", ({ id, alternative }) => {
    expect(sniffFormat(headerFor(alternative))).toBe(id);
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
  it("every format has at least one magic alternative", () => {
    for (const spec of Object.values(FORMATS)) {
      expect(spec.magic.length).toBeGreaterThan(0);
    }
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
