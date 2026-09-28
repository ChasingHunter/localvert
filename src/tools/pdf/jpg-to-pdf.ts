import { defineTool } from "@/lib/registry";
import { imagesToPdfDefaults, imagesToPdfOptions } from "../_shared-options";

/**
 * Single-format sibling of `images-to-pdf` (ADR-0008 many-to-one, same
 * `merge` op on the `pdf-lib` engine's `runMergeImages`, same
 * `imagesToPdfOptions`) — exists for a user who searches "jpg to pdf"
 * specifically rather than the mixed-format tool. `images-to-pdf` stays the
 * one that accepts both formats in the same drop; this one only takes jpg.
 */
export default defineTool({
  slug: "jpg-to-pdf",
  category: "pdf",
  title: "JPG to PDF",
  description:
    "Combine JPG images into one PDF, one image per page, in the order you " +
    "choose. Free and private: runs in your browser, no upload.",

  accepts: ["jpg"],
  produces: "pdf",
  rank: 8,

  options: imagesToPdfOptions,
  defaults: imagesToPdfDefaults,

  pipeline: [
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
