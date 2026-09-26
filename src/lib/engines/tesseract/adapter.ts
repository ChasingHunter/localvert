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
const metadata = meta as Pick<
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
  return (
    op === "ocr" &&
    OCR_INPUT_FORMATS.includes(input) &&
    (output === "txt" || output === "pdf")
  );
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
      run(task, worker, (fn) => {
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
  setOnProgress: (fn: (fraction: number) => void) => void,
): Promise<EngineResult> {
  try {
    switch (task.op) {
      case "ocr":
        return await runOcr(task, worker, setOnProgress);
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

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:tesseract",
  supports,
  load,
});
