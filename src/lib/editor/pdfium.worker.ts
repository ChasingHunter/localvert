import type { ImageDataConverter } from "@embedpdf/engines";
import { EngineRunner, PdfEngine, PdfiumNative } from "@embedpdf/engines";
import { PdfPageObjectType } from "@embedpdf/models";
import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import {
  needsFallbackFont,
  pickStandardFontName,
} from "@/lib/editor/text-edit-font";
import type {
  TextEditReplaceResult,
  TextEditRequest,
  TextObjectInfo,
} from "@/lib/editor/text-edit-protocol";
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

/**
 * Set once `main()`'s wasm fetch + `PdfiumNative` construction finish — the
 * SAME `PdfiumNative` instance `PdfEngine`/`EngineRunner` use, not a second
 * one. Module-scope (not local to `main()`) so the `localvert:text` message
 * handler below, registered synchronously at load time, can reach it.
 */
let native: PdfiumNative | null = null;
let pdfiumModule: WrappedPdfiumModule | null = null;

async function main() {
  const wasmUrl = new URL(
    `${ENGINE_MANIFEST.pdfium.baseUrl}pdfium.wasm`,
    self.location.origin,
  ).toString();

  const response = await fetch(wasmUrl);
  const wasmBinary = await response.arrayBuffer();
  pdfiumModule = await init({ wasmBinary });

  native = new PdfiumNative(pdfiumModule, {
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

/**
 * E5 — edit existing text in place. The high-level `PdfEngine` has no
 * text-editing API (only reads: `getPageTextRuns`/`getPageGlyphs`), so this
 * talks to the raw PDFium module functions directly, the same way
 * `PdfiumNative` itself does internally (patterns confirmed by reading
 * `@embedpdf/engines/dist/direct-engine-*.js`).
 *
 * A SEPARATE channel from `EngineRunner`'s `self.onmessage` (set in `main()`
 * above) — `addEventListener` and `onmessage` coexist on the same
 * `EventTarget`, so this never interferes with the generic `ExecuteRequest`
 * protocol. Registered synchronously at module load (not inside `main()`),
 * so a message that arrives before wasm finishes initializing is answered
 * with a clear "not ready" error instead of being silently missed the way a
 * too-early `ExecuteRequest` would be (see `pdfium-engine.ts`'s `ready`
 * comment) — this protocol has no such hazard because every request always
 * gets exactly one reply, ok or not.
 */
self.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as TextEditRequest | undefined;
  if (data?.type !== "localvert:text") return;
  const { id } = data;
  try {
    const value = handleTextEditRequest(data);
    self.postMessage({ type: "localvert:text:result", id, ok: true, value });
  } catch (err) {
    self.postMessage({
      type: "localvert:text:result",
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

function handleTextEditRequest(
  request: TextEditRequest,
): TextObjectInfo[] | TextEditReplaceResult {
  if (request.op === "list") {
    return listTextObjects(request.documentId, request.pageIndex);
  }
  return replaceTextObject(
    request.documentId,
    request.pageIndex,
    request.objectIndex,
    request.newText,
  );
}

/** `PdfiumNative.cache` is not part of `@embedpdf/engines`'s public
 * `.d.ts` — it's a private-in-spirit implementation detail this relies on
 * to reach a page's raw `pagePtr` without duplicating `PdfEngine`'s whole
 * document-open bookkeeping. If a future `@embedpdf/engines` upgrade
 * removes or renames it, every op here must fail loudly (per the brief),
 * never silently no-op. */
function requirePdfium(): {
  module: WrappedPdfiumModule;
  // biome-ignore lint/suspicious/noExplicitAny: `PdfiumNative.cache` (a `PdfCache`) is undocumented — see this function's own doc comment.
  cache: any;
} {
  const module = pdfiumModule;
  // biome-ignore lint/suspicious/noExplicitAny: same undocumented internal as above.
  const cache = (native as any)?.cache;
  if (!module || !native || !cache || typeof cache.getContext !== "function") {
    throw new Error(
      "localvert:text — PDFium isn't ready yet, or PdfiumNative.cache.getContext " +
        "is unavailable (an undocumented @embedpdf/engines internal this feature " +
        "depends on — see docs/editor/EMBEDPDF_NOTES.md).",
    );
  }
  return { module, cache };
}

// biome-ignore lint/suspicious/noExplicitAny: `DocumentContext`/`PageContext` (from PdfCache) aren't exported types.
function getPageContextOrThrow(cache: any, documentId: string): any {
  const ctx = cache.getContext(documentId);
  if (!ctx) {
    throw new Error(
      `localvert:text — no open document context for "${documentId}"`,
    );
  }
  return ctx;
}

/** Allocates `sizes.length` buffers, hands their pointers to `fn` as a
 * same-length tuple (cast once here, rather than making every call site
 * deal with `noUncheckedIndexedAccess`'s `number | undefined` on a plain
 * array), and always frees them afterwards — even if `fn` throws. */
function withMalloc<P extends number[], T>(
  module: WrappedPdfiumModule,
  sizes: { length: P["length"] } & number[],
  fn: (ptrs: P) => T,
): T {
  const ptrs = sizes.map((size) => module.pdfium.wasmExports.malloc(size));
  try {
    return fn(ptrs as P);
  } finally {
    for (const ptr of ptrs) module.pdfium.wasmExports.free(ptr);
  }
}

function readBounds(
  module: WrappedPdfiumModule,
  objPtr: number,
): TextObjectInfo["bounds"] {
  return withMalloc<[number, number, number, number], TextObjectInfo["bounds"]>(
    module,
    [4, 4, 4, 4],
    ([left, bottom, right, top]) => {
      module.FPDFPageObj_GetBounds(objPtr, left, bottom, right, top);
      return {
        left: module.pdfium.getValue(left, "float"),
        bottom: module.pdfium.getValue(bottom, "float"),
        right: module.pdfium.getValue(right, "float"),
        top: module.pdfium.getValue(top, "float"),
      };
    },
  );
}

function readFillColor(
  module: WrappedPdfiumModule,
  objPtr: number,
): TextObjectInfo["fill"] {
  return withMalloc<[number, number, number, number], TextObjectInfo["fill"]>(
    module,
    [4, 4, 4, 4],
    ([rP, gP, bP, aP]) => {
      module.FPDFPageObj_GetFillColor(objPtr, rP, gP, bP, aP);
      return {
        r: module.pdfium.getValue(rP, "i32") & 255,
        g: module.pdfium.getValue(gP, "i32") & 255,
        b: module.pdfium.getValue(bP, "i32") & 255,
        a: module.pdfium.getValue(aP, "i32") & 255,
      };
    },
  );
}

function readFontSize(module: WrappedPdfiumModule, objPtr: number): number {
  return withMalloc<[number], number>(module, [4], ([sizePtr]) => {
    module.FPDFTextObj_GetFontSize(objPtr, sizePtr);
    return module.pdfium.getValue(sizePtr, "float");
  });
}

function readBaseFontName(module: WrappedPdfiumModule, objPtr: number): string {
  const fontPtr = module.FPDFTextObj_GetFont(objPtr);
  if (!fontPtr) return "";
  const len = module.FPDFFont_GetBaseFontName(fontPtr, 0, 0);
  if (len <= 0) return "";
  return withMalloc<[number], string>(module, [len + 1], ([buf]) => {
    module.FPDFFont_GetBaseFontName(fontPtr, buf, len + 1);
    return module.pdfium.UTF8ToString(buf);
  });
}

/** Reads a TEXT page object's string via `FPDFTextObj_GetText`, the
 * probe-then-alloc pattern PDFium's string-out APIs use throughout (see
 * `FPDFFont_GetBaseFontName` above): call once with a null buffer to learn
 * the required byte length (already including the UTF-16 NUL terminator,
 * per PDFium's own documented convention for this function), then again
 * into a buffer of exactly that size. `textPagePtr` comes from
 * `PageContext.getTextPage()` — cached per page, closed when the page
 * context disposes, never opened/closed per call here. */
function readTextObjectString(
  module: WrappedPdfiumModule,
  objPtr: number,
  textPagePtr: number,
): string {
  const byteLength = module.FPDFTextObj_GetText(objPtr, textPagePtr, 0, 0);
  if (byteLength <= 0) return "";
  return withMalloc<[number], string>(module, [byteLength], ([buf]) => {
    module.FPDFTextObj_GetText(objPtr, textPagePtr, buf, byteLength);
    return module.pdfium.UTF16ToString(buf);
  });
}

/** Writes `text` into a text object via `FPDFText_SetText`. UTF-16LE, one
 * code unit per JS `string` char plus a NUL terminator — the exact
 * `2 * (text.length + 1)`-byte convention `PdfiumNative`'s own
 * `setFormFieldValue` uses for `FORM_ReplaceSelection`. */
function writeTextObjectText(
  module: WrappedPdfiumModule,
  objPtr: number,
  text: string,
): void {
  const length = 2 * (text.length + 1);
  withMalloc<[number], void>(module, [length], ([ptr]) => {
    module.pdfium.stringToUTF16(text, ptr, length);
    if (!module.FPDFText_SetText(objPtr, ptr)) {
      throw new Error("localvert:text — FPDFText_SetText failed");
    }
  });
}

type Matrix = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

function readMatrix(module: WrappedPdfiumModule, objPtr: number): Matrix {
  return withMalloc<[number], Matrix>(module, [24], ([matrixPtr]) => {
    module.FPDFPageObj_GetMatrix(objPtr, matrixPtr);
    return {
      a: module.pdfium.getValue(matrixPtr, "float"),
      b: module.pdfium.getValue(matrixPtr + 4, "float"),
      c: module.pdfium.getValue(matrixPtr + 8, "float"),
      d: module.pdfium.getValue(matrixPtr + 12, "float"),
      e: module.pdfium.getValue(matrixPtr + 16, "float"),
      f: module.pdfium.getValue(matrixPtr + 20, "float"),
    };
  });
}

function writeMatrix(
  module: WrappedPdfiumModule,
  objPtr: number,
  matrix: Matrix,
): void {
  withMalloc<[number], void>(module, [24], ([matrixPtr]) => {
    const values = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
    values.forEach((value, i) => {
      module.pdfium.setValue(matrixPtr + i * 4, value, "float");
    });
    module.FPDFPageObj_SetMatrix(objPtr, matrixPtr);
  });
}

function listTextObjects(
  documentId: string,
  pageIndex: number,
): TextObjectInfo[] {
  const { module, cache } = requirePdfium();
  const ctx = getPageContextOrThrow(cache, documentId);
  return ctx.borrowPage(
    pageIndex,
    (pageCtx: { pagePtr: number; getTextPage(): number }) => {
      const pagePtr = pageCtx.pagePtr;
      const textPagePtr = pageCtx.getTextPage();
      const count = module.FPDFPage_CountObjects(pagePtr);
      const results: TextObjectInfo[] = [];
      for (let i = 0; i < count; i++) {
        const objPtr = module.FPDFPage_GetObject(pagePtr, i);
        if (!objPtr) continue;
        if (module.FPDFPageObj_GetType(objPtr) !== PdfPageObjectType.TEXT) {
          continue;
        }
        results.push({
          objectIndex: i,
          text: readTextObjectString(module, objPtr, textPagePtr),
          bounds: readBounds(module, objPtr),
          fontSize: readFontSize(module, objPtr),
          baseFontName: readBaseFontName(module, objPtr),
          fill: readFillColor(module, objPtr),
        });
      }
      return results;
    },
  );
}

/** Replaces one TEXT page object's string in place — no reflow, a single
 * object only. Reuses the ORIGINAL font when possible; falls back to a
 * standard PDFium font (chosen from the original's base font name) when the
 * original font is embedded and `newText` has a character `oldText` didn't,
 * since an embedded font is very likely a subset with no glyph for it — see
 * `needsFallbackFont`. */
function replaceTextObject(
  documentId: string,
  pageIndex: number,
  objectIndex: number,
  newText: string,
): TextEditReplaceResult {
  const { module, cache } = requirePdfium();
  const ctx = getPageContextOrThrow(cache, documentId);
  return ctx.borrowPage(
    pageIndex,
    (pageCtx: { pagePtr: number; getTextPage(): number }) => {
      const pagePtr = pageCtx.pagePtr;
      const textPagePtr = pageCtx.getTextPage();
      const objPtr = module.FPDFPage_GetObject(pagePtr, objectIndex);
      if (!objPtr) {
        throw new Error(
          `localvert:text — no page object at index ${objectIndex}`,
        );
      }
      if (module.FPDFPageObj_GetType(objPtr) !== PdfPageObjectType.TEXT) {
        throw new Error(
          `localvert:text — object ${objectIndex} is not a text object`,
        );
      }

      const oldText = readTextObjectString(module, objPtr, textPagePtr);
      const fontSize = readFontSize(module, objPtr);
      const matrix = readMatrix(module, objPtr);
      const fill = readFillColor(module, objPtr);
      const baseFontName = readBaseFontName(module, objPtr);
      // biome-ignore lint/suspicious/noExplicitAny: `DocumentContext.docPtr` isn't part of the public .d.ts (see `requirePdfium`'s doc comment).
      const docPtr = (ctx as any).docPtr as number;

      // Only an EMBEDDED font can be a glyph subset; a non-embedded font
      // (e.g. standard Helvetica) is resolved by the viewer and has every
      // character, so it never needs substituting.
      const fontEmbedded =
        module.FPDFFont_GetIsEmbedded(module.FPDFTextObj_GetFont(objPtr)) !== 0;
      const usedFallbackFont =
        fontEmbedded && needsFallbackFont(oldText, newText);
      const newObjPtr = usedFallbackFont
        ? module.FPDFPageObj_NewTextObj(
            docPtr,
            pickStandardFontName(baseFontName),
            fontSize,
          )
        : module.FPDFPageObj_CreateTextObj(
            docPtr,
            module.FPDFTextObj_GetFont(objPtr),
            fontSize,
          );
      if (!newObjPtr) {
        throw new Error(
          "localvert:text — failed to create the replacement text object",
        );
      }

      writeTextObjectText(module, newObjPtr, newText);
      writeMatrix(module, newObjPtr, matrix);
      module.FPDFPageObj_SetFillColor(
        newObjPtr,
        fill.r,
        fill.g,
        fill.b,
        fill.a,
      );
      module.FPDFPage_InsertObject(pagePtr, newObjPtr);
      module.FPDFPage_RemoveObject(pagePtr, objPtr);
      module.FPDFPageObj_Destroy(objPtr);
      module.FPDFPage_GenerateContent(pagePtr);

      return { usedFallbackFont };
    },
  );
}
