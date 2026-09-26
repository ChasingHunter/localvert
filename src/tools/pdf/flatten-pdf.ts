import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Bakes every form field's current value into the page content and removes
 * the field itself — see the `pdf-lib` engine's `runFlatten`. No options: a
 * PDF with no form fields comes back byte-for-byte equivalent (just
 * re-saved), same "no-op is safe" contract as `compress-pdf` never returning
 * a bigger file.
 */
export default defineTool({
  slug: "flatten-pdf",
  category: "pdf",
  title: "Flatten PDF",
  description:
    "Make form fields and their values permanent, non-editable page " +
    "content. Free and private: runs in your browser, no upload.",

  accepts: ["pdf"],
  produces: "pdf",

  options: z.object({}),
  defaults: {},

  pipeline: [
    {
      op: "flatten",
      from: "pdf",
      to: "pdf",
      candidates: [{ engine: "pdf-lib" }],
    },
  ],

  batch: true,
});
