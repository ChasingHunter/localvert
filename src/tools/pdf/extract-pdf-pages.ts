import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * The pdf-lib engine's `extract` op run in `mode: "keep"` — `pages` names
 * the pages to keep, output in the given order (not re-sorted, so "3, 1"
 * puts the original page 3 first). `mode` isn't a user choice — see
 * `delete-pdf-pages.ts`'s doc comment on the `control: "hidden"` field it
 * shares this shape with. Sibling tool: `delete-pdf-pages`
 * (`mode: "remove"`), same op, opposite selection.
 */
export default defineTool({
  slug: "extract-pdf-pages",
  category: "pdf",
  title: "Extract PDF Pages",
  description:
    "Pull specific pages out of a PDF into a new file, in the order you " +
    "choose. Free and private: runs in your browser, no upload.",

  accepts: ["pdf"],
  produces: "pdf",

  options: z.object({
    pages: z.string().meta({
      label: "Pages to keep",
      control: "text",
      help: 'e.g. "1-3, 5" — only these pages, in this order, end up in the output.',
    }),
    mode: z.enum(["keep"]).meta({ label: "Mode", control: "hidden" }),
  }),
  defaults: { pages: "", mode: "keep" },

  pipeline: [
    {
      op: "extract",
      from: "pdf",
      to: "pdf",
      candidates: [{ engine: "pdf-lib" }],
    },
  ],

  batch: true,
});
