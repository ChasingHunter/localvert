import type { ToolDefinition } from "@/lib/registry/types";

/**
 * Which of a tool's own `mode` values should hold a dropped file back for an
 * explicit "Convert" instead of submitting on drop — see `ToolRunner`'s doc
 * comment on why: a target/percent job can be unreachable, so running it
 * immediately (today's behaviour for every mode) would burn a real encode
 * before the user has any idea whether the number they typed makes sense.
 * "Best quality" and every fixed-preset mode (`custom`/`lossless`/
 * `recommended`/`strong`) keep submitting on drop, unchanged.
 *
 * Kept in its own module with type-only imports: `ToolRunner` needs this on
 * every tool page's first load, and importing it from `./index` pulled all
 * the estimate maths and the video/audio planners into that bundle
 * (+2.9 KB gz on every tool page, 2026-09-30).
 */
const STAGE_MODES: Record<
  NonNullable<ToolDefinition["estimateKind"]>,
  readonly string[]
> = {
  video: ["target-size", "reduce-percent"],
  audio: ["target-size", "percent"],
  pdf: ["target-size", "percent"],
};

export function shouldStageForEstimate(
  estimateKind: ToolDefinition["estimateKind"],
  options: Readonly<Record<string, unknown>>,
): boolean {
  if (!estimateKind) return false;
  const mode = options.mode;
  return typeof mode === "string" && STAGE_MODES[estimateKind].includes(mode);
}
