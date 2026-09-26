import { ENGINE_MANIFEST } from "@/lib/engines/manifest";
import { createWorkerPool, spawnEngineWorker } from "@/lib/workers";

/**
 * Slice E4b — "Remove hidden data" export option. Runs pdf-lib's `sanitize`
 * op (metadata + JavaScript + attachments — the same three defaults the
 * standalone `sanitize-pdf` tool ships) on the exported bytes, in a fresh
 * engine worker.
 *
 * Same shape as `flattenExportedForms` in `flatten-forms.ts` right next to
 * this file — see its doc comment for why this goes through
 * `createWorkerPool`/`spawnEngineWorker` rather than a bare
 * `import("@cantoo/pdf-lib")` here on the main thread (invariant 2), and why
 * a fresh single-worker pool rather than the app's shared one.
 */
export async function sanitizeExportedPdf(
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
        jobId: "pdf-sanitize",
        input: { kind: "bytes", bytes },
        steps: [
          {
            engine: "pdf-lib",
            baseUrl: ENGINE_MANIFEST["pdf-lib"].baseUrl,
            op: "sanitize",
            inputFormat: "pdf",
            outputFormat: "pdf",
          },
        ],
        options: { metadata: true, javascript: true, attachments: true },
      },
      { signal: controller.signal },
    );
    if (result.kind !== "bytes") {
      throw new Error(
        `sanitize-pdf returned unexpected result kind "${result.kind}"`,
      );
    }
    return result.bytes;
  } finally {
    pool.destroy();
  }
}
