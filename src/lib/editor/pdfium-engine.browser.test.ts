import { describe, expect, it } from "vitest";
import { createPdfiumWorkerEngine } from "./pdfium-engine";

/**
 * Real worker, real wasm, real browser. Confirms the E1 fix in
 * `pdfium.worker.ts` (a worker-safe, `OffscreenCanvas`-based `imageConverter`
 * in place of `pdfium-direct-engine`'s hardcoded `document`-based one): the
 * standard `renderPage` (Blob-producing, not the raw+main-thread-canvas
 * workaround E0b was stuck with) resolves through the worker with a non-blank
 * image. See docs/editor/EMBEDPDF_NOTES.md.
 */

async function buildFixture(): Promise<ArrayBuffer> {
  const { PDFDocument, rgb, StandardFonts } = await import("@cantoo/pdf-lib");
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 150]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("hello pdfium", {
    x: 20,
    y: 75,
    size: 18,
    font,
    color: rgb(0, 0, 0),
  });
  const bytes = await doc.save();
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

describe("pdfium worker rendering (real browser)", () => {
  it("renders page 1 through the worker proxy to a non-blank Blob", async () => {
    const { engine, terminate } = createPdfiumWorkerEngine();
    try {
      const fixture = await buildFixture();
      const doc = await engine
        .openDocumentBuffer({ id: "e1-render-test", content: fixture })
        .toPromise();
      expect(doc.pageCount).toBe(1);

      const page = doc.pages[0];
      if (!page) throw new Error("no pages in fixture");

      // The standard, Blob-producing renderPage — not renderPageRaw — is the
      // whole point of this test: it only works through the worker if the
      // imageConverter doesn't need `document`.
      const blob = await engine.renderPage(doc, page).toPromise();
      expect(blob.size).toBeGreaterThan(0);
      expect(blob.type).toBe("image/png");

      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context in test setup");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();

      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Blank/all-white would mean the render silently produced nothing;
      // "hello pdfium" drawn in black guarantees some non-white pixel.
      let hasNonWhitePixel = false;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) {
          hasNonWhitePixel = true;
          break;
        }
      }
      expect(hasNonWhitePixel).toBe(true);
    } finally {
      terminate();
    }
  });
});
