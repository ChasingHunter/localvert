import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * The `libreoffice` engine's `transcode` op (ADR-0012 addendum): plain text
 * -> pdf, via LibreOffice Writer's own "Text" import filter — the same
 * fidelity guarantee word-to-pdf gives docx/odt/rtf, just for a format with
 * no styling of its own. Unlike `word-to-pdf`, this tool accepts exactly one
 * format, so the pipeline step declares `from`/`to` explicitly rather than
 * relying on `job-engine.ts`'s sniffed-format fallback.
 */
const options = z.object({});

export default defineTool({
  slug: "txt-to-pdf",
  category: "document",
  title: "Text to PDF",
  description:
    "Convert plain text files to PDF in your browser with LibreOffice, " +
    "fully offline. Needs a desktop browser and a one-time ~74 MB download. " +
    "Files never leave your device.",

  accepts: ["txt"],
  produces: "pdf",

  options,
  defaults: {},

  pipeline: [
    {
      op: "transcode",
      from: "txt",
      to: "pdf",
      candidates: [{ engine: "libreoffice" }],
    },
  ],

  batch: true,
});
