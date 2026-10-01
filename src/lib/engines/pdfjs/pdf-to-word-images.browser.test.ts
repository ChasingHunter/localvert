import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import docxAdapter from "@/lib/engines/docx/adapter";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import type { LayoutDocument } from "../shared/pdf-layout";
import type { EngineTask } from "../types";
import pdfjsAdapter from "./adapter";

// pdf.js and PDFium both load multi-megabyte JS/wasm on first use.
const TIMEOUT = 60_000;

function task(overrides: Partial<EngineTask>): EngineTask {
  return {
    op: "extractLayout",
    input: { kind: "bytes", bytes: new ArrayBuffer(0) },
    inputFormat: "pdf",
    outputFormat: "json",
    options: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function canvasBytes(
  type: "image/jpeg" | "image/png",
  w: number,
  h: number,
  paint: (ctx: OffscreenCanvasRenderingContext2D) => void,
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  paint(ctx);
  const blob = await canvas.convertToBlob({ type, quality: 0.9 });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Letter page, top to bottom: a line of text, a JPEG (200x100 pt, 2:1), a
 * paragraph, a half-transparent 300 px PNG drawn at 100x100 pt, a closing paragraph, and a
 * 10x10 px dot that must be skipped as too small.
 */
async function buildFixture(): Promise<{
  pdf: ArrayBuffer;
  jpeg: Uint8Array;
}> {
  const jpeg = await canvasBytes("image/jpeg", 200, 100, (ctx) => {
    ctx.fillStyle = "#c03030";
    ctx.fillRect(0, 0, 200, 100);
    ctx.fillStyle = "#3030c0";
    ctx.fillRect(100, 0, 100, 100);
  });
  const png = await canvasBytes("image/png", 300, 300, (ctx) => {
    ctx.fillStyle = "rgba(0, 160, 0, 0.5)";
    ctx.fillRect(0, 0, 300, 300);
  });
  const dot = await canvasBytes("image/png", 10, 10, (ctx) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 10, 10);
  });

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText("Intro line before pictures", {
    x: 72,
    y: 740,
    size: 12,
    font,
  });
  page.drawImage(await doc.embedJpg(jpeg), {
    x: 72,
    y: 560,
    width: 200,
    height: 100,
  });
  page.drawText("Middle paragraph between pictures", {
    x: 72,
    y: 480,
    size: 12,
    font,
  });
  page.drawImage(await doc.embedPng(png), {
    x: 72,
    y: 330,
    width: 100,
    height: 100,
  });
  page.drawText("Closing paragraph after pictures", {
    x: 72,
    y: 250,
    size: 12,
    font,
  });
  page.drawImage(await doc.embedPng(dot), {
    x: 400,
    y: 200,
    width: 10,
    height: 10,
  });
  const saved = await doc.save();
  return { pdf: saved.slice().buffer, jpeg };
}

async function convert(pdf: ArrayBuffer) {
  const pdfjs = await pdfjsAdapter.load({
    baseUrl: ENGINE_MANIFEST.pdfjs.baseUrl,
    capabilities: {} as never,
  });
  const layoutResult = await pdfjs.run(
    task({ input: { kind: "bytes", bytes: pdf } }),
  );
  if (layoutResult.kind !== "bytes") throw new Error("expected bytes");
  const layout = JSON.parse(
    new TextDecoder().decode(layoutResult.bytes),
  ) as LayoutDocument;

  const docx = await docxAdapter.load({
    baseUrl: "",
    capabilities: {} as never,
  });
  const docxResult = await docx.run(
    task({
      op: "transcode",
      inputFormat: "json",
      outputFormat: "docx",
      input: { kind: "bytes", bytes: layoutResult.bytes },
      options: { pageBreaks: true },
    }),
  );
  if (docxResult.kind !== "bytes") throw new Error("expected bytes");
  return { layout, files: unzipSync(new Uint8Array(docxResult.bytes)) };
}

describe("pdf-to-word images", () => {
  it(
    "puts a JPEG (untouched) and a PNG into word/media, in reading order",
    async () => {
      const { pdf, jpeg } = await buildFixture();
      const { layout, files } = await convert(pdf);

      const media = Object.keys(files).filter((n) =>
        n.startsWith("word/media/"),
      );
      expect(media.sort()).toEqual([
        "word/media/image1.jpeg",
        "word/media/image2.png",
      ]);

      // The JPEG stream is passed through byte for byte.
      const outJpeg = files["word/media/image1.jpeg"];
      expect(outJpeg && Array.from(outJpeg)).toEqual(Array.from(jpeg));
      // The other one is a real PNG.
      const outPng = files["word/media/image2.png"];
      expect(Array.from(outPng?.slice(0, 4) ?? [])).toEqual([
        0x89, 0x50, 0x4e, 0x47,
      ]);

      // Rendered at the image's own 300x300 pixels (not the 100 pt it is
      // drawn at), with an alpha channel (colour type 6).
      const ihdr = new DataView(
        outPng?.buffer ?? new ArrayBuffer(0),
        outPng?.byteOffset,
        33,
      );
      expect([ihdr.getUint32(16), ihdr.getUint32(20), outPng?.[25]]).toEqual([
        300, 300, 6,
      ]);
      // Colour order and transparency survive (translucent green).
      const decoded = await createImageBitmap(
        new Blob([outPng ?? new Uint8Array()]),
      );
      const probe = new OffscreenCanvas(1, 1).getContext("2d");
      if (!probe) throw new Error("no 2d context");
      probe.drawImage(decoded, 150, 150, 1, 1, 0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = probe.getImageData(0, 0, 1, 1).data;
      expect([r, b]).toEqual([0, 0]);
      expect(g).toBeGreaterThan(100);
      expect(a).toBeGreaterThan(100);
      expect(a).toBeLessThan(160);

      // The 10px dot is skipped: two images on the page, not three.
      expect(layout.pages[0]?.images).toHaveLength(2);

      const xml = strFromU8(files["word/document.xml"] ?? new Uint8Array());
      const order = [
        xml.indexOf("Intro line"),
        xml.indexOf('r:embed="rId2"'),
        xml.indexOf("Middle paragraph"),
        xml.indexOf('r:embed="rId3"'),
        xml.indexOf("Closing paragraph"),
      ];
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);

      // JPEG is 200x100 pt on a 612 pt page: 200/612 of 6.5in wide, 2:1.
      const extents = [
        ...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g),
      ].map((m) => [Number(m[1]), Number(m[2])] as const);
      expect(extents).toHaveLength(2);
      const [first, second] = extents as [
        readonly [number, number],
        readonly [number, number],
      ];
      expect(first[0]).toBeCloseTo((200 / 612) * 6.5 * 914400, -2);
      expect(first[0] / first[1]).toBeCloseTo(2, 2);
      expect(second[0] / second[1]).toBeCloseTo(1, 2);
      expect(second[0]).toBeCloseTo((100 / 612) * 6.5 * 914400, -2);
    },
    TIMEOUT,
  );

  it(
    "keeps the picture of a scanned page that has no text at all",
    async () => {
      const scan = await canvasBytes("image/png", 600, 800, (ctx) => {
        ctx.fillStyle = "#eeeeee";
        ctx.fillRect(0, 0, 600, 800);
        ctx.fillStyle = "#222222";
        ctx.fillRect(60, 80, 480, 40);
      });
      const doc = await PDFDocument.create();
      const page = doc.addPage([612, 792]);
      page.drawImage(await doc.embedPng(scan), {
        x: 0,
        y: 0,
        width: 612,
        height: 792,
      });
      const pdf = (await doc.save()).slice().buffer;

      const { layout, files } = await convert(pdf);
      expect(layout.pages[0]?.paragraphs).toEqual([]);
      expect(layout.pages[0]?.images).toHaveLength(1);
      expect(Object.keys(files)).toContain("word/media/image1.png");
      // A full-page scan spans the content width, page aspect kept.
      const xml = strFromU8(files["word/document.xml"] ?? new Uint8Array());
      const m = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml);
      expect(Number(m?.[1])).toBe(6.5 * 914400);
      expect(Number(m?.[2])).toBe(Math.round(6.5 * 914400 * (792 / 612)));
    },
    TIMEOUT,
  );
});
