import { defineTool, imagePipeline } from "@/lib/registry";
import { imagesToPdfDefaults, imagesToPdfOptions } from "../_shared-options";

/**
 * Many-to-one sibling of `jpg-to-pdf` for TIFF input (ADR-0015 addendum:
 * curated multi-step tool, not generic chaining). `pdf-lib` only embeds
 * jpg/png, so each dropped file is first decoded and re-encoded to JPG
 * (`imagePipeline`'s steps), then the JPGs are merged. `engine-host` runs
 * every step before a `merge` once per input and merges the results in the
 * order the user arranged them.
 */
export default defineTool({
  slug: "tiff-to-pdf",
  category: "pdf",
  title: "TIFF to PDF",
  description:
    "Combine TIFF images into one PDF, one image per page, in the order you choose.",

  accepts: ["tiff"],
  produces: "pdf",

  options: imagesToPdfOptions,
  defaults: imagesToPdfDefaults,

  pipeline: [
    ...imagePipeline("tiff", "jpg"),
    {
      op: "merge",
      from: "jpg",
      to: "pdf",
      candidates: [{ engine: "pdf-lib" }],
    },
  ],

  batch: false,
  arity: "many-to-one",
  actionLabel: "Create PDF",
});
