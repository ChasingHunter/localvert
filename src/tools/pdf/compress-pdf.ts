import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * ADR-0013 + ADR-0017: `mode` drives the pdf-lib engine's `runCompress` —
 * `lossless` (the default) re-saves with object streams and drops
 * unreferenced objects, no image recompression at all; `balanced`/`strong`
 * additionally re-encode embedded raster images with mozjpeg, downsampled by
 * effective DPI (`COMPRESS_PRESETS` in the adapter). `target-size`/`percent`
 * (ADR-0017) walk a DPI/quality ladder and stop at the first result that
 * fits a byte budget — a direct MB figure, or a fraction of the source size.
 * `describeFields`'s `control: "select"` always renders an enum value as its
 * own label (there's no separate label map — see `src/lib/options/
 * fields.ts`'s `describeField`), so the values themselves are the words a
 * user sees; `optionLabels` overrides that for `mode` below.
 */
export default defineTool({
  slug: "compress-pdf",
  category: "pdf",
  title: "Compress PDF",
  description:
    "Shrink a PDF. Pick a target size or percentage, or a fixed compression level. Never makes the file bigger.",

  accepts: ["pdf"],
  produces: "pdf",
  rank: 4,

  options: z.object({
    mode: z
      .enum(["lossless", "balanced", "strong", "target-size", "percent"])
      .meta({
        label: "Compression",
        control: "select",
        help: '"Lossless" only restructures the file; the other modes also shrink the images inside.',
        optionLabels: {
          lossless: "Lossless (no quality loss)",
          balanced: "Balanced",
          strong: "Strong (smallest)",
          "target-size": "Target file size",
          percent: "Reduce by percentage",
        },
      })
      .default("lossless"),
    targetSizeMB: z
      .number()
      .min(0.1)
      .max(2000)
      .meta({
        label: "Target size",
        control: "number",
        unit: "MB",
        showWhen: { field: "mode", equals: "target-size" },
      })
      .default(10),
    percent: z
      .number()
      .int()
      .min(10)
      .max(90)
      .meta({
        label: "Reduce by",
        control: "slider",
        unit: "%",
        showWhen: { field: "mode", equals: "percent" },
      })
      .default(50),
  }),
  defaults: { mode: "lossless", targetSizeMB: 10, percent: 50 },
  // ADR-0017's "Estimates" addendum (2026-09-30): `target-size`/`percent`
  // stage a dropped file (live size estimate + an explicit Convert button)
  // instead of submitting on drop — see `ToolRunner`'s
  // `shouldStageForEstimate`. The fixed-preset modes are unaffected.
  estimateKind: "pdf",

  pipeline: [
    {
      op: "compress",
      from: "pdf",
      to: "pdf",
      candidates: [{ engine: "pdf-lib" }],
    },
  ],

  batch: true,
});
