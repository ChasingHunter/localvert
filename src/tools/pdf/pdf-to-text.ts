import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * pdf.js's own text layer (`pdfjs/adapter.ts`'s `runExtractText`) — reads
 * the PDF's embedded text, no rasterisation. A page with no text at all
 * (most often a scanned image with no OCR layer) comes back empty; see this
 * tool's own description for the pointer to `pdf-to-searchable-pdf`, which
 * OCRs a scan first. `pageMarkers` defaults off — most people pasting the
 * result into another document don't want "--- Page 3 ---" headings
 * breaking up the flow; it's there for whoever does want the page
 * boundaries kept.
 */
export default defineTool({
  slug: "pdf-to-text",
  category: "pdf",
  title: "PDF to Text",
  description:
    "Extract the text from a PDF into a plain .txt file. A scanned PDF with no text layer needs OCR first: see PDF to Searchable PDF.",

  accepts: ["pdf"],
  produces: "txt",

  options: z.object({
    pages: z.string().meta({
      label: "Pages",
      control: "text",
      help: "e.g. 1-3, 5. Leave empty for every page.",
    }),
    pageMarkers: z.boolean().meta({
      label: "Add page headings",
      control: "switch",
      help: 'Heads each page\'s text with "--- Page N ---".',
    }),
  }),
  defaults: { pages: "", pageMarkers: false },

  pipeline: [
    {
      op: "extractText",
      from: "pdf",
      to: "txt",
      candidates: [{ engine: "pdfjs" }],
    },
  ],

  batch: true,
});
