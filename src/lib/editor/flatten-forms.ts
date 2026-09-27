import { runPdfLibOp } from "./run-pdf-lib-op";

/**
 * Slice E2a — "Flatten forms" export option. Bakes every form field's
 * current value into the page content and removes the AcroForm field
 * itself, then returns the flattened bytes.
 *
 * This used to run PDFium's own `flattenPage` on a temporary document (same
 * engine as the editor). That bakes widget APPEARANCES into the page
 * content, but leaves the document's `/AcroForm /Fields` entries in place —
 * pdf-lib (and some viewers) still see the fields as live, editable form
 * fields after "flattening". `pdf-lib`'s `flatten-pdf` tool op
 * (`runFlatten` in `src/lib/engines/pdf-lib/adapter.ts`) does the real
 * thing — `doc.getForm().flatten()` bakes appearances (defaulting to
 * `updateFieldAppearances: true`, so it reflects the values the user just
 * typed/checked/selected via `setFormFieldValue`, which write straight into
 * each field's `/V`) AND removes the field/widget objects.
 *
 * Invariant 2 (no PDF parsing on the main thread) still applies here, so
 * this doesn't just `import("@cantoo/pdf-lib")` and call it inline — it
 * dispatches to the same engine-worker machinery `ToolRunner` uses, via
 * `runPdfLibOp` (`src/lib/editor/run-pdf-lib-op.ts`) — see that module's
 * doc comment for why a one-off single-worker pool, not the app's shared
 * one, is the right call here.
 */
export async function flattenExportedForms(
  bytes: ArrayBuffer,
): Promise<ArrayBuffer> {
  return runPdfLibOp("flatten", [bytes]);
}
