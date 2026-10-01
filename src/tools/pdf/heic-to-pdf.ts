import { defineTool, imagePipeline } from "@/lib/registry";
import { imagesToPdfDefaults, imagesToPdfOptions } from "../_shared-options";

/**
 * Many-to-one sibling of `jpg-to-pdf` for HEIC input (ADR-0015 addendum:
 * curated multi-step tool, not generic chaining). `pdf-lib` only embeds
 * jpg/png, so each dropped file is first decoded and re-encoded to JPG
 * (`imagePipeline`'s steps), then the JPGs are merged. `engine-host` runs
 * every step before a `merge` once per input and merges the results in the
 * order the user arranged them.
 */
export default defineTool({
  slug: "heic-to-pdf",
  category: "pdf",
  title: "HEIC to PDF",
  description:
    "Combine iPhone HEIC photos into one PDF, one photo per page, in the order you choose.",

  accepts: ["heic"],
  produces: "pdf",

  options: imagesToPdfOptions,
  defaults: imagesToPdfDefaults,

  pipeline: [
    ...imagePipeline("heic", "jpg"),
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
