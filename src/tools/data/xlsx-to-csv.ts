import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * The `data` engine's `transcode` op, xlsx -> csv: reads one sheet
 * (`sheet`, 1-based, default 1 — same convention as `xlsx-to-json`) and
 * writes it out as comma-delimited csv the same way `json-to-csv` does
 * (see `sheetDataToObjects`/`jsonToCsv` in `src/lib/engines/data/
 * transforms.ts`).
 */
export default defineTool({
  slug: "xlsx-to-csv",
  category: "data",
  title: "Excel (XLSX) to CSV",
  description: "Convert an Excel spreadsheet to a CSV file.",

  accepts: ["xlsx"],
  produces: "csv",

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
      to: "csv",
      candidates: [{ engine: "data" }],
    },
  ],

  batch: true,
});
