/**
 * Synthetic PDFs shaped like the files real tools export, for the
 * compress-pdf browser tests (ADR-0017 addendum, 2026-10-07). We don't have
 * users' files, so each entry reproduces one object shape that broke or
 * escaped the compressor: ICC colour spaces held in arrays, `/Filter` and
 * `/DecodeParms` arrays, images inside nested Form XObjects, soft masks,
 * Indexed and CMYK data, codecs we can't re-encode, one image shared by many
 * pages. Built in the browser (OffscreenCanvas makes the JPEGs) and never
 * committed: the noisy pixels are what make the sizes realistic.
 */
import {
  PDFDocument,
  PDFName,
  type PDFObject,
  type PDFRef,
} from "@cantoo/pdf-lib";

/** Deterministic PRNG so every run builds byte-identical pixels. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Cheap integer hash to [0,1): same inputs, same value, every run. */
function hash(x: number, y: number, seed: number): number {
  let h =
    Math.imul(x, 374761393) ^
    Math.imul(y, 668265263) ^
    Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Soft gradients, blotches at three scales and fine grain: compresses like
 * a photo or a grainy scan (detail that survives a 2x downsample), not like
 * a flat graphic. */
function pixels(
  width: number,
  height: number,
  channels: 1 | 3 | 4,
  seed: number,
  noise = 10,
): Uint8Array {
  const rand = rng(seed);
  const out = new Uint8Array(width * height * channels);
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const base =
        140 +
        50 * Math.sin(x / 90 + seed) * Math.cos(y / 70) +
        (hash(x >> 5, y >> 5, seed) - 0.5) * 60 +
        (hash(x >> 3, y >> 3, seed + 1) - 0.5) * 36 +
        (hash(x >> 1, y >> 1, seed + 2) - 0.5) * 20;
      for (let c = 0; c < channels; c++) {
        const tint = c === 0 ? 0 : c === 1 ? 12 : -10;
        const v = base + tint + (rand() - 0.5) * noise;
        out[i++] = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
  }
  return out;
}

async function jpegBytes(
  width: number,
  height: number,
  seed: number,
  quality = 0.92,
): Promise<Uint8Array> {
  const rgb = pixels(width, height, 3, seed);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgba[p * 4] = rgb[p * 3] ?? 0;
    rgba[p * 4 + 1] = rgb[p * 3 + 1] ?? 0;
    rgba[p * 4 + 2] = rgb[p * 3 + 2] ?? 0;
    rgba[p * 4 + 3] = 255;
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  return new Uint8Array(await blob.arrayBuffer());
}

type Ctx = PDFDocument["context"];

interface ImageSpec {
  width: number;
  height: number;
  /** Extra dict entries; strings become names, arrays/objects convert. */
  dict: Record<string, unknown>;
  bytes: Uint8Array;
  /** True: store `bytes` as-is with the Filter in `dict`. False: deflate. */
  raw?: boolean;
}

function addImage(ctx: Ctx, spec: ImageSpec): PDFRef {
  const dict = {
    Type: "XObject",
    Subtype: "Image",
    Width: spec.width,
    Height: spec.height,
    BitsPerComponent: 8,
    ...spec.dict,
  };
  const stream = spec.raw
    ? ctx.stream(spec.bytes, dict)
    : ctx.flateStream(spec.bytes, dict);
  return ctx.register(stream);
}

/** A fake ICC profile: the compressor only reads `/N`, never the bytes. */
function addIcc(ctx: Ctx, n: 1 | 3): PDFRef {
  return ctx.register(
    ctx.flateStream(new Uint8Array(512).fill(7), {
      N: n,
      Alternate: n === 3 ? "DeviceRGB" : "DeviceGray",
    }),
  );
}

function place(
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
): string {
  return `q ${w} 0 0 ${h} ${x} ${y} cm /${name} Do Q\n`;
}

function setPage(
  doc: PDFDocument,
  width: number,
  height: number,
  xobjects: Record<string, PDFObject | PDFRef>,
  ops: string,
  extra: Record<string, unknown> = {},
): void {
  const ctx = doc.context;
  const page = doc.addPage([width, height]);
  const resources = ctx.obj({ XObject: {} });
  const xdict = resources.get(PDFName.of("XObject"));
  for (const [name, ref] of Object.entries(xobjects)) {
    (xdict as unknown as { set(k: PDFName, v: PDFObject): void }).set(
      PDFName.of(name),
      ref,
    );
  }
  page.node.set(PDFName.of("Resources"), resources);
  page.node.set(PDFName.of("Contents"), ctx.register(ctx.flateStream(ops)));
  for (const [k, v] of Object.entries(extra)) {
    page.node.set(PDFName.of(k), ctx.obj(v as never));
  }
}

async function save(doc: PDFDocument): Promise<ArrayBuffer> {
  return (await doc.save()).slice().buffer as ArrayBuffer;
}

/** 5x7 inch page, a 1500x2100 image across it: 300 dpi. */
const SCAN_W = 1500;
const SCAN_H = 2100;

export interface CorpusEntry {
  name: string;
  /** What the entry exercises, for the test names. */
  note: string;
  bytes: ArrayBuffer;
}

export async function buildCorpus(): Promise<CorpusEntry[]> {
  const entries: CorpusEntry[] = [];
  const add = (name: string, note: string, bytes: ArrayBuffer): void => {
    entries.push({ name, note, bytes });
  };

  // a. 300 dpi scans, FlateDecode.
  {
    const doc = await PDFDocument.create();
    const ref = addImage(doc.context, {
      width: SCAN_W,
      height: SCAN_H,
      dict: { ColorSpace: "DeviceRGB" },
      bytes: pixels(SCAN_W, SCAN_H, 3, 1, 14),
    });
    setPage(doc, 360, 504, { Im0: ref }, place("Im0", 0, 0, 360, 504));
    add("scan-rgb", "300 dpi RGB scan, FlateDecode", await save(doc));
  }
  {
    const doc = await PDFDocument.create();
    const ref = addImage(doc.context, {
      width: SCAN_W,
      height: SCAN_H,
      dict: { ColorSpace: "DeviceGray" },
      bytes: pixels(SCAN_W, SCAN_H, 1, 2, 14),
    });
    setPage(doc, 360, 504, { Im0: ref }, place("Im0", 0, 0, 360, 504));
    add("scan-gray", "300 dpi grayscale scan, FlateDecode", await save(doc));
  }

  // b. JPEG with the object shapes real exporters write.
  {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const icc = addIcc(ctx, 3);
    const csRef = ctx.register(ctx.obj([PDFName.of("ICCBased"), icc]));
    const ref = addImage(ctx, {
      width: 1800,
      height: 1200,
      dict: {
        ColorSpace: csRef,
        Filter: ["DCTDecode"],
        DecodeParms: [null],
      },
      bytes: await jpegBytes(1800, 1200, 3, 0.95),
      raw: true,
    });
    setPage(doc, 450, 300, { Im0: ref }, place("Im0", 0, 0, 450, 300));
    add(
      "jpeg-icc",
      "JPEG, ICCBased colour space via ref, Filter and DecodeParms arrays",
      await save(doc),
    );
  }
  {
    // The shape that threw "Expected instance of PDFName, but got instance of
    // PDFArray": a Flate image whose /ColorSpace is an array.
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const icc = addIcc(ctx, 3);
    const ref = addImage(ctx, {
      width: 1500,
      height: 1000,
      dict: {
        ColorSpace: ctx.obj([PDFName.of("ICCBased"), icc]),
        DecodeParms: ctx.obj([{ Predictor: 1 }]),
        Filter: ["FlateDecode"],
      },
      bytes: pixels(1500, 1000, 3, 4, 12),
      raw: false,
    });
    // flateStream overwrote Filter with the plain name; put the array back.
    const stream = ctx.lookup(ref) as unknown as {
      dict: { set(k: PDFName, v: PDFObject): void };
    };
    stream.dict.set(PDFName.of("Filter"), ctx.obj(["FlateDecode"]));
    setPage(doc, 500, 333, { Im0: ref }, place("Im0", 0, 0, 500, 333));
    add(
      "flate-icc",
      "Flate RGB with an ICCBased array colour space and array filters",
      await save(doc),
    );
  }

  // c. Images inside Form XObjects, nested two deep (Word, Canva, InDesign).
  {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const img = addImage(ctx, {
      width: 1800,
      height: 1200,
      dict: { ColorSpace: "DeviceRGB", Filter: "DCTDecode" },
      bytes: await jpegBytes(1800, 1200, 5, 0.95),
      raw: true,
    });
    // Inner form: draws the image across a 600x400 box.
    const inner = ctx.register(
      ctx.flateStream(place("Im0", 0, 0, 600, 400), {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 600, 400],
        Resources: { XObject: { Im0: img } },
      }),
    );
    // Outer form: scales it by 0.5, so the image is drawn 300x200 pt.
    const outer = ctx.register(
      ctx.flateStream("q 0.5 0 0 0.5 0 0 cm /Fm1 Do Q\n", {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 600, 400],
        Resources: { XObject: { Fm1: inner } },
      }),
    );
    // The page is much bigger than the picture (300x200 pt on 900x600), so a
    // scan that only knew the page size would think the image is ~144 dpi and
    // leave it alone; the real drawn size is ~432 dpi.
    setPage(doc, 900, 600, { Fm0: outer }, "q 1 0 0 1 100 100 cm /Fm0 Do Q\n");
    add(
      "forms-nested",
      "JPEG inside a Form XObject nested two levels deep",
      await save(doc),
    );
  }
  {
    // Same, but the form's /Resources is missing (inherited from the page)
    // and the forms point at each other: the walker must not loop.
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const img = addImage(ctx, {
      width: 1500,
      height: 1000,
      dict: { ColorSpace: "DeviceRGB" },
      bytes: pixels(1500, 1000, 3, 6, 12),
    });
    const a = ctx.register(
      ctx.flateStream("q 1 0 0 1 0 0 cm /Fb Do /Im0 Do Q\n", {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 500, 333],
      }),
    );
    const b = ctx.register(
      ctx.flateStream("q 1 0 0 1 0 0 cm /Fa Do Q\n", {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 500, 333],
      }),
    );
    setPage(
      doc,
      500,
      333,
      { Fa: a, Fb: b, Im0: img },
      "q 500 0 0 333 0 0 cm /Fa Do Q\n",
    );
    add(
      "forms-cycle",
      "Forms that reference each other, resources inherited from the page",
      await save(doc),
    );
  }

  // d. An SMask (alpha) image.
  {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const mask = addImage(ctx, {
      width: 1500,
      height: 1000,
      dict: { ColorSpace: "DeviceGray" },
      bytes: pixels(1500, 1000, 1, 7, 6),
    });
    const ref = addImage(ctx, {
      width: 1500,
      height: 1000,
      dict: { ColorSpace: "DeviceRGB", SMask: mask },
      bytes: pixels(1500, 1000, 3, 8, 12),
    });
    setPage(doc, 500, 333, { Im0: ref }, place("Im0", 0, 0, 500, 333));
    add("smask", "RGB image with a soft mask", await save(doc));
  }

  // e. Indexed and CMYK.
  {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const palette = ctx.register(ctx.flateStream(pixels(256, 1, 3, 9, 200)));
    const idx = ctx.obj([
      PDFName.of("Indexed"),
      PDFName.of("DeviceRGB"),
      255,
      palette,
    ]);
    const ref = addImage(ctx, {
      width: 1200,
      height: 900,
      dict: { ColorSpace: idx },
      bytes: pixels(1200, 900, 1, 10, 255),
    });
    setPage(doc, 400, 300, { Im0: ref }, place("Im0", 0, 0, 400, 300));
    add("indexed", "Indexed palette image", await save(doc));
  }
  {
    const doc = await PDFDocument.create();
    const ref = addImage(doc.context, {
      width: 1200,
      height: 900,
      dict: { ColorSpace: "DeviceCMYK" },
      bytes: pixels(1200, 900, 4, 11, 12),
    });
    setPage(doc, 400, 300, { Im0: ref }, place("Im0", 0, 0, 400, 300));
    add("cmyk", "DeviceCMYK image", await save(doc));
  }

  // f. Codecs we cannot re-encode: left alone, never fatal.
  {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const junk = (seed: number): Uint8Array => {
      const r = rng(seed);
      return Uint8Array.from({ length: 60_000 }, () => Math.floor(r() * 256));
    };
    const jbig2 = addImage(ctx, {
      width: 2000,
      height: 2800,
      dict: {
        ColorSpace: "DeviceGray",
        BitsPerComponent: 1,
        Filter: "JBIG2Decode",
      },
      bytes: junk(1),
      raw: true,
    });
    const ccitt = addImage(ctx, {
      width: 2000,
      height: 2800,
      dict: {
        ColorSpace: "DeviceGray",
        BitsPerComponent: 1,
        Filter: "CCITTFaxDecode",
        DecodeParms: { K: -1, Columns: 2000 },
      },
      bytes: junk(2),
      raw: true,
    });
    const jpx = addImage(ctx, {
      width: 2000,
      height: 2800,
      dict: { Filter: "JPXDecode" },
      bytes: junk(3),
      raw: true,
    });
    setPage(
      doc,
      500,
      700,
      { A: jbig2, B: ccitt, C: jpx },
      place("A", 0, 0, 250, 350) +
        place("B", 250, 0, 250, 350) +
        place("C", 0, 350, 250, 350),
    );
    add("unsupported-codecs", "JBIG2, CCITT and JPX images", await save(doc));
  }

  // g. One image on many pages.
  {
    const doc = await PDFDocument.create();
    const ref = addImage(doc.context, {
      width: 1800,
      height: 1200,
      dict: { ColorSpace: "DeviceRGB", Filter: "DCTDecode" },
      bytes: await jpegBytes(1800, 1200, 12, 0.95),
      raw: true,
    });
    for (let p = 0; p < 12; p++) {
      setPage(doc, 450, 300, { Im0: ref }, place("Im0", 0, 0, 450, 300));
    }
    add("shared-image", "One JPEG used on 12 pages", await save(doc));
  }

  // Extra: an image painted by an annotation's appearance stream.
  {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const img = addImage(ctx, {
      width: 1500,
      height: 1000,
      dict: { ColorSpace: "DeviceRGB" },
      bytes: pixels(1500, 1000, 3, 13, 12),
    });
    const ap = ctx.register(
      ctx.flateStream(place("Im0", 0, 0, 1500, 1000), {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 1500, 1000],
        Resources: { XObject: { Im0: img } },
      }),
    );
    const annot = ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Stamp",
        Rect: [0, 0, 300, 200],
        AP: { N: ap },
      }),
    );
    setPage(doc, 900, 600, {}, "", { Annots: [annot] });
    add(
      "annotation",
      "Image in an annotation appearance stream",
      await save(doc),
    );
  }

  // Dictionaries written every which way: nothing here may throw.
  {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const width = ctx.register(ctx.obj(1500));
    const height = ctx.register(ctx.obj(1000));
    const cs = ctx.register(ctx.obj("DeviceRGB"));
    const filter = ctx.register(ctx.obj(["FlateDecode"]));
    const viaRefs = addImage(ctx, {
      width: 1500,
      height: 1000,
      dict: { ColorSpace: cs, Width: width, Height: height },
      bytes: pixels(1500, 1000, 3, 14, 12),
    });
    (
      ctx.lookup(viaRefs) as unknown as {
        dict: { set(k: PDFName, v: PDFObject): void };
      }
    ).dict.set(PDFName.of("Filter"), filter);
    const sixteen = addImage(ctx, {
      width: 800,
      height: 600,
      dict: { ColorSpace: "DeviceRGB", BitsPerComponent: 16 },
      bytes: new Uint8Array(800 * 600 * 6),
    });
    const pattern = addImage(ctx, {
      width: 800,
      height: 600,
      dict: { ColorSpace: "Pattern" },
      bytes: pixels(800, 600, 3, 16, 12),
    });
    const separation = addImage(ctx, {
      width: 800,
      height: 600,
      dict: { ColorSpace: ctx.obj(["Separation", "Spot", "DeviceRGB", null]) },
      bytes: pixels(800, 600, 1, 17, 12),
    });
    const noSize = ctx.register(
      ctx.stream(pixels(300, 300, 3, 18), {
        Type: "XObject",
        Subtype: "Image",
        ColorSpace: "DeviceRGB",
      }),
    );
    const decodeArray = addImage(ctx, {
      width: 800,
      height: 600,
      dict: { ColorSpace: "DeviceRGB", Decode: [1, 0, 1, 0, 1, 0] },
      bytes: pixels(800, 600, 3, 19, 12),
    });
    // Claims 2000x2000 but carries 100x100 of data.
    const truncated = addImage(ctx, {
      width: 2000,
      height: 2000,
      dict: { ColorSpace: "DeviceRGB" },
      bytes: pixels(100, 100, 3, 20, 12),
    });
    setPage(
      doc,
      500,
      700,
      {
        A: viaRefs,
        B: sixteen,
        C: pattern,
        D: separation,
        E: noSize,
        F: decodeArray,
        G: truncated,
      },
      place("A", 0, 0, 250, 167) + place("B", 250, 0, 250, 350),
    );
    add(
      "odd-dicts",
      "Indirect, missing and unusual image dictionary entries",
      await save(doc),
    );
  }

  return entries;
}
