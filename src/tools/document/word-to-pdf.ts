import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * The `libreoffice` engine's `transcode` op (ADR-0012): docx/doc/odt/rtf ->
 * pdf, via a real LibreOffice import/export filter for full fidelity
 * (styles, headers/footers, tracked changes, embedded objects) rather than a
 * hand-rolled docx parser. No declared `from`/`to` on the pipeline step —
 * `job-engine.ts`'s `buildSteps` falls back to (the file's own sniffed
 * format -> `produces`), which is what lets one tool accept every listed
 * word-processor format through a single `transcode` step.
 */
const options = z.object({});

export default defineTool({
  slug: "word-to-pdf",
  category: "document",
  title: "Word to PDF",
  description:
    "Convert Word, OpenDocument Text or RTF files to PDF in your browser " +
    "with LibreOffice, fully offline. Needs a desktop browser and a " +
    "one-time ~74 MB download. Files never leave your device.",

  accepts: ["docx", "doc", "odt", "rtf"],
  produces: "pdf",

  options,
  defaults: {},

  pipeline: [
    {
      op: "transcode",
      candidates: [{ engine: "libreoffice" }],
    },
  ],

  batch: true,
});
