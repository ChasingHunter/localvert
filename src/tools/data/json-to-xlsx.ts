import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * The `data` engine's `transcode` op, json -> xlsx. Input JSON must be an
 * array of flat objects — the union of every object's keys (first-seen
 * order) becomes a bold header row, one data row per object, nested values
 * JSON-stringified into their cell (see `objectsToSheetData` in
 * `src/lib/engines/data/transforms.ts`). Anything else (not an array, or an
 * array of non-objects) is a clear thrown error, not a best-effort guess.
 * Always writes a single sheet named "Sheet1".
 */
export default defineTool({
  slug: "json-to-xlsx",
  category: "data",
  title: "JSON to Excel (XLSX)",
  description:
    "Convert a JSON array of objects to an Excel spreadsheet (.xlsx).",

  accepts: ["json"],
  produces: "xlsx",

  options: z.object({}),
  defaults: {},

  pipeline: [
    {
      op: "transcode",
      from: "json",
      to: "xlsx",
      candidates: [{ engine: "data" }],
    },
  ],

  batch: true,
});
