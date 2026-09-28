import { defineTool } from "@/lib/registry";
import { csvInputDefaults, csvInputOptions } from "../_shared-options";

/**
 * The `data` engine's `transcode` op, csv -> json (papaparse `header: true`
 * — see `src/lib/engines/data/transforms.ts`'s `csvToJson`). Options are
 * `csvInputOptions` (delimiter + "detect numbers and booleans"), shared
 * with `csv-to-xlsx` since both just parse the same csv into rows first.
 */
export default defineTool({
  slug: "csv-to-json",
  category: "data",
  title: "CSV to JSON",
  description: "Convert a CSV file to a JSON array of objects.",

  accepts: ["csv"],
  produces: "json",

  options: csvInputOptions,
  defaults: csvInputDefaults,

  pipeline: [
    {
      op: "transcode",
      from: "csv",
      to: "json",
      candidates: [{ engine: "data" }],
    },
  ],

  batch: true,
});
