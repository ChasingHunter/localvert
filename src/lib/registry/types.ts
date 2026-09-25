import type { z } from "zod";
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
    control?: "switch" | "select" | "slider" | "number" | "text" | "crop";
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
  | "render"
  | "ocr";

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
  control: "switch" | "select" | "slider" | "number" | "text" | "crop";
  unit?: string;
  help?: string;
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
}
