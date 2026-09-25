import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Adds `angle` degrees, clockwise, to whatever rotation each selected page
 * already carries — see the `pdf-lib` engine's `runRotate`. `pages` is the
 * shared page-range spec (`""` = every page), same dialect as `split-pdf`'s
 * `ranges` and `extract-pdf-pages`/`delete-pdf-pages`'s `pages`.
 */
export default defineTool({
  slug: "rotate-pdf",
  category: "pdf",
  title: "Rotate PDF",
  description:
    "Rotate pages in a PDF 90, 180 or 270 degrees. Free and private: runs " +
    "in your browser, no upload.",

  accepts: ["pdf"],
  produces: "pdf",

  options: z.object({
    pages: z.string().meta({
      label: "Pages",
      control: "text",
      help: 'Which pages to rotate — e.g. "1-3, 5" — or leave blank for every page.',
    }),
    angle: z
      .enum(["90", "180", "270"])
      .meta({ label: "Rotate", control: "select" }),
  }),
  defaults: { pages: "", angle: "90" },

  pipeline: [
    {
      op: "rotate",
      from: "pdf",
      to: "pdf",
      candidates: [{ engine: "pdf-lib" }],
    },
  ],

  batch: true,
});
