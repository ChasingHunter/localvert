import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * ADR-0013: `mode` drives the pdf-lib engine's `runCompress` — `lossless`
 * (the default) re-saves with object streams and drops unreferenced objects,
 * no image recompression at all; `balanced`/`strong` additionally re-encode
 * embedded raster images per `COMPRESS_PRESETS` (downscale ceiling + JPEG
 * quality). `describeFields`'s `control: "select"` always renders an enum
 * value as its own label (there's no separate label map — see
 * `src/lib/options/fields.ts`'s `describeField`), so the values themselves
 * are the words a user sees.
 */
export default defineTool({
  slug: "compress-pdf",
  category: "pdf",
  title: "Compress PDF",
  description:
    "Shrink a PDF. The default is lossless, and stronger modes also shrink the images inside. Never makes the file bigger.",

  accepts: ["pdf"],
  produces: "pdf",
  rank: 4,

  options: z.object({
    mode: z
      .enum(["lossless", "balanced", "strong"])
      .meta({
        label: "Compression",
        control: "select",
        help: '"Lossless" only restructures the file; "strong" also shrinks images the most.',
        optionLabels: {
          lossless: "Lossless (no quality loss)",
          balanced: "Balanced",
          strong: "Strong (smallest)",
        },
      })
      .default("lossless"),
  }),
  defaults: { mode: "lossless" },

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
