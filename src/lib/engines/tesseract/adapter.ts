/**
 * `tesseract.js`'s package entry point (`src/index.js`, its `"main"`) does
 * `require('./worker/node')` unconditionally in `createWorker.js`, relying on
 * bundlers to honour its `package.json` `"browser"` field remap to
 * `./worker/browser` instead — Turbopack's support for that remap inside a
 * worker (not main-thread) bundle is unverified, and getting it wrong would
 * either bundle Node-only code into a worker chunk or hang the build the way
 * `libraw`'s self-referencing Emscripten glue did (see that adapter's doc
 * comment and the add-engine skill). Sidestepping the question entirely:
 * `dist/tesseract.esm.min.js` is tesseract.js's own prebuilt browser bundle
 * (its `"module"`-equivalent output for direct `<script type="module">`/CDN
 * use) — self-contained, zero Node requires, and (checked by hand against
 * the published file) it contains no `import.meta.url` self-reference and
 * spawns its own nested worker only via a plain `new Worker(workerPath)`
 * call with a URL this adapter supplies. It is loaded here at *runtime* from
 * this engine's own static asset directory, exactly like `pdfjs`'s
 * `pdf.mjs`/`pdf.worker.mjs` — never statically imported, so it never lands
 * in any bundler's dependency graph at all.
 *
 * `import type` is fully erased at compile time (no runtime module
 * resolution, no bundler trace), so it's safe to use purely for typing the
 * real, runtime-imported module below — same trick `pdfjs/adapter.ts` and
 * `libraw/adapter.ts` use for their own packages' types.
 */
import type * as TesseractNS from "tesseract.js";
import type { Operation, StepFormat } from "@/lib/registry";
import { FORMATS } from "@/lib/registry";
import { defineEngine } from "../define-engine";
import { EngineError, toEngineError } from "../errors";
import { ENGINE_MANIFEST } from "../manifest";
import type {
  EngineAdapter,
  EngineInput,
  EngineInstance,
  EngineLoadContext,
  EngineResult,
  EngineTask,
} from "../types";
import meta from "./engine.json";

/** See the doc comment on the same cast in `../canvas/adapter.ts`. */
const metadata = {
  ...(meta as Pick<
    EngineAdapter,
    "id" | "license" | "location" | "needsIsolation" | "heavy"
  >),
  // engine.json has no "version" for this engine (derived from its
  // installed npm package) -- pnpm gen resolves the real value into
  // manifest.ts, which this reads at build time. See docs/ENGINES.md,
  // "How engine assets ship".
  version: ENGINE_MANIFEST.tesseract.version,
} satisfies Pick<
  EngineAdapter,
  "id" | "version" | "license" | "location" | "needsIsolation" | "heavy"
>;

/** The only image formats `runOcr`'s input side accepts — mirrors the
 * `accepts` list on both OCR tools (`src/tools/image/image-to-text.ts`,
 * `src/tools/pdf/image-to-searchable-pdf.ts`). */
const OCR_INPUT_FORMATS: readonly StepFormat[] = ["jpg", "png", "webp", "bmp"];

/**
 * The exact bytes `wasm-feature-detect`'s own `simd()` check validates
 * (confirmed against its published source) — a minimal module whose only
 * instruction is a SIMD `v128` op, so `WebAssembly.validate` accepts it iff
 * the engine actually implements the proposal. Reimplemented locally rather
 * than depending on `wasm-feature-detect` directly: see `load`'s doc comment
 * for why this adapter picks the core file itself instead of letting
 * tesseract.js's own `getCore.js` do it.
 */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8,
  0, 65, 0, 253, 15, 253, 98, 11,
]);

function supportsSimd(): boolean {
  try {
    return WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  if (op === "ocr") {
    return (
      OCR_INPUT_FORMATS.includes(input) &&
      (output === "txt" || output === "pdf")
    );
  }
  if (op === "ocrPdf") return input === "pdf" && output === "pdf";
  return false;
}

/** Reads `task.input` down to the `Blob` tesseract.js's `recognize` wants —
 * its browser `loadImage` reads a `Blob`/`File` via `FileReader` directly
 * (confirmed against its published source), so no decoding of our own is
 * needed here. */
function inputToBlob(input: EngineInput): Blob {
  switch (input.kind) {
    case "blob":
      return input.blob;
    case "bytes":
      return new Blob([input.bytes]);
    case "opfs":
      throw new EngineError(
        "unsupported",
        "tesseract engine does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "tesseract expected a bytes/blob input, got a raster",
        { engine: metadata.id },
      );
  }
}

/**
 * Loads tesseract.js's browser bundle and spins up **one** nested tesseract
 * worker (a real, same-origin `Worker`, per `engine.json`'s `worker.min.js`
 * — allowed by ADR-0006's `worker-src 'self' blob:`), pinned for this
 * adapter instance's whole lifetime rather than one per `run()` call: the
 * whole point of `heavy: true` (a pinned worker with an idle TTL, per the
 * add-engine skill) is to pay the wasm-core + language-data load cost once,
 * not per job. `dispose()` tears it down when the pool reclaims this
 * instance.
 *
 * Every path handed to tesseract.js — `workerPath`, `corePath`, `langPath`
 * — is this engine's own `ctx.baseUrl`, never the library's jsdelivr CDN
 * defaults (`worker/browser/defaultOptions.js`,
 * `worker-script/browser/getCore.js`): invariant 1 (no network I/O outside
 * our own origin) and ADR-0006's `connect-src 'self' blob:` both depend on
 * it.
 *
 * `corePath` is an exact file, not a directory: passed a directory,
 * tesseract.js's own `worker-script/browser/getCore.js` probes
 * `wasm-feature-detect`'s `simd()` *and* `relaxedSimd()` and picks from
 * *four* tiers (relaxed-SIMD, SIMD, plain, each LSTM or not) — but
 * `tesseract.js-core`@6.1.2 (this app's installed version) predates the
 * relaxed-SIMD tier and ships no `-relaxedsimd-` files at all, so on a
 * browser that reports relaxed-SIMD support (e.g. current Chromium),
 * `getCore.js` tries to `importScripts` a file this engine never shipped and
 * the load fails outright (confirmed against a real Chromium run). Passing
 * an exact `.wasm.js` file — `getCore.js`'s own doc comment says a path
 * ending "js" is loaded as-is, no probing — sidesteps its detection
 * entirely; `supportsSimd` above (a plain SIMD probe, not relaxed-SIMD)
 * picks between the two tiers `engine.json` actually ships:
 * `tesseract-core-simd-lstm.wasm.js`/`.wasm` for the common case,
 * `tesseract-core-lstm.wasm.js`/`.wasm` as the no-SIMD fallback.
 *
 * `gzip: true` matches `eng.traineddata.gz`, the smaller "best_int" English
 * model (`@tesseract.js-data/eng`'s `4.0.0_best_int` variant — a few MB
 * instead of the full `4.0.0` model's ~11 MB). `cacheMethod: "none"` skips
 * tesseract.js's own IndexedDB write of the language data on top of the HTTP
 * cache/SW this app already has for its static assets — one cache, not two.
 */
async function load(ctx: EngineLoadContext): Promise<EngineInstance> {
  const imported = (await import(
    /* webpackIgnore: true */
    /* turbopackIgnore: true */
    /* @vite-ignore */
    `${ctx.baseUrl}tesseract.esm.min.js`
  )) as { default: typeof TesseractNS };
  const Tesseract = imported.default;

  const coreFile = supportsSimd()
    ? "tesseract-core-simd-lstm.wasm.js"
    : "tesseract-core-lstm.wasm.js";

  // Read by the shared `logger` below, set fresh by `runOcr` before each
  // `recognize()` call — tesseract.js's `logger` option is fixed at
  // `createWorker` time, but the worker itself is shared across every
  // `run()` this adapter instance handles, so the *callback* has to be
  // swappable per task instead.
  let currentOnProgress: ((fraction: number) => void) | undefined;

  const worker = await Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, {
    workerPath: `${ctx.baseUrl}worker.min.js`,
    corePath: `${ctx.baseUrl}${coreFile}`,
    langPath: ctx.baseUrl,
    workerBlobURL: false,
    gzip: true,
    cacheMethod: "none",
    logger: (m) => {
      if (m.status === "recognizing text") {
        currentOnProgress?.(m.progress);
      }
    },
  });

  return {
    run: (task) =>
      run(task, worker, ctx, (fn) => {
        currentOnProgress = fn;
      }),
    dispose: () => {
      // `terminate()` is async; the `EngineInstance` contract's `dispose()`
      // is not (see `../types.ts`) and nothing here needs to await the
      // teardown finishing — the pool has already stopped routing tasks to
      // this instance by the time it calls `dispose()`.
      void worker.terminate();
    },
  };
}

async function run(
  task: EngineTask,
  worker: TesseractNS.Worker,
  ctx: EngineLoadContext,
  setOnProgress: (fn: (fraction: number) => void) => void,
): Promise<EngineResult> {
  try {
    switch (task.op) {
      case "ocr":
        return await runOcr(task, worker, setOnProgress);
      case "ocrPdf":
        return await runOcrPdf(task, worker, ctx, setOnProgress);
      default:
        throw new EngineError(
          "unsupported",
          `tesseract cannot run op "${task.op}"`,
          { engine: metadata.id },
        );
    }
  } catch (e) {
    throw toEngineError(e, metadata.id);
  }
}

/**
 * ocr: image bytes -> plain text or a searchable PDF (an invisible OCR text
 * layer over the original page image), per `task.outputFormat`. `recognize`'s
 * `output` argument picks which of tesseract.js's several output formats to
 * actually compute — asking for only the one this task needs avoids paying
 * for hOCR/TSV/box output this adapter never reads.
 */
async function runOcr(
  task: EngineTask,
  worker: TesseractNS.Worker,
  setOnProgress: (fn: (fraction: number) => void) => void,
): Promise<EngineResult> {
  const { input, outputFormat, signal, onProgress } = task;
  signal.throwIfAborted();

  if (outputFormat !== "txt" && outputFormat !== "pdf") {
    throw new EngineError(
      "internal",
      `tesseract ocr requires a txt or pdf output, got "${outputFormat}"`,
      { engine: metadata.id },
    );
  }

  const blob = inputToBlob(input);
  signal.throwIfAborted();
  setOnProgress((fraction) => onProgress?.(fraction));

  const wantsPdf = outputFormat === "pdf";
  let result: TesseractNS.RecognizeResult;
  try {
    result = await worker.recognize(
      // tesseract.js's own `ImageLike` type (`index.d.ts`) only declares the
      // DOM-element/string shapes it accepts — a `Blob` is handled too (its
      // browser `loadImage`, read above), just not reflected in the .d.ts.
      blob as unknown as TesseractNS.ImageLike,
      {},
      { text: !wantsPdf, pdf: wantsPdf },
    );
  } catch (e) {
    throw new EngineError("decode-failed", "tesseract OCR failed", {
      engine: metadata.id,
      cause: e,
    });
  } finally {
    setOnProgress(() => {});
  }
  signal.throwIfAborted();
  onProgress?.(1);

  if (wantsPdf) {
    const pdfBytes = result.data.pdf;
    if (!pdfBytes || pdfBytes.length === 0) {
      throw new EngineError(
        "encode-failed",
        "tesseract produced no pdf output",
        { engine: metadata.id },
      );
    }
    return {
      kind: "bytes",
      bytes: new Uint8Array(pdfBytes).buffer,
      mime: FORMATS.pdf.mime,
    };
  }

  const text = result.data.text;
  if (text === undefined || text === null) {
    throw new EngineError("decode-failed", "tesseract produced no text", {
      engine: metadata.id,
    });
  }
  return {
    kind: "bytes",
    bytes: new TextEncoder().encode(text).buffer,
    mime: FORMATS.txt.mime,
  };
}

/** Same cap `pdfjs`'s own `render` op applies to a page selection — see its
 * `MAX_PAGES` doc comment. Applied here too since this op drives that same
 * op internally, over every page (no page-range option on this tool). */
const MAX_PAGES = 200;

/**
 * `render`'s own `dpi` option, picked so a standard Letter/A4 page's long
 * edge (~11-11.7in) lands just under ~3000px — close to the OCR-quality
 * "300 DPI" rule of thumb, while bounding the size of the per-page bitmap
 * this op holds at any one time (`pdfjs`'s own `MAX_DIMENSION_PX` — 8192 —
 * is a much looser backstop against a truly oversized page, not a memory
 * budget). Fixed rather than computed from each page's actual size: this op
 * has no cheap way to read page dimensions ahead of rendering (see this
 * function's doc comment below).
 */
const OCR_RENDER_DPI = 270;

/**
 * ocrPdf (pdf -> pdf, ADR-0008 follow-up — see `image-to-searchable-pdf.ts`'s
 * doc comment for why the original OCR tool stopped at single-page images):
 * render every page, OCR each one into its own one-page searchable PDF, then
 * merge them back into one document, in page order.
 *
 * This is a single composite op rather than a three-step pipeline
 * (`render` -> `ocr` -> `merge`) because `engine-host.ts`'s pipeline runner
 * only ever threads one `EngineResult` from a step into the next step's
 * `EngineInput` (`resultToInput`) — and `render`'s own result for a
 * multi-page document is `{kind: "files", files: [...]}`, one entry per
 * page, which that function explicitly refuses to convert ("a files result
 * cannot feed the next pipeline step"). Fanning N pages out to N `ocr` steps
 * and back into one `merge` step isn't a shape the current step model
 * expresses at all. Driving `pdfjs` and `pdf-lib`'s own adapters directly —
 * dynamically imported here, exactly like every adapter's own lazy
 * `import()` of its underlying library — sidesteps that gap without
 * changing the pipeline runner's contract for every other tool.
 *
 * Pages are rendered and OCR'd one at a time — `pdfjs`'s own `render` op
 * only ever returns a *whole* selection's pages together, so instead of
 * calling it once for every page (paying pdf parse + doc-load overhead N
 * times), this calls it once per page with `pages: String(pageNumber)`; each
 * page's rendered PNG bytes are OCR'd and then go out of scope (nothing here
 * holds more than one page's bitmap and one page's bytes at a time), and the
 * per-page searchable-PDF bytes accumulate instead — smaller than a raw
 * bitmap, and the only thing that must survive to the final merge.
 */
async function runOcrPdf(
  task: EngineTask,
  worker: TesseractNS.Worker,
  ctx: EngineLoadContext,
  setOnProgress: (fn: (fraction: number) => void) => void,
): Promise<EngineResult> {
  const { input, outputFormat, signal, onProgress } = task;
  signal.throwIfAborted();

  if (outputFormat !== "pdf") {
    throw new EngineError(
      "internal",
      `tesseract ocrPdf requires a pdf output, got "${outputFormat}"`,
      { engine: metadata.id },
    );
  }

  const pdfjsMod = await import("../pdfjs/adapter");
  const pdfjsInstance = await pdfjsMod.default.load({
    baseUrl: ENGINE_MANIFEST.pdfjs.baseUrl,
    capabilities: ctx.capabilities,
  });

  // Page count from parsing the document, not from rendering it: pdfjs's
  // `render` has no count-only mode, and rendering every page just to count
  // them would hold a whole document's bitmaps for nothing. pdf-lib is loaded
  // for the merge below anyway.
  if (input.kind !== "blob" && input.kind !== "bytes") {
    throw new EngineError(
      "unsupported",
      `ocrPdf needs the PDF's bytes, got a "${input.kind}" input`,
      { engine: metadata.id },
    );
  }
  const sourceBytes =
    input.kind === "blob" ? await input.blob.arrayBuffer() : input.bytes;
  let pageCount: number;
  try {
    const { PDFDocument } = await import("@cantoo/pdf-lib");
    const probe = await PDFDocument.load(sourceBytes.slice(0), {
      ignoreEncryption: true,
    });
    pageCount = probe.getPageCount();
  } catch (e) {
    throw toEngineError(e, "pdf-lib");
  }
  if (pageCount === 0) {
    throw new EngineError("internal", "ocrPdf found no pages to process", {
      engine: metadata.id,
    });
  }
  if (pageCount > MAX_PAGES) {
    throw new EngineError(
      "unsupported",
      `ocrPdf is capped at ${MAX_PAGES} pages per job; this document has ${pageCount}`,
      { engine: metadata.id },
    );
  }

  const pagePdfs: ArrayBuffer[] = [];
  for (let i = 0; i < pageCount; i++) {
    signal.throwIfAborted();
    const pageNumber = i + 1;

    const rendered = await pdfjsInstance.run({
      op: "render",
      // A fresh copy per page: pdfjs transfers the buffer it is given to its
      // own worker, detaching it, so the next page's render would fail.
      input: { kind: "bytes", bytes: sourceBytes.slice(0) },
      inputFormat: "pdf",
      outputFormat: "png",
      options: { pages: String(pageNumber), dpi: OCR_RENDER_DPI },
      signal,
    });
    if (rendered.kind !== "files" || rendered.files.length === 0) {
      throw new EngineError("internal", `failed to render page ${pageNumber}`, {
        engine: metadata.id,
      });
    }
    const pageFile = rendered.files[0];
    if (!pageFile) continue; // unreachable: guarded by the length check above
    signal.throwIfAborted();

    const pageResult = await runOcr(
      {
        op: "ocr",
        input: { kind: "bytes", bytes: pageFile.bytes },
        inputFormat: "png",
        outputFormat: "pdf",
        options: task.options,
        signal,
      },
      worker,
      setOnProgress,
    );
    if (pageResult.kind !== "bytes") {
      throw new EngineError(
        "internal",
        `OCR of page ${pageNumber} produced no pdf bytes`,
        { engine: metadata.id },
      );
    }
    pagePdfs.push(pageResult.bytes);
    onProgress?.((pageNumber / pageCount) * 0.9);
  }

  const pdfLibMod = await import("../pdf-lib/adapter");
  const pdfLibInstance = await pdfLibMod.default.load({
    baseUrl: ENGINE_MANIFEST["pdf-lib"].baseUrl,
    capabilities: ctx.capabilities,
  });
  const mergeInputs: EngineInput[] = pagePdfs.map((bytes) => ({
    kind: "bytes",
    bytes,
  }));
  const first = mergeInputs[0];
  if (!first) {
    // Unreachable: `pageCount === 0` is rejected above, so the loop above
    // always pushes at least one entry.
    throw new EngineError("internal", "ocrPdf produced no pages to merge", {
      engine: metadata.id,
    });
  }
  const merged = await pdfLibInstance.run({
    op: "merge",
    input: first,
    inputs: mergeInputs,
    inputFormat: "pdf",
    outputFormat: "pdf",
    options: {},
    signal,
  });
  pdfLibInstance.dispose();
  pdfjsInstance.dispose();
  if (merged.kind !== "bytes") {
    throw new EngineError("internal", "merge produced no pdf bytes", {
      engine: metadata.id,
    });
  }

  onProgress?.(1);
  return merged;
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:tesseract",
  supports,
  load,
});
