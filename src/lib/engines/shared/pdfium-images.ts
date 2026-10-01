/**
 * Picture extraction for `pdf-to-word` (docs/adr/0014-pdf-to-word.md,
 * "Images"). pdf.js has no usable position for an image without replaying the
 * content stream's transform stack by hand, but PDFium (the same wasm build
 * the PDF editor ships, `@embedpdf/pdfium`) hands each image object over with
 * its page-space bounds. So `pdfjs/adapter.ts`'s `extractLayout` op calls in
 * here, per page, for the pictures; text still comes from pdf.js.
 *
 * Worker-only: needs `fetch` for the wasm and `OffscreenCanvas` for PNG
 * encoding. The wasm is the `pdfium` engine's own static asset
 * (`ENGINE_MANIFEST.pdfium.baseUrl`), the exact URL the editor fetches, so a
 * visitor who already opened the editor has it in the HTTP cache.
 *
 * Per image object:
 *  - a lone `DCTDecode` filter means the stream is a JPEG file already: its
 *    raw bytes go straight through, no re-encode (unless it is CMYK, which
 *    Word shows wrongly, see `readJpegInfo`);
 *  - everything else is rendered by PDFium (`FPDFImageObj_GetRenderedBitmap`,
 *    which applies the soft mask, colour space and decode array) and encoded
 *    as PNG on an `OffscreenCanvas`.
 * Vector artwork and images nested inside form XObjects are not page-level
 * image objects and are not included.
 */
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { bytesToBase64 } from "./base64";
import { fetchAsset } from "./fetch-asset";
import { readJpegInfo } from "./jpeg-info";
import { imageRenderScale, type LayoutImage, MIN_IMAGE_PX } from "./pdf-layout";

/** `FPDF_PAGEOBJ_IMAGE` in fpdfview/fpdf_edit.h. */
const PAGEOBJ_IMAGE = 3;
/** Longest side of a PNG we write: a Word page never shows more, and a
 * 600-dpi scan would otherwise cost hundreds of MB of RGBA. */
const MAX_PNG_SIDE = 3000;
/** Hostile or enormous PDFs: stop after this many pictures per document. */
const MAX_IMAGES = 300;
/** Encoded picture bytes (before base64) one document may add up to. */
export const MAX_MEDIA_BYTES = 150 * 1024 * 1024;

/**
 * Pure budget check: may another picture of `nextBytes` go in when
 * `usedBytes` are already in? The first picture always fits, so one huge
 * scan is never dropped just for being big. Past that, the total stays at or
 * under `limit`.
 */
export function fitsMediaBudget(
  usedBytes: number,
  nextBytes: number,
  limit: number = MAX_MEDIA_BYTES,
): boolean {
  return usedBytes === 0 || usedBytes + nextBytes <= limit;
}
const FPDF_BITMAP_GRAY = 1;
const FPDF_BITMAP_BGR = 2;

let modulePromise: Promise<WrappedPdfiumModule> | undefined;

/** One wasm instance per worker; documents are opened and closed on it. */
function loadModule(
  wasmUrl: string,
  signal?: AbortSignal,
): Promise<WrappedPdfiumModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const { init } = await import("@embedpdf/pdfium");
      const wasmBinary = await fetchAsset(wasmUrl, { engine: "pdfjs", signal });
      const module = await init({
        wasmBinary: wasmBinary.buffer.slice(
          wasmBinary.byteOffset,
          wasmBinary.byteOffset + wasmBinary.byteLength,
        ) as ArrayBuffer,
      });
      module.PDFiumExt_Init();
      return module;
    })();
    // A failed load must not poison later jobs.
    modulePromise.catch(() => {
      modulePromise = undefined;
    });
  }
  return modulePromise;
}

export interface PdfiumImageSession {
  /** Pictures on one page (0-based), in no particular order. */
  pageImages(pageIndex: number): Promise<LayoutImage[]>;
  /** True once any picture was skipped for the count or size budget. */
  readonly leftOut: boolean;
  close(): void;
}

/** Emscripten exposes `HEAPU8` at runtime but the package's types omit it.
 * Read it fresh each time: a memory growth swaps the underlying buffer. */
function heap(module: WrappedPdfiumModule): Uint8Array {
  return (module.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
}

function withMalloc<T>(
  module: WrappedPdfiumModule,
  sizes: number[],
  fn: (ptrs: number[]) => T,
): T {
  const { malloc, free } = module.pdfium.wasmExports;
  const ptrs = sizes.map((size) => malloc(size));
  try {
    return fn(ptrs);
  } finally {
    for (const ptr of ptrs) free(ptr);
  }
}

function readFloats(module: WrappedPdfiumModule, ptrs: number[]): number[] {
  return ptrs.map((p) => module.pdfium.getValue(p, "float"));
}

/** Name of the image's only filter, or undefined for none / a filter chain. */
function singleFilter(
  module: WrappedPdfiumModule,
  objPtr: number,
): string | undefined {
  if (module.FPDFImageObj_GetImageFilterCount(objPtr) !== 1) return undefined;
  const len = module.FPDFImageObj_GetImageFilter(objPtr, 0, 0, 0);
  if (len <= 0) return undefined;
  return withMalloc(module, [len + 1], ([buf]) => {
    module.FPDFImageObj_GetImageFilter(objPtr, 0, buf as number, len + 1);
    return module.pdfium.UTF8ToString(buf as number);
  });
}

function rawStreamBytes(
  module: WrappedPdfiumModule,
  objPtr: number,
): Uint8Array | undefined {
  const len = module.FPDFImageObj_GetImageDataRaw(objPtr, 0, 0);
  if (len <= 0) return undefined;
  return withMalloc(module, [len], ([buf]) => {
    const written = module.FPDFImageObj_GetImageDataRaw(
      objPtr,
      buf as number,
      len,
    );
    if (written <= 0) return undefined;
    const start = buf as number;
    // Copy out of the wasm heap: it can grow (and detach this view) later.
    return heap(module).slice(start, start + written);
  });
}

interface RgbaBitmap {
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

/** PDFium's bitmap (BGRA / BGRx / BGR / gray, with a row stride) to RGBA. */
function readBitmap(
  module: WrappedPdfiumModule,
  bitmapPtr: number,
): RgbaBitmap | undefined {
  const width = module.FPDFBitmap_GetWidth(bitmapPtr);
  const height = module.FPDFBitmap_GetHeight(bitmapPtr);
  const stride = module.FPDFBitmap_GetStride(bitmapPtr);
  const format = module.FPDFBitmap_GetFormat(bitmapPtr);
  const bufPtr = module.FPDFBitmap_GetBuffer(bitmapPtr);
  if (!bufPtr || width <= 0 || height <= 0) return undefined;
  const bytesPer =
    format === FPDF_BITMAP_GRAY ? 1 : format === FPDF_BITMAP_BGR ? 3 : 4;
  const src = heap(module).subarray(bufPtr, bufPtr + stride * height);
  const rgba = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  for (let y = 0; y < height; y++) {
    let s = y * stride;
    let d = y * width * 4;
    for (let x = 0; x < width; x++, s += bytesPer, d += 4) {
      if (bytesPer === 1) {
        const g = src[s] ?? 0;
        rgba[d] = rgba[d + 1] = rgba[d + 2] = g;
        rgba[d + 3] = 255;
      } else {
        rgba[d] = src[s + 2] ?? 0;
        rgba[d + 1] = src[s + 1] ?? 0;
        rgba[d + 2] = src[s] ?? 0;
        // BGRA keeps its alpha; BGR and BGRx are opaque.
        rgba[d + 3] = format === 4 ? (src[s + 3] ?? 255) : 255;
      }
    }
  }
  return { width, height, rgba };
}

async function encodePng(bitmap: RgbaBitmap): Promise<Uint8Array> {
  const { width, height, rgba } = bitmap;
  const source = new OffscreenCanvas(width, height);
  const sourceCtx = source.getContext("2d");
  if (!sourceCtx) throw new Error("failed to acquire a 2d canvas context");
  sourceCtx.putImageData(new ImageData(rgba, width, height), 0, 0);

  let canvas = source;
  const longest = Math.max(width, height);
  if (longest > MAX_PNG_SIDE) {
    const scale = MAX_PNG_SIDE / longest;
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("failed to acquire a 2d canvas context");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, w, h);
  }
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Opens `pdfBytes` in PDFium. Returns `null` when PDFium can't open it (the
 * caller already parsed the same bytes with pdf.js, so this is rare); wasm
 * fetch failures throw.
 */
export async function openPdfiumImages(
  pdfBytes: Uint8Array,
  wasmUrl: string,
  signal?: AbortSignal,
): Promise<PdfiumImageSession | null> {
  const module = await loadModule(wasmUrl, signal);
  const { malloc, free } = module.pdfium.wasmExports;
  const filePtr = malloc(pdfBytes.length);
  heap(module).set(pdfBytes, filePtr);
  const docPtr = module.FPDF_LoadMemDocument(filePtr, pdfBytes.length, "");
  if (!docPtr) {
    free(filePtr);
    return null;
  }

  let emitted = 0;
  let usedBytes = 0;
  let leftOut = false;

  async function pageImages(pageIndex: number): Promise<LayoutImage[]> {
    const pagePtr = module.FPDF_LoadPage(docPtr, pageIndex);
    if (!pagePtr) return [];
    try {
      const rotation = module.FPDFPage_GetRotation(pagePtr);
      // Bounds are in unrotated page space; the page-size getters apply the
      // rotation, so swap them back for a quarter turn.
      const pageWidthPt =
        rotation % 2 === 1
          ? module.FPDF_GetPageHeightF(pagePtr)
          : module.FPDF_GetPageWidthF(pagePtr);
      if (!(pageWidthPt > 0)) return [];

      const out: LayoutImage[] = [];
      const seen = new Set<string>();
      const count = module.FPDFPage_CountObjects(pagePtr);
      for (let i = 0; i < count; i++) {
        const objPtr = module.FPDFPage_GetObject(pagePtr, i);
        if (!objPtr || module.FPDFPageObj_GetType(objPtr) !== PAGEOBJ_IMAGE) {
          continue;
        }

        const [pxW, pxH] = withMalloc(module, [4, 4], (ptrs) => {
          const ok = module.FPDFImageObj_GetImagePixelSize(
            objPtr,
            ptrs[0] as number,
            ptrs[1] as number,
          );
          return ok
            ? [
                module.pdfium.getValue(ptrs[0] as number, "i32"),
                module.pdfium.getValue(ptrs[1] as number, "i32"),
              ]
            : [0, 0];
        });
        if (!pxW || !pxH || pxW < MIN_IMAGE_PX || pxH < MIN_IMAGE_PX) continue;

        const [left, bottom, right, top] = withMalloc(
          module,
          [4, 4, 4, 4],
          (ptrs) => {
            module.FPDFPageObj_GetBounds(
              objPtr,
              ptrs[0] as number,
              ptrs[1] as number,
              ptrs[2] as number,
              ptrs[3] as number,
            );
            return readFloats(module, ptrs);
          },
        ) as [number, number, number, number];
        const widthPt = right - left;
        const heightPt = top - bottom;
        if (!(widthPt > 0) || !(heightPt > 0)) continue;

        let mime: LayoutImage["mime"] = "image/png";
        let encoded: Uint8Array | undefined;

        if (singleFilter(module, objPtr) === "DCTDecode") {
          const raw = rawStreamBytes(module, objPtr);
          const info = raw ? readJpegInfo(raw) : null;
          if (raw && info && (info.components === 1 || info.components === 3)) {
            mime = "image/jpeg";
            encoded = raw;
          }
        }
        if (!encoded) {
          // Render at the image's own resolution, not the page's 72 dpi: scale
          // the object (in memory only, the page is never saved) first.
          const scale = imageRenderScale(
            pxW,
            pxH,
            widthPt,
            heightPt,
            MAX_PNG_SIDE,
          );
          if (scale > 1.01) {
            module.FPDFPageObj_Transform(objPtr, scale, 0, 0, scale, 0, 0);
          }
          let bitmapPtr = module.FPDFImageObj_GetRenderedBitmap(
            docPtr,
            pagePtr,
            objPtr,
          );
          if (!bitmapPtr) bitmapPtr = module.FPDFImageObj_GetBitmap(objPtr);
          if (!bitmapPtr) continue;
          try {
            const bitmap = readBitmap(module, bitmapPtr);
            if (!bitmap) continue;
            encoded = await encodePng(bitmap);
          } finally {
            module.FPDFBitmap_Destroy(bitmapPtr);
          }
        }

        if (
          emitted >= MAX_IMAGES ||
          !fitsMediaBudget(usedBytes, encoded.length)
        ) {
          leftOut = true;
          continue;
        }
        usedBytes += encoded.length;
        const data = bytesToBase64(encoded);
        // The same picture drawn twice on one page (a repeated bullet or
        // watermark) is kept once.
        const key = `${mime}:${data}`;
        if (seen.has(key)) continue;
        seen.add(key);

        out.push({ top, widthPt, heightPt, pageWidthPt, mime, data });
        emitted++;
      }
      return out;
    } finally {
      module.FPDF_ClosePage(pagePtr);
    }
  }

  return {
    pageImages,
    get leftOut() {
      return leftOut;
    },
    close() {
      module.FPDF_CloseDocument(docPtr);
      free(filePtr);
    },
  };
}
