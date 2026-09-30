import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * ADR-0008: arity `"one-to-many"` — one dropped PDF becomes one job that
 * produces N output files, listed on its job card with per-file downloads
 * plus "Download all (.zip)". Submits on drop, like a plain one-to-one tool
 * (`ToolRunner` only special-cases `"many-to-one"`'s submit flow).
 *
 * `ranges` is only read when `mode` is `"ranges"` — see the `pdf-lib`
 * engine's `buildParts`, which splits it on `,` or `;` into one output per
 * item, each item itself parsed by the shared `parsePageRange`
 * (`src/lib/registry/page-range.ts`). It is `required` while `mode` is
 * `"ranges"` (hidden means not required), so a dropped file waits for it.
 */
export default defineTool({
  slug: "split-pdf",
  category: "pdf",
  categoryRank: 4,
  title: "Split PDF",
  description:
    "Split a PDF into separate files: one per page, or by custom page ranges.",

  accepts: ["pdf"],
  produces: "pdf",

  options: z.object({
    mode: z
      .enum(["each", "ranges"])
      .meta({
        label: "Split",
        control: "select",
        optionLabels: { each: "One file per page", ranges: "By page ranges" },
      })
      .default("each"),
    ranges: z
      .string()
      .meta({
        label: "Page ranges",
        control: "text",
        help: "e.g. 1-3, 4-6 makes one file per range. A page number on its own makes a one-page file.",
        required: true,
        showWhen: { field: "mode", equals: "ranges" },
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
  actionLabel: "Split PDF",
});
