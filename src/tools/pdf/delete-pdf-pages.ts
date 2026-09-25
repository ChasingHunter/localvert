import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * The pdf-lib engine's `extract` op run in `mode: "remove"` — `pages` names
 * the pages to drop, every other page survives in its original order.
 * `mode` isn't a user choice (there is no dropdown for it): a fixed
 * `control: "hidden"` field carries it from this tool's own `defaults`
 * through to `EngineTask.options` without ever appearing in the rendered
 * form — see the "hidden" case in `src/lib/options/fields.ts`. Sibling tool:
 * `extract-pdf-pages` (`mode: "keep"`), same op, opposite selection.
 */
export default defineTool({
  slug: "delete-pdf-pages",
  category: "pdf",
  title: "Delete PDF Pages",
  description:
    "Remove specific pages from a PDF, keeping the rest in order. Free and " +
    "private: runs in your browser, no upload.",

  accepts: ["pdf"],
  produces: "pdf",

  options: z.object({
    pages: z.string().meta({
      label: "Pages to delete",
      control: "text",
      help: 'e.g. "2, 4-6" — every other page is kept, in order.',
    }),
    mode: z.enum(["remove"]).meta({ label: "Mode", control: "hidden" }),
  }),
  defaults: { pages: "", mode: "remove" },

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
