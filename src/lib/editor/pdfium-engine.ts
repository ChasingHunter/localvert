import { WebWorkerEngine } from "@embedpdf/engines/worker";
import type { PdfEngine } from "@embedpdf/models";

/**
 * MAIN THREAD. Spawns `pdfium.worker.ts` (our own worker, our own wasm
 * fetch) and wraps it in EmbedPDF's `WebWorkerEngine` — a thin, generic
 * `PdfEngine` proxy over `postMessage`, imported from the `@embedpdf/engines`
 * `./worker` subpath (`dist/lib/webworker/engine.js`), which is deliberately
 * NOT the same module as `pdfium-worker-engine` (that one creates its own
 * blob: worker internally, the thing that hung in E0). This file never
 * imports anything PDFium- or wasm-related itself — only the dynamic
 * `import()` inside `pdfium.worker.ts`, reached exclusively through the `new
 * Worker(new URL(...))` call below, ever touches PDFium (invariants 2 & 3).
 *
 * `new Worker(new URL(...))` must stay exactly this literal shape inline —
 * see the same note in src/lib/workers/spawn.ts.
 *
 * Deliberately outside `src/lib/engines/**` and the job-pipeline
 * `EngineAdapter` contract: a stateful editor session doesn't fit the
 * one-shot `run(task)` shape that contract assumes (see ADR-0009's "app-mode
 * tool kind", still undesigned as of this spike). The wasm asset is also a
 * hand-copied static file rather than an `engine.json`-driven one for the
 * same reason: `pnpm gen` requires `engine.json` and `adapter.ts` to be
 * added together, and there is no adapter for a tool kind that doesn't exist
 * yet. Both are called out as follow-up work in
 * docs/editor/EMBEDPDF_NOTES.md.
 */
export function createPdfiumWorkerEngine(): {
  engine: PdfEngine;
  terminate(): void;
} {
  const worker = new Worker(new URL("./pdfium.worker.ts", import.meta.url), {
    type: "module",
    name: "localvert-pdfium",
  });
  const engine = new WebWorkerEngine(worker);
  return {
    engine,
    terminate() {
      worker.terminate();
    },
  };
}
