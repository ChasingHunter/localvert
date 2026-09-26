import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * `level` drives the pdf-lib engine's `COMPRESS_PRESETS` (downscale ceiling
 * + JPEG quality per level) — see `runCompress`'s doc comment there.
 * `describeFields`'s `control: "select"` always renders an enum value as
 * its own label (there's no separate label map — see `src/lib/options/
 * fields.ts`'s `describeField`), so the values themselves are the words a
 * user sees: "smallest"/"balanced"/"best", not the engine's internal
 * low/medium/high.
 */
export default defineTool({
  slug: "compress-pdf",
  category: "pdf",
  title: "Compress PDF",
  description:
    "Compress PDF — shrink PDF file size in your browser, no upload. " +
    "Re-encodes embedded images smaller; never makes the file bigger.",

  accepts: ["pdf"],
  produces: "pdf",

  options: z.object({
    level: z
      .enum(["smallest", "balanced", "best"])
      .meta({
        label: "Compression",
        control: "select",
        help: '"Smallest" shrinks images the most; "best" keeps the most quality.',
      })
      .default("balanced"),
  }),
  defaults: { level: "balanced" },

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
