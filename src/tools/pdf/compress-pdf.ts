import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * ADR-0013 + ADR-0017: `mode` drives the pdf-lib engine's `runCompress`.
 * `recommended` (the default, ADR-0017's 2026-09-30 addendum) re-encodes
 * embedded raster images with mozjpeg at a 150 dpi ceiling and quality 0.65;
 * `strong` does the same harder (96 dpi, 0.5); `lossless` only restructures
 * the file (object streams, unreferenced objects dropped), no image
 * recompression at all. `target-size`/`percent` walk a DPI/quality ladder and
 * stop at the first result that fits a byte budget, a direct MB figure or a
 * fraction of the source size. The old saved value `balanced` is still
 * accepted by the engine as `recommended`. `optionLabels` overrides the raw
 * enum value as the label a user sees.
 */
export default defineTool({
  slug: "compress-pdf",
  category: "pdf",
  categoryRank: 3,
  title: "Compress PDF",
  description:
    "Shrink a PDF. The default shrinks the images inside it; pick a target size or percentage if you need a number. Never makes the file bigger.",

  accepts: ["pdf"],
  produces: "pdf",
  rank: 4,

  options: z.object({
    mode: z
      .enum(["recommended", "lossless", "strong", "target-size", "percent"])
      .meta({
        label: "Compression",
        control: "select",
        help: "Recommended shrinks the images inside the PDF and looks almost the same. Lossless only tidies the file, so photo-heavy PDFs barely change.",
        optionLabels: {
          recommended: "Recommended",
          lossless: "Lossless (no quality loss)",
          strong: "Strong (smallest)",
          "target-size": "Target file size",
          percent: "Reduce by percentage",
        },
      })
      .default("recommended"),
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
  defaults: { mode: "recommended", targetSizeMB: 10, percent: 50 },
  // ADR-0017's "Estimates" addendum (2026-09-30): `target-size`/`percent`
  // stage a dropped file (live size estimate + an explicit Compress button)
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
  actionLabel: "Compress",
});
