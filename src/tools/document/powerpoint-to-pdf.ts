import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * The `libreoffice` engine's `transcode` op (ADR-0012): pptx/ppt/odp -> pdf.
 * See `word-to-pdf.ts`'s doc comment for why this is a single generic step
 * (no declared `from`/`to`) covering every accepted presentation format.
 */
const options = z.object({});

export default defineTool({
  slug: "powerpoint-to-pdf",
  category: "document",
  categoryRank: 3,
  title: "PowerPoint to PDF",
  description:
    "Convert PowerPoint or OpenDocument Presentation files to PDF with LibreOffice. Needs a one-time 74 MB download on desktop.",

  accepts: ["pptx", "ppt", "odp"],
  produces: "pdf",

  options,
  defaults: {},

  pipeline: [
    {
      op: "transcode",
      candidates: [{ engine: "libreoffice" }],
    },
  ],

  batch: true,
});
