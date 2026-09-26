import type { ImageDataConverter } from "@embedpdf/engines";
import { EngineRunner, PdfEngine, PdfiumNative } from "@embedpdf/engines";
import { init } from "@embedpdf/pdfium";
import { ENGINE_MANIFEST } from "@/lib/engines/manifest";

/**
 * E1: PDFium hosted inside OUR OWN module worker, spawned by
 * `pdfium-engine.ts` via `new Worker(new URL("./pdfium.worker.ts",
 * import.meta.url), { type: "module" })` — our own worker pattern (see
 * src/lib/workers/spawn.ts), not EmbedPDF's internal blob-worker path (that
 * path hung in E0 — see docs/editor/EMBEDPDF_NOTES.md).
 *
 * E0b got as far as `pdfium-direct-engine`'s `createPdfiumEngine` running
 * inside this worker via `EngineRunner` — but that wrapper hardcodes its
 * `imageConverter` to `browserImageDataToBlobConverter`, which calls
 * `document.createElement("canvas")` unconditionally. There is no `document`
 * in a worker, so every Blob-producing method (`renderPage`,
 * `renderThumbnail`, `renderPageAnnotation`, …) rejected with
 * `ImageConverterError: document is not available`, forcing the E0b spike
 * onto `renderPageRaw`/main-thread-canvas only.
 *
 * This assembles the same pieces `pdfium-direct-engine`'s `createPdfiumEngine`
 * does internally (confirmed by reading its built source,
 * `direct-engine-C8xTbxym.js`) by hand instead of using that wrapper, so a
 * worker-safe `imageConverter` can be substituted:
 *
 *   fetch(wasmUrl) -> init({ wasmBinary }) -> new PdfiumNative(module, opts)
 *   -> new PdfEngine(native, { imageConverter })
 *
 * `imageConverter` here uses `OffscreenCanvas` (available in a module worker,
 * unlike `document`), so `renderPage`/`renderThumbnail`/plugin-driven
 * rendering all work unchanged through the worker — EmbedPDF's standard
 * annotation/redaction/render APIs no longer need the raw+main-thread-canvas
 * workaround.
 *
 * Typechecked by `tsconfig.worker.json` (WebWorker lib, no DOM) — see
 * ADR-0005.
 */

/** `ImageConversionTypes` PDFium can ask for. `OffscreenCanvas.convertToBlob`
 * supports png/jpeg/webp directly; "image/bmp" isn't a convertToBlob type at
 * all (browserImageDataToBlobConverter builds one by hand for that case) —
 * nothing in this editor requests bmp output, so it's left unsupported here
 * rather than duplicating that byte-level encoder. */
const offscreenImageConverter: ImageDataConverter<Blob> = async (
  getImageData,
  imageType = "image/png",
  quality,
) => {
  if (imageType === "image/bmp") {
    throw new Error(
      "offscreenImageConverter: image/bmp output is not supported",
    );
  }
  const pdfImage = getImageData();
  const imageData = new ImageData(
    pdfImage.data,
    pdfImage.width,
    pdfImage.height,
  );
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("offscreenImageConverter: 2d context unavailable");
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.convertToBlob({ type: imageType, quality });
};

async function main() {
  const wasmUrl = new URL(
    `${ENGINE_MANIFEST.pdfium.baseUrl}pdfium.wasm`,
    self.location.origin,
  ).toString();

  const response = await fetch(wasmUrl);
  const wasmBinary = await response.arrayBuffer();
  const pdfiumModule = await init({ wasmBinary });

  const native = new PdfiumNative(pdfiumModule, {
    // Disables PDFium's embedded-font-fallback CDN entirely — invariant 1.
    // See docs/editor/EMBEDPDF_NOTES.md, "Font fallback".
    fontFallback: null,
  });
  const engine = new PdfEngine(native, {
    imageConverter: offscreenImageConverter,
  });

  const runner = new EngineRunner();
  runner.engine = engine;
  runner.ready();
}

main();
