import { defineTool } from "@/lib/registry";
import { csvInputDefaults, csvInputOptions } from "../_shared-options";

/**
 * The `data` engine's `transcode` op, csv -> xlsx: parses the csv the same
 * way `csv-to-json` does, then writes it out as a spreadsheet the same way
 * `json-to-xlsx` does (bold header row, single sheet named "Sheet1" — see
 * `objectsToSheetData` in `src/lib/engines/data/transforms.ts`). Options
 * are `csvInputOptions`, shared with `csv-to-json`.
 */
export default defineTool({
  slug: "csv-to-xlsx",
  category: "data",
  categoryRank: 1,
  title: "CSV to Excel (XLSX)",
  description: "Convert a CSV file to an Excel spreadsheet (.xlsx).",

  accepts: ["csv"],
  produces: "xlsx",

  options: csvInputOptions,
  defaults: csvInputDefaults,

  pipeline: [
    {
      op: "transcode",
      from: "csv",
      to: "xlsx",
      candidates: [{ engine: "data" }],
    },
  ],

  batch: true,
});
