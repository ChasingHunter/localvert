import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * The `libreoffice` engine's `transcode` op (ADR-0012): xlsx/xls/ods -> pdf.
 * See `word-to-pdf.ts`'s doc comment for why this is a single generic step
 * (no declared `from`/`to`) covering every accepted spreadsheet format.
 */
const options = z.object({});

export default defineTool({
  slug: "excel-to-pdf",
  category: "document",
  title: "Excel to PDF",
  description:
    "Convert Excel, OpenDocument Spreadsheet files to PDF in your browser " +
    "with LibreOffice, fully offline. Needs a desktop browser and a " +
    "one-time ~74 MB download. Files never leave your device.",

  accepts: ["xlsx", "xls", "ods"],
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
