import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * The `data` engine's `transcode` op, json -> csv (papaparse `unparse`,
 * comma-delimited — see `src/lib/engines/data/transforms.ts`'s
 * `jsonToCsv`). Input JSON must be an array of flat objects, same
 * requirement as `json-to-xlsx`: the union of every object's keys becomes
 * the header row, nested values JSON-stringified into their cell. No
 * user-facing options — unlike the csv-*reading* tools, there's no
 * separator to guess on the way out.
 */
export default defineTool({
  slug: "json-to-csv",
  category: "data",
  categoryRank: 3,
  title: "JSON to CSV",
  description: "Convert a JSON array of objects to a CSV file.",

  accepts: ["json"],
  produces: "csv",

  options: z.object({}),
  defaults: {},

  pipeline: [
    {
      op: "transcode",
      from: "json",
      to: "csv",
      candidates: [{ engine: "data" }],
    },
  ],

  batch: true,
});
