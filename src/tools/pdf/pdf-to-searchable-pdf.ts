import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * ADR-0008 follow-up to `image-to-searchable-pdf.ts` (see that file's doc
 * comment): a multi-page scanned PDF, not a single page image. The `ocrPdf`
 * op is `tesseract`-only — it renders each page (via a dynamically-imported
 * `pdfjs` instance), OCRs it, and merges the per-page searchable PDFs back
 * into one (via a dynamically-imported `pdf-lib` instance), all inside the
 * same worker. See `tesseract/adapter.ts`'s `runOcrPdf` doc comment for why
 * this is one composite op rather than a three-step pipeline.
 */
export default defineTool({
  slug: "pdf-to-searchable-pdf",
  category: "pdf",
  title: "Scanned PDF to Searchable PDF",
  description:
    "Turn a scanned, multi-page PDF into a searchable PDF with OCR. Text stays selectable on every page.",

  accepts: ["pdf"],
  produces: "pdf",

  options: z.object({
    language: z
      .enum(["eng"])
      .meta({ label: "Language", control: "select" })
      .default("eng"),
  }),
  defaults: { language: "eng" },

  pipeline: [
    {
      op: "ocrPdf",
      from: "pdf",
      to: "pdf",
      candidates: [{ engine: "tesseract" }],
    },
  ],

  batch: true,
});
