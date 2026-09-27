import type { z } from "zod";
import type { AppId } from "./apps";
import type { Category } from "./categories";
import type { FormatId } from "./formats";

/**
 * Augments zod's `GlobalMeta` (the type `.meta()` accepts) with the fields
 * Localvert's option forms are generated from. This makes `.meta({label,
 * control, unit})` on a tool's option schema type-checked against `control`'s
 * real union, instead of the library default (`[k: string]: unknown`), which
 * would accept anything.
 */
declare module "zod/v4/core" {
  interface GlobalMeta {
    label?: string;
    control?:
      | "switch"
      | "select"
      | "slider"
      | "number"
      | "text"
      | "password"
      | "crop"
      | "hidden";
    unit?: string;
    help?: string;
    /**
     * UI-only step for a `slider`/`number` field, overriding
     * `describeFields`'s derived `(max - min) / 100` — deliberately not
     * zod's own `.step()`/`multipleOf` (`src/lib/options/fields.ts`), which
     * would *reject* an in-between value the slider itself can produce, e.g.
     * a quality slider with `step: 0.01` dragged to 0.853.
     */
    step?: number;
    /**
     * Marks this field as required *for the tool to run*, distinct from
     * zod-level validity — e.g. `protect-pdf`'s `password` is a valid
     * (empty-string) value per its schema (see that tool's own doc comment
     * on why it can't be a `.min(1)`-constrained field), but the engine
     * throws at runtime if it's left blank. `OptionsForm` disables the
     * run/convert action while any `required` field is empty or
     * whitespace-only — see `requiredFieldsSatisfied` in
     * `src/lib/options/fields.ts`.
     */
    required?: boolean;
    /**
     * Renders this field only while another field in the same options
     * object currently equals `equals` (or, for a list, equals one of its
     * entries) — e.g. `split-pdf`'s `ranges` field only makes sense once
     * `mode` is `"ranges"`. Checked against the form's *current* values, not
     * the schema's defaults; a field that becomes hidden keeps whatever
     * value it already had (`OptionsForm` never clears it), so toggling the
     * controlling field back doesn't lose what the user typed. See
     * `isFieldVisible` in `src/lib/options/fields.ts`.
     */
    showWhen?: {
      field: string;
      equals:
        | string
        | number
        | boolean
        | readonly (string | number | boolean)[];
    };
  }
}

/**
 * Generated from `src/lib/engines/<id>/engine.json` by `pnpm gen` — adding an
 * engine directory is what grows this union (see the `add-engine` skill).
 */
import type { EngineId } from "@/lib/engines/ids";

export type { EngineId };

export type Operation =
  | "transcode"
  /**
   * Phase 3c: video (mp4/mov/webm) -> gif, on the `mediabunny` engine's
   * `gif.ts` helper (ADR-0002's gifenc mitigation — see that ADR's dated
   * note). Samples frames at `options.fps` over `[options.start,
   * options.start + options.duration]`, scales to `options.width` and
   * gifenc-quantizes/encodes them. Never routed to ffmpeg.
   */
  | "toGif"
  | "decode"
  | "encode"
  | "resize"
  | "rotate"
  | "crop"
  | "strip"
  | "compress"
  | "merge"
  | "split"
  | "extract"
  | "reorder"
  | "protect"
  | "unlock"
  | "flatten"
  | "sanitize"
  /**
   * pdf -> pdf, `watermark-pdf`: stamps `options.text` across every selected
   * page (`pdf-lib/adapter.ts`'s `runWatermark`) — diagonal or horizontal,
   * centered/top/bottom, rotation-aware so the mark reads upright relative
   * to the viewer on a page with a non-zero `/Rotate`.
   */
  | "watermark"
  /**
   * pdf -> pdf, `add-page-numbers`: draws a page number label on every
   * selected page (`pdf-lib/adapter.ts`'s `runAddPageNumbers`); numbering
   * counts every page (`startAt` + index) even though only selected pages
   * get a visible label.
   */
  | "addPageNumbers"
  /**
   * E3 (page organizer): pdf (+ any number of inserted pdfs, via `inputs`,
   * ADR-0008's many-to-one shape) -> pdf. Rebuilds a document page-by-page
   * from `options.plan` (see `validatePlan` in
   * `src/lib/editor/page-organizer-plan.ts` for its exact shape) — each
   * entry either copies one page from one of the inputs (rotated by a
   * delta added to whatever rotation it already carries) or inserts a
   * blank page. Unlike `reorder` (same input, same pages, just
   * rearranged), this can pull pages from several documents and invent new
   * ones.
   */
  | "organize"
  | "render"
  /**
   * pdf -> txt, `pdf-to-text`: pdf.js text extraction (`pdfjs/adapter.ts`'s
   * `runExtractText`), one document -> one `.txt` file with pages separated
   * by a blank line (optionally headed by `options.pageMarkers`'s "--- Page
   * N ---"). Not `render` (pdf -> raster images) or `ocr` (image -> text via
   * tesseract) — this reads the PDF's own embedded text, no rasterisation.
   */
  | "extractText"
  | "ocr"
  /**
   * Composite op, `tesseract` only: pdf -> pdf, render each page (via a
   * dynamically-imported `pdfjs` adapter instance), OCR each page (this
   * adapter's own `ocr` machinery, reused in-process) and merge the
   * per-page searchable PDFs back into one (via a dynamically-imported
   * `pdf-lib` adapter instance) — all inside the same worker. See
   * `tesseract/adapter.ts`'s `runOcrPdf` doc comment for why this is a
   * single composite op rather than a multi-engine pipeline: the pipeline
   * model (`engine-host.ts`) only ever threads one `EngineResult` from step
   * to step, and a `"files"` (one-to-many) result — pdfjs `render`'s output
   * for a multi-page document — has no such single-value handoff.
   */
  | "ocrPdf"
  /**
   * pdf-lib only, `pdf-lib/adapter.ts`'s `runReplacePagesWithImages`. Never
   * wired into a tool's `pipeline` (no `defineTool` uses it) -- it's called
   * directly via `pool.run`, the same internal-only pattern
   * `src/lib/editor/flatten-forms.ts`'s `flattenExportedForms` already uses
   * for the PDF editor's own export step. Slice E4a (redaction): after
   * `redactTextInRects`/`applyAllRedactions` remove a redacted page's text,
   * this op replaces that page's content with a single rendered raster image
   * (rendered in `pdfium.worker.ts`, never on the main thread) so hidden
   * images/vector graphics under a marked box are gone too, not just the
   * text.
   */
  | "replacePagesWithImages";

/**
 * A pipeline step's input/output "format": either a real `FormatId` (bytes
 * of that format) or `"raster"`, the in-memory decoded-pixels intermediate
 * ADR-0007's image pipeline passes between steps (`RasterImage` in
 * `src/lib/engines/types.ts`). `decode`/`encode`/`resize`/`rotate`/`crop`
 * steps traffic in `"raster"` on at least one side; a byte-to-byte op like
 * `transcode` never does.
 */
export type StepFormat = FormatId | "raster";

/** Runtime capability probes — see `src/lib/router/` (Phase 0.4). */
export interface Capabilities {
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  offscreenCanvas: boolean;
  webCodecs: {
    videoDecoder: boolean;
    videoEncoder: boolean;
    audioDecoder: boolean;
    audioEncoder: boolean;
  };
  opfs: boolean;
  fileSystemAccess: boolean;
  hardwareConcurrency: number;
  deviceMemoryGb: number | null;
}

/**
 * One engine a pipeline step is willing to run on, in preference order. No
 * `when` means "always eligible" — see `defineTool`'s rule that the last
 * candidate of every step must be unconditional, so a step can never resolve
 * to nothing on some browser.
 */
export interface EngineCandidate {
  engine: EngineId;
  when?: (caps: Capabilities) => boolean;
}

export interface PipelineStep {
  op: Operation;
  /**
   * This step's declared input/output "format", for building the
   * `RunStep`s a pipeline dispatches — see `src/lib/workers/protocol.ts`.
   * `imagePipeline` (ADR-0007) always sets both. A tool built the old way,
   * with a single untyped step, may leave both unset; `job-engine.ts` then
   * falls back to (the file's sniffed format -> `produces`), same as before
   * this field existed.
   */
  from?: StepFormat;
  to?: StepFormat;
  candidates: readonly EngineCandidate[];
}

/** Drives the generated options form — no `label`/`control`, no form field. */
export interface OptionMeta {
  label: string;
  control:
    | "switch"
    | "select"
    | "slider"
    | "number"
    | "text"
    | "password"
    | "crop"
    | "hidden";
  unit?: string;
  help?: string;
  /** See the `required` doc comment on the `GlobalMeta` augmentation above. */
  required?: boolean;
  /** See the `showWhen` doc comment on the `GlobalMeta` augmentation above. */
  showWhen?: {
    field: string;
    equals: string | number | boolean | readonly (string | number | boolean)[];
  };
}

export interface ToolDefinition<S extends z.ZodObject = z.ZodObject> {
  slug: string;
  category: Category;
  title: string;
  description: string;
  accepts: readonly FormatId[];
  /**
   * The produced format, or `"same"` for a tool whose output format always
   * matches whichever `accepts` format the input actually sniffed as (e.g.
   * `strip-exif`, which takes jpg/png/webp and returns the same format it was
   * given). A single-step tool with no declared pipeline `from`/`to` (the
   * ADR-0007 legacy fallback — see `job-engine.ts`'s `buildSteps`) resolves
   * `"same"` to the file's own sniffed format at dispatch time, and
   * `outputFileName` (naming.ts) keeps the input's own extension instead of
   * swapping in a fixed one. Not valid pipeline `from`/`to` — those stay a
   * concrete `StepFormat`.
   */
  produces: FormatId | "same";
  options: S;
  defaults: z.infer<S>;
  pipeline: readonly PipelineStep[];
  batch: boolean;
  /**
   * "job" (default): the one-shot job pipeline runs `pipeline` against
   * whatever the user drops, through the existing dropzone/job-list UI (see
   * `ToolRunner`).
   *
   * "app": a stateful, self-contained tool — it renders its own component
   * (`app`) instead of going through the job pipeline. `pipeline`/`batch` are
   * still required by this type (most tools need them) but are ignored for
   * an "app" tool; `defineTool` doesn't validate them against anything for
   * this kind. Its route, SEO metadata and category listing are still
   * registry-derived, same as a job tool — only the on-page runner differs.
   * See ADR-0009 (the PDF editor) and `src/app/tools/[slug]/page.tsx`.
   */
  kind?: "job" | "app";
  /**
   * Required iff `kind` is "app": the id of this tool's own component,
   * resolved to an actual (lazily-loaded, `ssr: false`) component only by
   * `APP_COMPONENTS` in `src/components/app-registry.tsx` — a CLIENT module.
   *
   * A tool definition must never import UI directly. `src/tools/**` is
   * imported by the `src/tools/index.ts` barrel, which server components
   * (home, category and tool pages) import for their static listings; a tool
   * file containing so much as an `import()` of a "use client" component
   * makes Next register that component as a client reference for every page
   * that reaches this file through the barrel — not just the one page that
   * renders it — bundling the app's entire UI (here, `@embedpdf`/PDFium)
   * into every tool page's first load regardless of slug. Naming the app by
   * this string id instead keeps `src/tools/**` free of any `@/components`
   * reference, so nothing pulls the component in transitively. See
   * `defineTool`'s check that `app` is a known `AppId`, and
   * `src/tools/registry.test.ts`'s scan for stray `import(`s.
   */
  app?: AppId;
  outputName?: (inputName: string, opts: z.infer<S>) => string;
  /**
   * How many files this tool consumes and produces (ADR-0008). Defaults to
   * `"one-to-one"` (one file in, one file out — every tool before Phase 2),
   * so no existing tool needs this field at all.
   *
   * - `"one-to-one"`: unchanged. `batch: true` repeats it per dropped file
   *   (N independent jobs), same as always.
   * - `"many-to-one"`: N dropped files become **one** job that owns all N
   *   inputs, in the order the user arranged them (`FileOrderList`), and
   *   produces a single output (e.g. `merge-pdf`). Submission is explicit
   *   (an `actionLabel` button), not on-drop — see `defineTool`'s check that
   *   `batch` is `false` for this arity: "batch" (repeat per file) and
   *   "many-to-one" (combine every file into one job) are mutually
   *   exclusive readings of a multi-file drop.
   * - `"one-to-many"`: one dropped file becomes one job that produces N
   *   outputs (e.g. `split-pdf`), listed on its job card with per-file
   *   downloads plus "Download all (.zip)". Submits on drop like
   *   `"one-to-one"` — only one input file is ever involved.
   */
  arity?: "one-to-one" | "many-to-one" | "one-to-many";
  /**
   * Label for the explicit submit button a `"many-to-one"` tool shows
   * instead of submitting on drop (e.g. "Merge PDFs") — meaningless, and
   * unread, for any other arity.
   */
  actionLabel?: string;
  /**
   * Every option key whose `.meta({ required: true })` marks it as required
   * to run, in schema declaration order. Computed by `defineTool` itself
   * from `options`'s meta — never set this by hand in a tool file. Kept as
   * a plain string array (not re-derived from the zod schema) so
   * `ToolRunner` can read it without importing zod itself, the same reason
   * `app`/`kind` are read structurally instead — see invariant 3 and
   * `hasCropField`'s doc comment in `src/components/tool-runner.tsx`.
   */
  requiredOptionKeys?: readonly string[];
}
