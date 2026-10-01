import { defineTool } from "@/lib/registry";
import { csvInputDefaults, csvInputOptions } from "../_shared-options";

/**
 * Two curated steps (ADR-0015 addendum: multi-hop is a hand-written tool
 * file, never generic chaining). The `libreoffice` engine's import table
 * has no csv entry, so the `data` engine first writes the csv out as an
 * xlsx (`csv-to-xlsx`'s step), then `libreoffice` prints that to a PDF the
 * same way `excel-to-pdf` does. Options are `csv-to-xlsx`'s: the delimiter
 * and header handling decide how the csv is read.
 */
export default defineTool({
  slug: "csv-to-pdf",
  category: "document",
  title: "CSV to PDF",
  description:
    "Turn a CSV file into a PDF table. Needs a one-time 74 MB download on desktop.",

  accepts: ["csv"],
  produces: "pdf",

  options: csvInputOptions,
  defaults: csvInputDefaults,

  pipeline: [
    {
      op: "transcode",
      from: "csv",
      to: "xlsx",
      candidates: [{ engine: "data" }],
    },
    {
      op: "transcode",
      from: "xlsx",
      to: "pdf",
      candidates: [{ engine: "libreoffice" }],
    },
  ],

  batch: true,
});
