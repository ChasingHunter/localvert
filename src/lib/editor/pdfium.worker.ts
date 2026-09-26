import { EngineRunner } from "@embedpdf/engines";
import { createPdfiumEngine } from "@embedpdf/engines/pdfium-direct-engine";

/**
 * E0b spike: PDFium hosted inside OUR OWN module worker, spawned by
 * `pdfium-engine.ts` via `new Worker(new URL("./pdfium.worker.ts",
 * import.meta.url), { type: "module" })` — our own worker pattern (see
 * src/lib/workers/spawn.ts), not EmbedPDF's internal blob-worker path.
 *
 * `@embedpdf/engines`'s `EngineRunner` is a plain class: it listens for
 * `postMessage`d `ExecuteRequest`s and dispatches them onto whatever
 * `PdfEngine` is assigned to its `.engine` field, replying over
 * `self.postMessage`. It has no opinion about how that worker was spawned —
 * this is the "host EmbedPDF's engine-side runner ourselves" half of the E0b
 * brief. The "PdfEngine" we assign it is `pdfium-direct-engine`'s
 * `createPdfiumEngine` — the *direct* (non-worker-spawning) build, proven in
 * E0's Node script to do true redaction — run here, inside our worker, so it
 * never touches the main thread (invariant 2), and it never spawns a second,
 * EmbedPDF-owned worker of its own (the thing that hung in E0).
 *
 * Typechecked by `tsconfig.worker.json` (WebWorker lib, no DOM) — see
 * ADR-0005.
 */

// Same-origin static asset — see the note in pdfium-engine.ts about why this
// is a hardcoded path rather than `ENGINE_MANIFEST` for this spike.
const PDFIUM_WASM_URL = new URL(
  "/engines/pdfium@2.15.1/pdfium.wasm",
  self.location.origin,
).toString();

async function main() {
  const runner = new EngineRunner();
  runner.engine = await createPdfiumEngine(PDFIUM_WASM_URL, {
    // Disables PDFium's embedded-font-fallback CDN entirely — invariant 1.
    // See docs/editor/EMBEDPDF_NOTES.md, "Font fallback".
    fontFallback: null,
    // `pdfium-direct-engine`'s `imageConverter` is hardcoded to
    // `browserImageDataToBlobConverter` (confirmed by reading
    // direct-engine-C8xTbxym.js) — it always calls
    // `document.createElement("canvas")`, with no worker-pool option at all
    // (that option only exists on the *other* `createPdfiumEngine`, from
    // `pdfium-worker-engine`, which spawns EmbedPDF's own blob worker — the
    // thing that hung in E0). So any `PdfEngine` method that produces a
    // `Blob` (`renderPage`, `renderThumbnail`, ...) throws "document is not
    // available" when this engine runs inside a worker, as it does here.
    // `renderPageRaw`/`renderPageRectRaw` sidestep `imageConverter`
    // entirely — they hand back raw `ImageDataLike` pixels with no canvas
    // encoding step — so the labs page uses those and draws to a `<canvas>`
    // on the MAIN thread (invariant 2: DOM stays there). See
    // docs/editor/EMBEDPDF_NOTES.md for the full writeup and what a real
    // editor would need instead (a hand-built worker-side `PdfEngine` using
    // the lower-level `PdfiumEngine`/`init()` classes, replicating what
    // `pdfium-worker-engine`'s internal, never-imported worker does).
    encoderPoolSize: 0,
  });
  runner.ready();
}

main();
