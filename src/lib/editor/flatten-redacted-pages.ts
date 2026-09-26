import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import type { ReplacePageImage } from "@/lib/engines/pdf-lib/adapter";
import { createWorkerPool, spawnEngineWorker } from "@/lib/workers";

/**
 * Slice E4a -- the redaction "Apply" step's optional "flatten to images"
 * pass. `redactTextInRects`/`applyAllRedactions` (called directly against the
 * PDFium engine in `pdf-editor-app.tsx`) only remove TEXT under a marked box
 * -- an image or vector graphic underneath survives. This bakes each
 * redacted page down to a single rendered PNG via pdf-lib's
 * `replacePagesWithImages` op, run in its own throwaway engine-worker pool,
 * same pattern (and same reasoning -- invariant 2, no PDF parsing on the main
 * thread) as `flatten-forms.ts`'s `flattenExportedForms`. The page images
 * themselves are rendered separately, by the editor's own `pdfium.worker.ts`
 * (`engine.renderPage`, see `pdf-editor-app.tsx`'s `applyRedactions`) --
 * this function only receives the already-rendered PNG bytes and does the
 * pdf-lib page-replacement step.
 */
export async function flattenRedactedPagesToImages(
  bytes: ArrayBuffer,
  images: ReplacePageImage[],
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
        jobId: "redaction-flatten",
        input: { kind: "bytes", bytes },
        steps: [
          {
            engine: "pdf-lib",
            baseUrl: ENGINE_MANIFEST["pdf-lib"].baseUrl,
            op: "replacePagesWithImages",
            inputFormat: "pdf",
            outputFormat: "pdf",
          },
        ],
        options: { images },
      },
      { signal: controller.signal },
    );
    if (result.kind !== "bytes") {
      throw new Error(
        `replacePagesWithImages returned unexpected result kind "${result.kind}"`,
      );
    }
    return result.bytes;
  } finally {
    pool.destroy();
  }
}
