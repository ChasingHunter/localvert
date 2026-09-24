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
    control?: "switch" | "select" | "slider" | "number" | "text";
    unit?: string;
    help?: string;
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
  | "resize"
  | "compress"
  | "rotate"
  | "merge"
  | "split"
  | "extract"
  | "ocr";

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
  candidates: readonly EngineCandidate[];
}

/** Drives the generated options form — no `label`/`control`, no form field. */
export interface OptionMeta {
  label: string;
  control: "switch" | "select" | "slider" | "number" | "text";
  unit?: string;
  help?: string;
}

export interface ToolDefinition<S extends z.ZodObject = z.ZodObject> {
  slug: string;
  category: Category;
  title: string;
  description: string;
  accepts: readonly FormatId[];
  produces: FormatId;
  options: S;
  defaults: z.infer<S>;
  pipeline: readonly PipelineStep[];
  batch: boolean;
  outputName?: (inputName: string, opts: z.infer<S>) => string;
}
