import { describe, expect, it } from "vitest";
import { createPdfiumWorkerEngine } from "./pdfium-engine";

/**
 * E5 — edit existing text, exercised through the REAL `pdfium.worker.ts`
 * (real wasm, real worker, real `postMessage`), not a mock. This is also the
 * only automated guard on `native.cache`/`ctx.getContext`/`ctx.borrowPage` —
 * an UNDOCUMENTED `@embedpdf/engines` internal (see `pdfium.worker.ts`'s
 * `requirePdfium()` doc comment): a future `@embedpdf/engines` upgrade that
 * renames or removes `PdfiumNative.cache` will only ever be caught by this
 * test actually running against a real build, never by the type checker.
 *
 * Builds its own fixture client-side via `@cantoo/pdf-lib` — the same
 * pattern `pdfium-engine.browser.test.ts`'s `buildFixture()` uses — rather
 * than reading `e2e/fixtures/pdf-editor.pdf` from disk: there is no ambient
 * module declaration in this project for a `?url`-suffixed static-asset
 * import, and Vitest browser mode's test file itself runs in the browser
 * realm, where `node:fs` isn't available. A "Sample" text run drawn with a
 * real embedded (non-subset-safe) standard font is an equally real text
 * object for this feature's purposes.
 */

async function buildFixture(): Promise<ArrayBuffer> {
  const { PDFDocument, rgb, StandardFonts } = await import("@cantoo/pdf-lib");
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 150]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Sample text for page 1", {
    x: 20,
    y: 75,
    size: 14,
    font,
    color: rgb(0, 0, 0),
  });
  const bytes = await doc.save();
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

describe("text edit (real pdfium worker)", () => {
  it("lists 'Sample', replaces it with 'Changed', and the change survives export+reopen", async () => {
    const { engine, textEdit, terminate } = createPdfiumWorkerEngine();
    try {
      const fixture = await buildFixture();
      const documentId = "e5-text-edit-test";
      const doc = await engine
        .openDocumentBuffer({ id: documentId, content: fixture })
        .toPromise();
      expect(doc.pageCount).toBeGreaterThan(0);

      const objects = await textEdit.list(documentId, 0);
      const sampleObject = objects.find((o) => o.text.includes("Sample"));
      expect(sampleObject).toBeDefined();
      if (!sampleObject) throw new Error("no 'Sample' text object found");

      const result = await textEdit.replace(
        documentId,
        0,
        sampleObject.objectIndex,
        "Changed text for page 1",
      );
      expect(result.usedFallbackFont).toBe(false);

      const exported = await engine.saveAsCopy(doc).toPromise();

      const reopenedId = "e5-text-edit-test-reopened";
      const reopened = await engine
        .openDocumentBuffer({ id: reopenedId, content: exported })
        .toPromise();
      const reopenedPage = reopened.pages[0];
      if (!reopenedPage) throw new Error("no page 0 in reopened document");

      const { runs } = await engine
        .getPageTextRuns(reopened, reopenedPage)
        .toPromise();
      const text = runs.map((r) => r.text).join("");
      expect(text).toContain("Changed");
      expect(text).not.toContain("Sample");

      // Also confirmed via this feature's own `list` op, on the reopened
      // document -- not just the generic `getPageTextRuns` read path.
      const reopenedObjects = await textEdit.list(reopenedId, 0);
      expect(reopenedObjects.some((o) => o.text.includes("Changed"))).toBe(
        true,
      );
      expect(reopenedObjects.some((o) => o.text.includes("Sample"))).toBe(
        false,
      );
    } finally {
      terminate();
    }
  });

  it("falls back to a standard font when the new text has an unseen character", async () => {
    const { engine, textEdit, terminate } = createPdfiumWorkerEngine();
    try {
      const fixture = await buildFixture();
      const documentId = "e5-text-edit-fallback-test";
      await engine
        .openDocumentBuffer({ id: documentId, content: fixture })
        .toPromise();
      const objects = await textEdit.list(documentId, 0);
      const sampleObject = objects.find((o) => o.text.includes("Sample"));
      if (!sampleObject) throw new Error("no 'Sample' text object found");

      // A character ("€") this fixture's own text run never contains --
      // exercises `needsFallbackFont`'s true branch against a real font.
      const result = await textEdit.replace(
        documentId,
        0,
        sampleObject.objectIndex,
        "€uro",
      );
      expect(result.usedFallbackFont).toBe(true);
    } finally {
      terminate();
    }
  });
});
