import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import { createWorkerPool, spawnEngineWorker } from "@/lib/workers";

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
 * dispatches to the SAME engine-worker machinery `ToolRunner` uses
 * (`src/lib/workers`'s `createWorkerPool` + `spawnEngineWorker`, the pair
 * `src/lib/jobs/app.ts`'s `getAppJobEngine` wires up for the whole app),
 * just without going through `JobEngine`/the job store — that layer is
 * `ToolRunner`'s user-visible upload-a-file-see-a-progress-bar UI, which
 * this internal export step has no business appearing in. A fresh
 * single-worker pool is spun up for this one call and torn down right
 * after; `pdf-lib` is a `heavy: false`, `kind: "job"` engine with no wasm to
 * keep warm (see `ENGINE_MANIFEST["pdf-lib"]`), so there's no pinned-worker
 * benefit to sharing the app's own pool instead.
 */
export async function flattenExportedForms(
  bytes: ArrayBuffer,
): Promise<ArrayBuffer> {
  const pool = createWorkerPool({
    size: 1,
    spawn: spawnEngineWorker,
    isHeavy: () => false,
  });
  try {
    const controller = new AbortController();
    const result = await pool.run(
      {
        jobId: "form-flatten",
        input: { kind: "bytes", bytes },
        steps: [
          {
            engine: "pdf-lib",
            baseUrl: ENGINE_MANIFEST["pdf-lib"].baseUrl,
            op: "flatten",
            inputFormat: "pdf",
            outputFormat: "pdf",
          },
        ],
        options: {},
      },
      { signal: controller.signal },
    );
    if (result.kind !== "bytes") {
      throw new Error(
        `flatten-pdf returned unexpected result kind "${result.kind}"`,
      );
    }
    return result.bytes;
  } finally {
    pool.destroy();
  }
}
