import { defineTool } from "@/lib/registry";
import { imagesToPdfDefaults, imagesToPdfOptions } from "../_shared-options";

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
 *
 * `options`/`defaults` live in `_shared-options.ts` (`imagesToPdfOptions`)
 * so the per-format siblings `jpg-to-pdf`/`png-to-pdf` render the identical
 * form rather than drifting apart one tool file at a time — same reasoning
 * as `jpgOptions` there.
 */
export default defineTool({
  slug: "images-to-pdf",
  category: "pdf",
  title: "Images to PDF",
  description:
    "Combine JPG and PNG images into one PDF, one image per page, in the order you choose.",

  accepts: ["jpg", "png"],
  produces: "pdf",

  options: imagesToPdfOptions,
  defaults: imagesToPdfDefaults,

  pipeline: [{ op: "merge", candidates: [{ engine: "pdf-lib" }] }],

  batch: false,
  arity: "many-to-one",
  actionLabel: "Create PDF",
});
