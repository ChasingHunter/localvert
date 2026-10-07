import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from "@cantoo/pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { isEngineError } from "../errors";
import adapter from "./adapter";
import { buildCorpus, type CorpusEntry } from "./compress-corpus.testutil";

/**
 * ADR-0017 addendum (2026-10-07): the synthetic corpus (see
 * `compress-corpus.testutil.ts`) run through every fixed mode. Sizes are
 * asserted as ratios, not bytes, since the JPEG encoder differs a little
 * between browsers.
 */

type Mode = "lossless" | "recommended" | "strong";
const MODES: Mode[] = ["lossless", "recommended", "strong"];

interface ImageInfo {
  filter: string;
  colorSpace: string;
  width: number;
  height: number;
  size: number;
  /** SOF component count, for JPEGs. */
  jpegComponents?: number;
}

async function compress(bytes: ArrayBuffer, mode: Mode): Promise<ArrayBuffer> {
  const instance = await adapter.load({
    baseUrl: "",
    capabilities: {} as never,
  });
  const result = await instance.run({
    op: "compress",
    input: { kind: "bytes", bytes: bytes.slice(0) },
    inputFormat: "pdf",
    outputFormat: "pdf",
    options: { mode },
    signal: new AbortController().signal,
  });
  if (result.kind !== "bytes") throw new Error("expected bytes");
  return result.bytes;
}

function sofComponents(jpeg: Uint8Array): number | undefined {
  for (let i = 2; i + 9 < jpeg.length; ) {
    if (jpeg[i] !== 0xff) return undefined;
    const marker = jpeg[i + 1] ?? 0;
    if (marker >= 0xc0 && marker <= 0xc2) return jpeg[i + 9];
    i += 2 + (((jpeg[i + 2] ?? 0) << 8) | (jpeg[i + 3] ?? 0));
  }
  return undefined;
}

async function images(bytes: ArrayBuffer): Promise<ImageInfo[]> {
  const doc = await PDFDocument.load(bytes);
  const out: ImageInfo[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.lookup(PDFName.of("Subtype"));
    if (!(subtype instanceof PDFName) || subtype.asString() !== "/Image") {
      continue;
    }
    const text = (key: string): string =>
      String(obj.dict.lookup(PDFName.of(key)));
    const num = (key: string): number => {
      const v = obj.dict.lookup(PDFName.of(key));
      return v instanceof PDFNumber ? v.asNumber() : 0;
    };
    const filter = obj.dict.lookup(PDFName.of("Filter"));
    const filterName =
      filter instanceof PDFName ? filter.asString() : text("Filter");
    out.push({
      filter: filterName,
      colorSpace: text("ColorSpace"),
      width: num("Width"),
      height: num("Height"),
      size: obj.getContentsSize(),
      ...(filterName === "/DCTDecode"
        ? { jpegComponents: sofComponents(obj.getContents()) }
        : {}),
    });
  }
  return out;
}

/** Mean RGB of a small square around (fx, fy) (fractions of the image) of
 * the first JPEG image in `pdf`. */
async function jpegPixel(
  pdf: ArrayBuffer,
  fx: number,
  fy: number,
): Promise<[number, number, number]> {
  const doc = await PDFDocument.load(pdf);
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const filter = obj.dict.lookup(PDFName.of("Filter"));
    if (!(filter instanceof PDFName) || filter.asString() !== "/DCTDecode") {
      continue;
    }
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(obj.getContents())], { type: "image/jpeg" }),
    );
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0);
    const half = 4;
    const x = Math.round(bitmap.width * fx) - half;
    const y = Math.round(bitmap.height * fy) - half;
    const { data } = ctx.getImageData(x, y, half * 2, half * 2);
    const sum = [0, 0, 0];
    const n = data.length / 4;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++)
        sum[c] = (sum[c] ?? 0) + (data[i * 4 + c] ?? 0);
    }
    return [(sum[0] ?? 0) / n, (sum[1] ?? 0) / n, (sum[2] ?? 0) / n];
  }
  throw new Error("no JPEG image in output");
}

let corpus: CorpusEntry[] = [];
const results = new Map<string, ArrayBuffer>();

const key = (name: string, mode: Mode): string => `${name}/${mode}`;

function sizeOf(name: string, mode: Mode): number {
  return results.get(key(name, mode))?.byteLength ?? Number.NaN;
}

function result(name: string, mode: Mode): ArrayBuffer {
  const out = results.get(key(name, mode));
  if (!out) throw new Error(`no result for ${name}/${mode}`);
  return out;
}

function original(name: string): CorpusEntry {
  const entry = corpus.find((e) => e.name === name);
  if (!entry) throw new Error(`no corpus entry ${name}`);
  return entry;
}

describe("compress-pdf corpus", () => {
  beforeAll(async () => {
    corpus = await buildCorpus();
    for (const entry of corpus) {
      for (const mode of MODES) {
        results.set(key(entry.name, mode), await compress(entry.bytes, mode));
      }
    }
  }, 600000);

  it("never throws, never grows, and always writes a loadable PDF", async () => {
    for (const entry of corpus) {
      const before = await PDFDocument.load(entry.bytes);
      for (const mode of MODES) {
        const out = result(entry.name, mode);
        expect(out.byteLength, `${entry.name} ${mode}`).toBeLessThanOrEqual(
          entry.bytes.byteLength,
        );
        const after = await PDFDocument.load(out);
        expect(after.getPageCount()).toBe(before.getPageCount());
      }
    }
  });

  it("recommended shrinks scans, ICC and filter-array images, shared images", () => {
    for (const name of [
      "scan-rgb",
      "scan-gray",
      "jpeg-icc",
      "flate-icc",
      "shared-image",
    ]) {
      const ratio =
        sizeOf(name, "recommended") / original(name).bytes.byteLength;
      expect(ratio, name).toBeLessThan(0.3);
    }
  });

  it("lossless never touches pixels", () => {
    for (const name of ["scan-rgb", "jpeg-icc", "flate-icc"]) {
      const ratio = sizeOf(name, "lossless") / original(name).bytes.byteLength;
      expect(ratio, name).toBeGreaterThan(0.9);
    }
  });

  it("strong is no bigger than recommended", () => {
    for (const entry of corpus) {
      expect(sizeOf(entry.name, "strong"), entry.name).toBeLessThanOrEqual(
        sizeOf(entry.name, "recommended") * 1.02,
      );
    }
  });

  it("downsamples images inside nested forms by their true drawn size", async () => {
    // Drawn 300x200 pt from 1800x1200 px: 432 dpi, so 150 dpi is 625x417.
    // On the 900x600 pt page the page-size fallback would see ~144 dpi and
    // leave the pixels alone.
    const [img] = await images(result("forms-nested", "recommended"));
    expect(img?.filter).toBe("/DCTDecode");
    expect(img?.width).toBeLessThanOrEqual(650);
    const ratio =
      sizeOf("forms-nested", "recommended") /
      original("forms-nested").bytes.byteLength;
    expect(ratio).toBeLessThan(0.2);
  });

  it("downsamples images painted by annotation appearance streams", async () => {
    // Drawn 300x200 pt (the Rect) from 1500x1000 px.
    const [img] = await images(result("annotation", "recommended"));
    expect(img?.width).toBeLessThanOrEqual(650);
  });

  it("terminates on forms that reference each other", () => {
    expect(sizeOf("forms-cycle", "recommended")).toBeLessThan(
      original("forms-cycle").bytes.byteLength * 0.3,
    );
  });

  it("writes one JPEG for an image shared by many pages", async () => {
    const out = result("shared-image", "recommended");
    const imgs = await images(out);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.filter).toBe("/DCTDecode");
    expect((await PDFDocument.load(out)).getPageCount()).toBe(12);
  });

  it("keeps gray images gray, and an ICC colour space as written", async () => {
    const gray = await images(result("scan-gray", "recommended"));
    expect(gray[0]?.filter).toBe("/DCTDecode");
    expect(gray[0]?.colorSpace).toBe("/DeviceGray");
    expect(gray[0]?.jpegComponents).toBe(1);

    const icc = await images(result("jpeg-icc", "recommended"));
    expect(icc[0]?.colorSpace).toContain("ICCBased");
    expect(icc[0]?.jpegComponents).toBe(3);
  });

  it("re-encodes the colour data of an SMask image but leaves the mask alone", async () => {
    const before = await images(original("smask").bytes);
    const after = await images(result("smask", "recommended"));
    const maskBefore = before.find((i) => i.colorSpace === "/DeviceGray");
    const maskAfter = after.find((i) => i.colorSpace === "/DeviceGray");
    expect(maskAfter).toEqual(maskBefore);
    const color = after.find((i) => i.colorSpace === "/DeviceRGB");
    expect(color?.filter).toBe("/DCTDecode");
  });

  it("leaves unsupported codecs and small palette images exactly as they were", async () => {
    for (const name of ["indexed-small", "unsupported-codecs"]) {
      const before = await images(original(name).bytes);
      const after = await images(result(name, "recommended"));
      expect(after, name).toEqual(before);
    }
  });

  it("converts CMYK to RGB with the colours the right way round", async () => {
    // Left half is pure cyan ink (RGB about 0,255,255), right half pure
    // magenta (255,0,255). An inverted conversion would swap these to
    // red/green.
    for (const name of ["cmyk-patches", "cmyk-adobe-jpeg"]) {
      const out = result(name, "recommended");
      const [img] = await images(out);
      expect(img?.filter, name).toBe("/DCTDecode");
      expect(img?.colorSpace, name).toBe("/DeviceRGB");
      expect(img?.jpegComponents, name).toBe(3);
      const [lr, lg, lb] = await jpegPixel(out, 0.25, 0.5);
      expect(lr, `${name} cyan R`).toBeLessThan(70);
      expect(lg, `${name} cyan G`).toBeGreaterThan(185);
      expect(lb, `${name} cyan B`).toBeGreaterThan(185);
      const [rr, rg, rb] = await jpegPixel(out, 0.75, 0.5);
      expect(rr, `${name} magenta R`).toBeGreaterThan(185);
      expect(rg, `${name} magenta G`).toBeLessThan(70);
      expect(rb, `${name} magenta B`).toBeGreaterThan(185);
      expect(
        sizeOf(name, "recommended") / original(name).bytes.byteLength,
        name,
      ).toBeLessThan(0.7);
    }
  });

  it("converts large CMYK and Indexed images, keeping their savings", async () => {
    for (const name of ["cmyk", "indexed", "indexed-4bit"]) {
      const [img] = await images(result(name, "recommended"));
      expect(img?.filter, name).toBe("/DCTDecode");
      expect(img?.colorSpace, name).toBe("/DeviceRGB");
      expect(
        sizeOf(name, "recommended") / original(name).bytes.byteLength,
        name,
      ).toBeLessThan(0.5);
    }
  });

  it("survives indirect, missing and unusual image dictionary entries", async () => {
    // The one well-formed image (sizes, colour space and filter behind
    // references) is still re-encoded; the 16-bit, Pattern, Separation,
    // size-less, Decode-array and truncated ones are skipped, not fatal.
    const after = await images(result("odd-dicts", "recommended"));
    expect(after.filter((i) => i.filter === "/DCTDecode")).toHaveLength(1);
  });
});

describe("compress-pdf failures", () => {
  it("turns a damaged file into a plain sentence", async () => {
    const junk = new TextEncoder().encode("%PDF-1.7 not really a pdf")
      .buffer as ArrayBuffer;
    const error = await compress(junk, "recommended").then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isEngineError(error)).toBe(true);
    expect((error as Error).message).not.toMatch(/Expected instance of/);
  });
});
