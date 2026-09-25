import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * ADR-0008: arity `"many-to-one"` — every dropped jpg/png becomes its own
 * page, in the order the user arranges them via `FileOrderList`, embedded
 * by the `pdf-lib` engine's `runMergeImages`. One tool for both input
 * formats rather than separate `jpg-to-pdf`/`png-to-pdf` tools — nothing
 * about the pipeline differs by format, and a real drop is often mixed.
 *
 * No declared pipeline `from`/`to` (like `strip-exif.ts`): `accepts` lists
 * two formats, so there's no single fixed input format to declare — it
 * falls back to whichever format the first dropped file sniffs as, and the
 * pdf-lib engine re-sniffs every individual input by its own bytes anyway
 * (see the engine's own doc comment).
 */
export default defineTool({
  slug: "images-to-pdf",
  category: "pdf",
  title: "Images to PDF",
  description:
    "Combine JPG and PNG images into one PDF, one image per page, in the " +
    "order you choose. Free and private: runs in your browser, no upload.",

  accepts: ["jpg", "png"],
  produces: "pdf",

  options: z.object({
    pageSize: z
      .enum(["fit", "a4", "letter"])
      .meta({ label: "Page size", control: "select" }),
    orientation: z.enum(["auto", "portrait", "landscape"]).meta({
      label: "Orientation",
      control: "select",
      showWhen: { field: "pageSize", equals: ["a4", "letter"] },
    }),
    margin: z
      .number()
      .min(0)
      .max(144)
      .meta({
        label: "Margin",
        control: "number",
        unit: "pt",
        showWhen: { field: "pageSize", equals: ["a4", "letter"] },
      }),
  }),
  defaults: { pageSize: "fit", orientation: "auto", margin: 0 },

  pipeline: [{ op: "merge", candidates: [{ engine: "pdf-lib" }] }],

  batch: false,
  arity: "many-to-one",
  actionLabel: "Create PDF",
});
