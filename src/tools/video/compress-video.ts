import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Edit tool, same container in and out. ADR-0017 (2026-09-30) gives it four
 * modes, all handled in `src/lib/engines/mediabunny/adapter.ts`'s
 * `runVideo`/`runVideoTargetSize`:
 *
 * - `best-quality` (the default): a bits-per-pixel ceiling capped at 0.7x
 *   the source's own bitrate — never re-encodes bigger than the source, no
 *   quality number to pick (`video-planner.ts`'s `bestQualityVideoBitrateBps`).
 * - `custom`: the pre-existing three-way quality preset (kept under this
 *   mode rather than removed — old saved option objects that only ever set
 *   `quality`, from before this ADR, still parse: the enum's values are
 *   unchanged, just re-labelled "Custom quality" here).
 * - `target-size` / `reduce-percent`: a byte budget (MB, or % smaller),
 *   split across audio/overhead/video, with a resolution/fps step-down and
 *   a measure-and-retry loop so the result lands at or under the target —
 *   see the ADR's "Result contract" for the exact note wording each run
 *   produces.
 *
 * `maxHeight` is an optional resolution cap layered on top of every mode
 * (reuses the same preset vocabulary and `dimensionsForPreset` as
 * `resize-video`) — downscaling is often the biggest lever on file size for
 * source video shot well above web resolution, and it's also the upper
 * bound the target-size ladder steps down from.
 *
 * `neverLarger: true` (see that field's doc comment on `ToolDefinition`) is
 * the safety net underneath every mode's own bitrate math: even a good-faith
 * estimate can be wrong (an odd container, no bitrate metadata, a target
 * bigger than the source), so `job-engine.ts`'s own size check still has the
 * final word and hands back the original file if the result isn't actually
 * smaller. Enforced in `job-engine.ts` rather than inside the `mediabunny`
 * adapter, same reason as `compress-audio`: a large output here streams
 * straight to OPFS instead of living in memory (ADR-0010).
 */
export default defineTool({
  slug: "compress-video",
  category: "video",
  categoryRank: 1,
  title: "Compress Video",
  description:
    "Shrink a video's file size. Keep the best quality automatically, or aim for a target size like under 20 MB.",

  accepts: ["mp4", "mov", "webm", "mkv"],
  produces: "same",

  options: z.object({
    mode: z
      .enum(["best-quality", "custom", "target-size", "reduce-percent"])
      .meta({
        label: "Mode",
        control: "select",
        help: '"Custom quality" lets you pick a quality preset directly.',
        optionLabels: {
          "best-quality": "Best quality (recommended)",
          custom: "Custom quality",
          "target-size": "Target file size",
          "reduce-percent": "Reduce by percentage",
        },
      })
      .default("best-quality"),
    quality: z
      .enum(["low", "medium", "high"])
      .meta({
        label: "Custom quality",
        control: "select",
        optionLabels: { low: "Low", medium: "Medium", high: "High" },
        showWhen: { field: "mode", equals: "custom" },
      })
      .default("medium"),
    targetSizeMB: z
      .number()
      .min(0.1)
      .max(10_000)
      .meta({
        label: "Target size",
        control: "number",
        unit: "MB",
        showWhen: { field: "mode", equals: "target-size" },
      })
      // A real default rather than `.optional()` — see `compress-jpg`'s
      // identical `targetSizeKB` field for why `required` can't be combined
      // with `showWhen` here.
      .default(20),
    reducePercent: z
      .number()
      .int()
      .min(10)
      .max(90)
      .meta({
        label: "Reduce by",
        control: "slider",
        unit: "%",
        showWhen: { field: "mode", equals: "reduce-percent" },
      })
      .default(50),
    maxHeight: z
      .enum(["1080p", "720p", "480p", "none"])
      .meta({
        label: "Max resolution",
        control: "select",
        optionLabels: {
          "1080p": "1080p",
          "720p": "720p",
          "480p": "480p",
          none: "Keep original",
        },
        help: "Downscale if the source is taller than this",
      })
      .default("none"),
  }),
  defaults: {
    mode: "best-quality",
    quality: "medium",
    targetSizeMB: 20,
    reducePercent: 50,
    maxHeight: "none",
  },

  pipeline: [{ op: "transcode", candidates: [{ engine: "mediabunny" }] }],

  batch: true,
  neverLarger: true,
  // ADR-0017's "Estimates" addendum (2026-09-30): `target-size`/
  // `reduce-percent` stage a dropped file (live size estimate + an explicit
  // Convert button) instead of submitting on drop — see `ToolRunner`'s
  // `shouldStageForEstimate`. `best-quality`/`custom` are unaffected.
  estimateKind: "video",
  actionLabel: "Compress",
});
