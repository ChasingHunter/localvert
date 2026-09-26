import {
  type PdfEngine,
  PdfPageFlattenFlag,
  PdfPageFlattenResult,
  uuidV4,
} from "@embedpdf/models";

/**
 * Slice E2a — "Flatten forms" export option. Bakes every page's form-field
 * appearances into the page content stream so the exported copy has no
 * AcroForm fields left to fill, then returns the flattened bytes.
 *
 * Takes already-exported bytes (`ExportCapability.saveAsCopy()`'s output,
 * called by `Editor.handleExport` in `pdf-editor-app.tsx` BEFORE this runs)
 * and opens them as a second, temporary document on the SAME engine —
 * `engine.openDocumentBuffer`, the bare `PdfEngine` method (not
 * `DocumentManagerCapability.openDocumentBuffer`, which would register the
 * temp doc in the plugin's React state and make it show up in the UI). The
 * user's open document in the editor is never touched: this function only
 * ever calls into the copy it opens and closes here.
 *
 * `PdfPageFlattenFlag.Display` (not `.Print`) is used — flattening bakes in
 * the same appearance the user just saw and filled on screen, which is what
 * "flatten forms" should mean for an export feature; PDFium's own
 * distinction between the two flags is about which annotations/appearance
 * streams are eligible to flatten (print-only vs. always-visible), not a
 * visual difference for ordinary filled fields.
 */
export async function flattenExportedForms(
  engine: PdfEngine,
  bytes: ArrayBuffer,
): Promise<ArrayBuffer> {
  const tempDoc = await engine
    .openDocumentBuffer({ id: `form-flatten-${uuidV4()}`, content: bytes })
    .toPromise();
  try {
    for (const page of tempDoc.pages) {
      const result = await engine
        .flattenPage(tempDoc, page, { flag: PdfPageFlattenFlag.Display })
        .toPromise();
      if (result === PdfPageFlattenResult.Fail) {
        throw new Error(`flattenPage failed on page ${page.index}`);
      }
    }
    return await engine.saveAsCopy(tempDoc).toPromise();
  } finally {
    await engine.closeDocument(tempDoc).toPromise();
  }
}
