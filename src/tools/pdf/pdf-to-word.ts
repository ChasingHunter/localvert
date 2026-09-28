import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Two-engine pipeline (docs/adr/0014-pdf-to-word.md): LibreOffice can't do
 * this (its wrapper only imports a PDF into Draw, never Writer — see
 * docs/adr/0012-libreoffice-office-to-pdf.md's newest addendum), so this
 * reconstructs the document itself. `pdfjs`'s own `extractLayout` op reads
 * the PDF's text into a `LayoutDocument` (pages of paragraphs of styled
 * runs, headings inferred from relative font size — see
 * `src/lib/engines/shared/pdf-layout.ts`) as JSON; the `docx` engine's own
 * `transcode` op turns that JSON into an actual `.docx`
 * (`src/lib/engines/docx/writer.ts`), pure JS, no wasm. Same "json" hand-off
 * pattern `epub-to-pdf` uses for its own intermediate (there, html).
 */
const options = z.object({
  pageBreaks: z.boolean().meta({
    label: "Keep page breaks",
    control: "switch",
    help: "Insert a page break between each PDF page's content.",
  }),
});

export default defineTool({
  slug: "pdf-to-word",
  category: "pdf",
  title: "PDF to Word",
  description:
    "Convert a PDF to an editable .docx, privately in your browser — no " +
    "upload. Layout is approximate: text, headings and paragraph breaks " +
    "come across in reading order, but columns, tables, exact positioning " +
    "and embedded images don't (this version is text-only). Scanned PDFs " +
    "with no text layer need OCR first — see PDF to Searchable PDF.",

  accepts: ["pdf"],
  produces: "docx",
  rank: 1,

  options,
  defaults: { pageBreaks: true },

  pipeline: [
    {
      op: "extractLayout",
      from: "pdf",
      to: "json",
      candidates: [{ engine: "pdfjs" }],
    },
    {
      op: "transcode",
      from: "json",
      to: "docx",
      candidates: [{ engine: "docx" }],
    },
  ],

  batch: true,
});
