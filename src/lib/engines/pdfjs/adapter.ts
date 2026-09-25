/**
 * `pdfjs-dist` ships types for its documented package entry point
 * (`import * as pdfjsLib from "pdfjs-dist"`, i.e. `build/pdf.mjs`) — see
 * `load`'s doc comment below for why this adapter never actually imports
 * that specifier at runtime. `import type` is fully erased at compile time
 * (no runtime module resolution, no bundler trace), so it's safe to use
 * purely for typing the real, runtime-imported module down below — same
 * trick `libraw/adapter.ts` uses for `libraw-wasm`'s types.
 */
import type * as PdfjsNS from "pdfjs-dist";
import type { Operation, StepFormat } from "@/lib/registry";
import { FORMATS, parsePageRange } from "@/lib/registry";
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

/** ADR-0008 / add-engine skill: guards against a hostile or malformed PDF
 * turning one job into unbounded work. Checked against the pages actually
 * selected for this job (`options.pages`), not the document's raw page
 * count — a 1000-page book is fine if the user only asked for 3 pages. */
const MAX_PAGES = 200;

/** A page rendered above this many pixels on either side is rejected before
 * the OffscreenCanvas is even allocated — mirrors `libraw`'s `MAX_PIXELS`
 * guard in spirit (reject before the expensive work), sized here in pixels
 * per side rather than total pixels because a runaway `dpi` on a large-format
 * page (e.g. a poster-sized PDF) blows out one dimension long before it
 * blows out total megapixels. */
const MAX_DIMENSION_PX = 8192;

function supports(
  op: Operation,
  input: StepFormat,
  output: StepFormat,
): boolean {
  return (
    op === "render" && input === "pdf" && (output === "jpg" || output === "png")
  );
}

/** Reads one `EngineInput` down to an `ArrayBuffer`. Mirrors `pdf-lib/
 * adapter.ts`'s `inputToArrayBuffer` exactly — same contract, same engine
 * family. */
function inputToArrayBuffer(input: EngineInput): Promise<ArrayBuffer> {
  switch (input.kind) {
    case "blob":
      return input.blob.arrayBuffer();
    case "bytes":
      return Promise.resolve(input.bytes);
    case "opfs":
      throw new EngineError(
        "unsupported",
        "pdfjs engine does not read OPFS inputs",
        { engine: metadata.id },
      );
    case "raster":
      throw new EngineError(
        "internal",
        "pdfjs expected a blob/bytes input, got a raster",
        { engine: metadata.id },
      );
  }
}

/** See `pdf-lib/adapter.ts`'s `inputBaseName` — same contract, reused here
 * verbatim for naming `render`'s per-page output files. */
function inputBaseName(input: EngineInput, fallback: string): string {
  if (input.kind !== "blob") return fallback;
  const { blob } = input;
  const name =
    "name" in blob && typeof blob.name === "string" ? blob.name : undefined;
  if (!name) return fallback;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * `CanvasFactory` for `getDocument()` — pdf.js's own default
 * (`DOMCanvasFactory`) creates canvases via `document.createElement`, which
 * doesn't exist inside a worker. This mirrors `BaseCanvasFactory`'s exact
 * `create`/`reset`/`destroy` contract (read from pdf.js's own published
 * source — it isn't part of the package's public exports, so it can't be
 * imported and extended) but backs it with `OffscreenCanvas`, the same
 * primitive `canvas/adapter.ts` uses for every raster op. Passed as the
 * class itself, not an instance — `getDocument` does `new CanvasFactory(...)`
 * internally.
 */
class OffscreenCanvasFactory {
  create(
    width: number,
    height: number,
  ): { canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D } {
    if (width <= 0 || height <= 0) {
      throw new Error("Invalid canvas size");
    }
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("failed to acquire a 2d canvas context");
    }
    return { canvas, context };
  }
  reset(
    canvasAndContext: { canvas: OffscreenCanvas | null },
    width: number,
    height: number,
  ): void {
    if (!canvasAndContext.canvas) {
      throw new Error("Canvas is not specified");
    }
    if (width <= 0 || height <= 0) {
      throw new Error("Invalid canvas size");
    }
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext: {
    canvas: OffscreenCanvas | null;
    context: unknown;
  }): void {
    if (!canvasAndContext.canvas) {
      throw new Error("Canvas is not specified");
    }
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

/**
 * `FilterFactory` for `getDocument()` — pdf.js's own default
 * (`DOMFilterFactory`) lazily builds an SVG `<div>`/`<defs>` tree via
 * `document.createElement` the first time a PDF actually needs a colour
 * filter (soft masks, highlight annotations, forced-colours mode — not
 * every page hits this path, which is why a naive port would pass tests on
 * simple fixtures and then throw on a real-world PDF that does). Every
 * method here is a no-op returning `"none"`/`null`, exactly matching
 * `BaseFilterFactory` (pdf.js's own fallback for environments with no DOM —
 * again, not itself exported, so reimplemented rather than imported) —
 * losing the CSS filter effects those PDFs would apply is an acceptable
 * trade rather than crashing.
 */
class NoopFilterFactory {
  addFilter(): string {
    return "none";
  }
  addHCMFilter(): string {
    return "none";
  }
  addAlphaFilter(): string {
    return "none";
  }
  addLuminosityFilter(): string {
    return "none";
  }
  addKnockoutFilter(): string {
    return "none";
  }
  addHighlightHCMFilter(): string {
    return "none";
  }
  addSelectionHCMFilter(): string {
    return "none";
  }
  addSelectionFilter(): string {
    return "none";
  }
  createSelectionStyle(): null {
    return null;
  }
  destroy(): void {}
}

/**
 * pdf.js normally spawns its own dedicated `Worker` and fetches
 * `pdf.worker.mjs` into it (`PDFWorker#initialize` in pdf.mjs) — we're
 * already inside our own worker (ADR-0008's "run pdf.js's fake worker
 * in-thread"), so this imports the worker module directly instead of
 * letting pdf.js spin up a *second*, nested one. `PDFWorker`'s own
 * `#mainThreadWorkerMessageHandler` getter checks `globalThis.pdfjsWorker`
 * first and, when it's set, skips `new Worker(...)` entirely and wires up
 * the "fake worker" path (`LoopbackPort`, same-thread message passing)
 * instead — confirmed by reading `PDFWorker#initialize`/`#setupFakeWorker`'s
 * published source in `pdf.mjs`. `GlobalWorkerOptions.workerSrc` is set too,
 * belt and braces: `_setupFakeWorkerGlobal`'s own loader falls back to
 * importing it directly if `pdfjsWorker` somehow isn't picked up, and it
 * must point at our own origin regardless (`ctx.baseUrl`, never a CDN —
 * invariant 1).
 *
 * Both modules are runtime-imported from this engine's own versioned asset
 * directory, never statically imported: a static `import("pdfjs-dist")`
 * would bundle ~3 MB of pdf.js straight into whatever chunk this adapter
 * lands in instead of the separately-fetched, versioned, cacheable-forever
 * static asset under `ctx.baseUrl` — invariant 3 (no engine in the core
 * bundle), the same reasoning as every other engine's `load()`. Unlike
 * `libraw`'s Emscripten glue, neither `pdf.mjs` nor `pdf.worker.mjs`
 * self-references via `new Worker(new URL(..., import.meta.url))` (checked
 * by hand against the published bundle before writing this — see the
 * add-engine skill's bundler-hang warning), so the ignore directives below
 * are purely about asset placement, not a Turbopack-hang risk.
 *
 * `pdfjs-dist` 6.3.289 has no `isEvalSupported` option — grepping the
 * published `pdf.mjs`/`pdf.worker.mjs` for `eval(`/`new Function(` turns up
 * zero matches, so there's nothing left for that flag to gate; it was
 * removed from this version's public API (`DocumentInitParameters` has no
 * such field). ADR-0006's no-eval CSP is satisfied structurally instead —
 * this build simply never calls `eval`/`Function`.
 */
async function load(ctx: EngineLoadContext): Promise<EngineInstance> {
  const workerModule = await import(
    /* webpackIgnore: true */
    /* turbopackIgnore: true */
    /* @vite-ignore */
    `${ctx.baseUrl}pdf.worker.mjs`
  );
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = workerModule;

  const pdfjsLib = (await import(
    /* webpackIgnore: true */
    /* turbopackIgnore: true */
    /* @vite-ignore */
    `${ctx.baseUrl}pdf.mjs`
  )) as typeof PdfjsNS;
  pdfjsLib.GlobalWorkerOptions.workerSrc = `${ctx.baseUrl}pdf.worker.mjs`;

  return { run: (task) => run(task, pdfjsLib, ctx.baseUrl), dispose };
}

async function run(
  task: EngineTask,
  pdfjsLib: typeof PdfjsNS,
  baseUrl: string,
): Promise<EngineResult> {
  try {
    switch (task.op) {
      case "render":
        return await runRender(task, pdfjsLib, baseUrl);
      default:
        throw new EngineError(
          "unsupported",
          `pdfjs cannot run op "${task.op}"`,
          { engine: metadata.id },
        );
    }
  } catch (e) {
    throw toEngineError(e, metadata.id);
  }
}

/**
 * render (pdf -> N jpg/png files, ADR-0008 one-to-many): opens the document
 * with no nested worker (see `load`), rasterises each selected page to an
 * `OffscreenCanvas` at `options.dpi / 72` scale, and encodes it. `background`
 * is pdf.js's own `page.render()` knob for what `beginDrawing` fills the
 * canvas with before painting page content (pdf.js always fills *something*
 * first — a PDF page has no independent notion of its own transparency) —
 * `"#ffffff"` for jpg (no alpha channel: a transparent fill would just leave
 * black), `"rgba(0,0,0,0)"` for png so whatever alpha the page content itself
 * carries survives instead of being flattened onto white.
 */
async function runRender(
  task: EngineTask,
  pdfjsLib: typeof PdfjsNS,
  baseUrl: string,
): Promise<EngineResult> {
  const { input, outputFormat, options, signal, onProgress } = task;
  signal.throwIfAborted();

  if (outputFormat !== "jpg" && outputFormat !== "png") {
    throw new EngineError(
      "internal",
      "pdfjs render requires a jpg or png output",
      { engine: metadata.id },
    );
  }

  const bytes = new Uint8Array(await inputToArrayBuffer(input));
  signal.throwIfAborted();
  const base = inputBaseName(input, "document");

  const loadingTask = pdfjsLib.getDocument({
    data: bytes,
    isOffscreenCanvasSupported: true,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    cMapUrl: `${baseUrl}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${baseUrl}standard_fonts/`,
    // pdf.js types both of these as the loose `Object` (its own JSDoc source
    // has no exported interface for either factory) — see
    // `OffscreenCanvasFactory`/`NoopFilterFactory`'s own doc comments for why
    // a real DOM-backed factory can't be used here instead.
    CanvasFactory: OffscreenCanvasFactory,
    FilterFactory: NoopFilterFactory,
    stopAtErrors: true,
  });

  try {
    let doc: PdfjsNS.PDFDocumentProxy;
    try {
      doc = await loadingTask.promise;
    } catch (e) {
      if (e instanceof pdfjsLib.PasswordException) {
        throw new EngineError(
          "unsupported",
          "This PDF is password-protected — unlock it first",
          { engine: metadata.id, cause: e },
        );
      }
      throw new EngineError("decode-failed", "failed to parse PDF", {
        engine: metadata.id,
        cause: e,
      });
    }

    signal.throwIfAborted();

    const pagesSpec = typeof options.pages === "string" ? options.pages : "";
    const indices = parsePageRange(pagesSpec, doc.numPages);
    if (indices.length === 0) {
      throw new EngineError("internal", "render produced no output pages", {
        engine: metadata.id,
      });
    }
    if (indices.length > MAX_PAGES) {
      throw new EngineError(
        "unsupported",
        `render is capped at ${MAX_PAGES} pages per job; this selection has ${indices.length}`,
        { engine: metadata.id },
      );
    }

    const dpi = typeof options.dpi === "number" ? options.dpi : 150;
    const scale = Math.min(300, Math.max(72, dpi)) / 72;
    const quality = clamp01(
      typeof options.quality === "number" ? options.quality : 0.85,
    );
    const mime = FORMATS[outputFormat].mime;
    const background = outputFormat === "jpg" ? "#ffffff" : "rgba(0,0,0,0)";

    const files: { name: string; bytes: ArrayBuffer; mime: string }[] = [];
    for (let i = 0; i < indices.length; i++) {
      signal.throwIfAborted();
      const pageIndex = indices[i];
      if (pageIndex === undefined) continue; // unreachable: i < indices.length
      const pageNumber = pageIndex + 1; // pdf.js pages are 1-based

      const page = await doc.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale });
        // pdf.js's own Node examples floor the viewport size the same way —
        // an OffscreenCanvas needs integer dimensions, and flooring (not
        // rounding) never asks the canvas to be bigger than what `viewport`
        // itself will actually paint.
        const width = Math.floor(viewport.width);
        const height = Math.floor(viewport.height);
        if (width > MAX_DIMENSION_PX || height > MAX_DIMENSION_PX) {
          throw new EngineError(
            "unsupported",
            `page ${pageNumber} would render at ${width}x${height}px, over the ${MAX_DIMENSION_PX}px-per-side cap — lower the dpi`,
            { engine: metadata.id },
          );
        }

        const canvas = new OffscreenCanvas(width, height);
        const canvasContext = canvas.getContext("2d");
        if (!canvasContext) {
          throw new EngineError(
            "internal",
            "failed to acquire a 2d canvas context",
            { engine: metadata.id },
          );
        }

        try {
          // pdf.js's own `.d.ts` types `canvas` as the primary (required,
          // `HTMLCanvasElement | null`) param and `canvasContext` as a
          // `CanvasRenderingContext2D`-only legacy fallback — there's no
          // typed path for an `OffscreenCanvasRenderingContext2D`, even
          // though the library fully supports one at runtime (the whole
          // reason a worker can render at all without a DOM). The JSDoc is
          // explicit that `canvas: null` plus `canvasContext` is the
          // supported way to render straight to a context instead of a
          // canvas element, so this casts to the real runtime parameter
          // shape rather than fighting a `.d.ts` gap that doesn't reflect
          // an actual runtime restriction.
          const renderParams = {
            canvas: null,
            canvasContext,
            viewport,
            background,
          } as unknown as Parameters<PdfjsNS.PDFPageProxy["render"]>[0];
          await page.render(renderParams).promise;
        } catch (e) {
          throw new EngineError(
            "decode-failed",
            `failed to render page ${pageNumber}`,
            { engine: metadata.id, cause: e },
          );
        }
        signal.throwIfAborted();

        const encoded = await canvas.convertToBlob(
          outputFormat === "jpg" ? { type: mime, quality } : { type: mime },
        );
        if (encoded.type !== mime) {
          throw new EngineError(
            "encode-failed",
            `browser cannot encode ${mime}`,
            { engine: metadata.id },
          );
        }
        const outBytes = await encoded.arrayBuffer();
        files.push({
          name: `${base}-page-${pageNumber}.${outputFormat}`,
          bytes: outBytes,
          mime,
        });
      } finally {
        page.cleanup();
      }
      onProgress?.((i + 1) / indices.length);
    }

    return { kind: "files", files };
  } finally {
    await loadingTask.destroy();
  }
}

function dispose(): void {
  // No lingering engine-owned resource to free — each `run()` call opens and
  // destroys its own `PDFDocumentLoadingTask` (see `runRender`'s `finally`).
  // Unlike an Emscripten wasm engine, there's no wasm heap that only a
  // worker-terminate can reclaim; pdf.js's own JS objects are ordinary
  // garbage once nothing references them.
}

export default defineEngine({
  ...metadata,
  // Checked by check-sizes.ts against built chunks — must be a string
  // literal (see EngineMarker's doc comment in ../types.ts), never computed.
  marker: "localvert-engine:pdfjs",
  supports,
  load,
});
