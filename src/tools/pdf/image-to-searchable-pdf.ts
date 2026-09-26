import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Same `ocr` op as `src/tools/image/image-to-text.ts`, different
 * `outputFormat` — the `tesseract` engine's `recognize({pdf: true})` path
 * returns a PDF with the original page image plus an invisible OCR text
 * layer over it (searchable/selectable, not just a picture of the text).
 * Filed under `pdf` (its output category), same convention as
 * `images-to-pdf.ts` living there despite taking image input.
 *
 * Multi-page scanned-PDF -> searchable-PDF (rendering each PDF page with
 * `pdfjs` first, OCR-ing each, then merging) is out of scope here — see
 * docs/ROADMAP.md's OCR sub-item for that follow-up. This tool's input is
 * a single page image, not a PDF.
 */
export default defineTool({
  slug: "image-to-searchable-pdf",
  category: "pdf",
  title: "Image to Searchable PDF",
  description:
    "Turn a photo or scan into a searchable PDF with OCR, privately in " +
    "your browser. Free and private: no upload, text stays selectable.",

  accepts: ["jpg", "png", "webp", "bmp"],
  produces: "pdf",

  options: z.object({
    language: z
      .enum(["eng"])
      .meta({ label: "Language", control: "select" })
      .default("eng"),
  }),
  defaults: { language: "eng" },

  pipeline: [{ op: "ocr", candidates: [{ engine: "tesseract" }] }],

  batch: true,
});
