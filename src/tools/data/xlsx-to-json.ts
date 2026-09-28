import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * The `data` engine's `transcode` op, xlsx -> json. Reads one sheet
 * (`sheet`, 1-based, default 1 — `read-excel-file`'s own `readSheet`
 * convention) and returns an array of objects keyed by that sheet's header
 * row (see `sheetDataToObjects` in `src/lib/engines/data/transforms.ts`).
 */
export default defineTool({
  slug: "xlsx-to-json",
  category: "data",
  title: "Excel (XLSX) to JSON",
  description: "Convert an Excel spreadsheet to a JSON array of objects.",

  accepts: ["xlsx"],
  produces: "json",

  options: z.object({
    sheet: z
      .number()
      .int()
      .min(1)
      .meta({
        label: "Sheet",
        control: "number",
        help: "Which sheet to read, counting from 1.",
      })
      .default(1),
  }),
  defaults: { sheet: 1 },

  pipeline: [
    {
      op: "transcode",
      from: "xlsx",
      to: "json",
      candidates: [{ engine: "data" }],
    },
  ],

  batch: true,
});
