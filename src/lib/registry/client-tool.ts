import type { FieldSpec } from "@/lib/options/field-spec";
import type { Category } from "./categories";
import type { FormatId } from "./formats";
import type {
  EngineId,
  Operation,
  ReadinessRule,
  StepFormat,
  ToolDefinition,
} from "./types";

/**
 * What the job engine needs from a tool to build and name a job. A full
 * `ToolDefinition` satisfies it (tests pass one straight in); so does a
 * `ClientTool`, which is how the app runs it.
 */
export type JobTool = Pick<
  ToolDefinition,
  "slug" | "category" | "arity" | "produces" | "pipeline" | "neverLarger"
> & {
  /** A function on a `ToolDefinition`; see `outputExtFromOption` for the
   * serialisable form. */
  outputName?: ToolDefinition["outputName"];
  outputExtFromOption?: string;
};

/** A pipeline step as plain data: `candidates` never carry a `when`. */
export interface ClientPipelineStep {
  op: Operation;
  from?: StepFormat;
  to?: StepFormat;
  candidates: readonly { engine: EngineId }[];
}

/**
 * ADR-0019: everything the main thread reads about a tool, as plain
 * serialisable data. The tool page (a server component) builds one per request
 * with `toClientTool` (`src/tools/client-tool.ts`) while the site is exported,
 * evaluating the tool's zod schema at build time, and hands it to `ToolRunner`
 * as a prop; the browser never loads the tool module, so zod (a ~90 KB gz
 * chunk) never runs on the main thread. The worker still imports the real tool
 * and runs `options.parse` before any engine sees the options.
 *
 * Deliberately a narrow view: anything a new main-thread feature needs from a
 * tool gets added here and to `toClientTool`.
 */
export interface ClientTool {
  slug: string;
  category: Category;
  accepts: readonly FormatId[];
  produces: FormatId | "same";
  batch: boolean;
  arity?: ToolDefinition["arity"];
  actionLabel?: string;
  rangeStage?: ToolDefinition["rangeStage"];
  estimateKind?: ToolDefinition["estimateKind"];
  neverLarger?: boolean;
  /** `outputName` as data: the output keeps the input's basename and takes
   * its extension from this option's value (`extract-audio`'s `format`). */
  outputExtFromOption?: string;
  readiness?: ReadinessRule;
  pipeline: readonly ClientPipelineStep[];
  /** Every option field, in schema order, crop and hidden ones included. */
  fields: readonly FieldSpec[];
  defaults: Record<string, unknown>;
}
