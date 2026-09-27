import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * The `typst` engine's `transcode` op, md -> pdf (ADR-0011). Renders via a
 * generated Typst document (page setup + the vendored `cmarker` package) —
 * see `src/lib/engines/typst/template.ts`. Images referenced by the dropped
 * markdown are out of scope: they render as their alt text only (no network,
 * no filesystem image lookup — see that file's doc comment).
 */
const options = z.object({
  pageSize: z
    .enum(["a4", "letter"])
    .meta({ label: "Page size", control: "select" }),
  fontSize: z
    .enum(["10", "11", "12"])
    .meta({ label: "Font size", control: "select", unit: "pt" }),
});

export default defineTool({
  slug: "markdown-to-pdf",
  category: "document",
  title: "Markdown to PDF",
  description:
    "Convert a Markdown file to a paginated PDF in your browser, fully " +
    "offline. Files never leave your device.",

  accepts: ["md"],
  produces: "pdf",

  options,
  defaults: { pageSize: "a4", fontSize: "11" },

  pipeline: [
    {
      op: "transcode",
      from: "md",
      to: "pdf",
      candidates: [{ engine: "typst" }],
    },
  ],

  batch: true,
});
