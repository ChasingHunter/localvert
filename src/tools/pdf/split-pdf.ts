import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * ADR-0008: arity `"one-to-many"` — one dropped PDF becomes one job that
 * produces N output files, listed on its job card with per-file downloads
 * plus "Download all (.zip)". Submits on drop, like a plain one-to-one tool
 * (`ToolRunner` only special-cases `"many-to-one"`'s submit flow).
 *
 * `ranges` is only read when `mode` is `"ranges"` — see the `pdf-lib`
 * engine's `buildParts`, which splits it on `;` into one output per segment,
 * each segment itself parsed by the shared `parsePageRange`
 * (`src/lib/registry/page-range.ts`).
 */
export default defineTool({
  slug: "split-pdf",
  category: "pdf",
  title: "Split PDF",
  description:
    "Split a PDF into separate files — one per page, or by custom page " +
    "ranges. Free and private: runs in your browser, no upload.",

  accepts: ["pdf"],
  produces: "pdf",

  options: z.object({
    mode: z
      .enum(["each", "ranges"])
      .meta({ label: "Split", control: "select" })
      .default("each"),
    ranges: z
      .string()
      .meta({
        label: "Page ranges",
        control: "text",
        help: 'Only used when Split is "ranges" — e.g. 1-3; 4-6 makes one file per range.',
      })
      .default(""),
  }),
  defaults: { mode: "each", ranges: "" },

  pipeline: [
    {
      op: "split",
      from: "pdf",
      to: "pdf",
      candidates: [{ engine: "pdf-lib" }],
    },
  ],

  batch: false,
  arity: "one-to-many",
});
