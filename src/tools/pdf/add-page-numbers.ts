import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Draws a page number label on every selected page — the `pdf-lib`
 * engine's `runAddPageNumbers`. Numbering always counts every page in the
 * document (`startAt` + each page's own 0-based index), even when `pages`
 * only selects some of them to actually label — see that function's doc
 * comment. `format`'s enum values double as their own select-option labels
 * (no separate label slot on a zod enum — same convention as
 * `csvInputOptions.delimiter` in `_shared-options.ts`).
 */
export default defineTool({
  slug: "add-page-numbers",
  category: "pdf",
  title: "Add Page Numbers to PDF",
  description: "Add page numbers to a PDF, in the corner or edge you choose.",

  accepts: ["pdf"],
  produces: "pdf",

  options: z.object({
    position: z
      .enum([
        "bottom-center",
        "bottom-right",
        "bottom-left",
        "top-center",
        "top-right",
        "top-left",
      ])
      .meta({ label: "Position", control: "select" }),
    format: z
      .enum(["1", "Page 1", "Page 1 of N", "1 / N"])
      .meta({ label: "Format", control: "select" }),
    startAt: z
      .number()
      .int()
      .min(1)
      .meta({ label: "Start at", control: "number" }),
    fontSize: z
      .number()
      .min(6)
      .max(72)
      .meta({ label: "Font size", control: "number", unit: "pt" }),
    margin: z
      .number()
      .min(0)
      .max(144)
      .meta({ label: "Margin", control: "number", unit: "pt" }),
    pages: z.string().meta({
      label: "Pages",
      control: "text",
      help: 'Which pages get a visible number, e.g. "1-3, 5". Leave blank for every page. Numbering still counts every page in the document.',
    }),
  }),
  defaults: {
    position: "bottom-center",
    format: "1",
    startAt: 1,
    fontSize: 11,
    margin: 24,
    pages: "",
  },

  pipeline: [
    {
      op: "addPageNumbers",
      from: "pdf",
      to: "pdf",
      candidates: [{ engine: "pdf-lib" }],
    },
  ],

  batch: true,
});
