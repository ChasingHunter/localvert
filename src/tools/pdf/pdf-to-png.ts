import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * See `pdf-to-jpg.ts`'s doc comment for the shared shape (ADR-0008
 * one-to-many, `pages`/`dpi`). No `quality` field here — PNG is lossless,
 * same reasoning as `pngOptions` in `../_shared-options.ts` being empty.
 * pdf.js's own `render({background: "rgba(0,0,0,0)"})` keeps whatever alpha
 * the page content itself carries instead of flattening it onto white, so a
 * PDF page with transparent regions renders as a transparent PNG.
 */
export default defineTool({
  slug: "pdf-to-png",
  category: "pdf",
  title: "PDF to PNG",
  description:
    "Convert PDF to PNG — every page as an image, privately in your " +
    "browser. Free and private: choose a page range and resolution, no upload.",

  accepts: ["pdf"],
  produces: "png",

  options: z.object({
    pages: z
      .string()
      .meta({
        label: "Pages",
        control: "text",
        help: "e.g. 1-3, 5 — empty for all",
      })
      .default(""),
    dpi: z
      .number()
      .int()
      .min(72)
      .max(300)
      .meta({ label: "Resolution", control: "slider", unit: "dpi", step: 1 })
      .default(150),
  }),
  defaults: { pages: "", dpi: 150 },

  pipeline: [
    {
      op: "render",
      from: "pdf",
      to: "png",
      candidates: [{ engine: "pdfjs" }],
    },
  ],

  batch: false,
  arity: "one-to-many",
});
