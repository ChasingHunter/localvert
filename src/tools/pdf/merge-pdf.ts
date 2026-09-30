import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * ADR-0008: arity `"many-to-one"` — every dropped PDF becomes one input to a
 * single `merge` job, in the order the user arranges them via
 * `FileOrderList` (`src/components/file-order-list.tsx`). No options: pages
 * are copied as-is, in file order.
 */
export default defineTool({
  slug: "merge-pdf",
  category: "pdf",
  categoryRank: 2,
  title: "Merge PDF",
  description: "Combine multiple PDFs into one file, in the order you choose.",

  accepts: ["pdf"],
  produces: "pdf",
  rank: 7,

  options: z.object({}),
  defaults: {},

  pipeline: [
    {
      op: "merge",
      from: "pdf",
      to: "pdf",
      candidates: [{ engine: "pdf-lib" }],
    },
  ],

  batch: false,
  arity: "many-to-one",
  actionLabel: "Merge PDFs",
});
