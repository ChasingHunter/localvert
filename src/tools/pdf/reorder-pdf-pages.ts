import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * The pdf-lib engine's `reorder` op — see `parsePageOrder`'s doc comment in
 * `src/lib/registry/page-range.ts` for the full grammar. Unlike
 * `extract-pdf-pages`/`delete-pdf-pages`'s shared `pages` spec, `order`
 * allows a range to run backwards ("6-4") and does not dedupe: repeating a
 * page number duplicates that page in the output, which is a legitimate use
 * of a reorder tool (e.g. "1, 1, 2, 3" to insert a copy of the cover page
 * right after itself). A page simply left out of `order` is dropped from
 * the output. `""` (the default) leaves the document unchanged — every page
 * copied in its original order.
 */
export default defineTool({
  slug: "reorder-pdf-pages",
  category: "pdf",
  title: "Reorder PDF Pages",
  description: "Rearrange, duplicate or drop pages in a PDF.",

  accepts: ["pdf"],
  produces: "pdf",

  options: z.object({
    order: z.string().meta({
      label: "New page order",
      control: "text",
      help: 'New page order, e.g. "3, 1, 2, 4-6". Pages you leave out are dropped.',
    }),
  }),
  defaults: { order: "" },

  pipeline: [
    {
      op: "reorder",
      from: "pdf",
      to: "pdf",
      candidates: [{ engine: "pdf-lib" }],
    },
  ],

  batch: true,
});
