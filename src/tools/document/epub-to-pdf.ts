import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Two-engine pipeline (docs/adr/0012-libreoffice-office-to-pdf.md's EPUB
 * addendum): the `epub` engine unzips the epub and concatenates its spine's
 * XHTML chapters into one HTML document (`src/lib/engines/epub/epub.ts` —
 * LibreOffice has no EPUB import filter of its own), then the `libreoffice`
 * engine's own `html -> pdf` transcode renders that document, same as
 * `html-to-pdf`. Each step declares its own `from`/`to` since they're
 * different format pairs, same pattern `imagePipeline` uses for
 * decode/encode.
 */
const options = z.object({});

export default defineTool({
  slug: "epub-to-pdf",
  category: "document",
  title: "EPUB to PDF",
  description:
    "Convert an EPUB ebook to PDF in your browser, fully offline. Chapters " +
    "are rendered in reading order via LibreOffice; layout is approximate " +
    "(EPUB's own reflowable styling isn't preserved) and only images " +
    "embedded in the book itself are shown. Needs a desktop browser and a " +
    "one-time ~74 MB download. Files never leave your device.",

  accepts: ["epub"],
  produces: "pdf",

  options,
  defaults: {},

  pipeline: [
    {
      op: "transcode",
      from: "epub",
      to: "html",
      candidates: [{ engine: "epub" }],
    },
    {
      op: "transcode",
      from: "html",
      to: "pdf",
      candidates: [{ engine: "libreoffice" }],
    },
  ],

  batch: true,
});
