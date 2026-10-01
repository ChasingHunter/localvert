import { defineTool } from "@/lib/registry";
import { pageJpgDefaults, pageJpgOptions } from "../_shared-options";

/**
 * Two curated steps (ADR-0015 addendum: multi-hop is a hand-written tool
 * file, never generic chaining): the `libreoffice` engine's `transcode`
 * turns the spreadsheet into a PDF (see `excel-to-pdf.ts`), then `pdfjs` `render`s every page
 * to a JPG, same as `pdf-to-jpg`. The first step declares only `to`, so
 * `buildSteps` falls back to the dropped file's own format as its input.
 */
export default defineTool({
  slug: "excel-to-jpg",
  category: "document",
  title: "Excel to JPG",
  description:
    "Turn each page of an Excel or OpenDocument Spreadsheet into a JPG image. Needs a one-time 74 MB download on desktop.",

  accepts: ["xlsx", "xls", "ods"],
  produces: "jpg",

  options: pageJpgOptions,
  defaults: pageJpgDefaults,

  pipeline: [
    {
      op: "transcode",
      to: "pdf",
      candidates: [{ engine: "libreoffice" }],
    },
    {
      op: "render",
      from: "pdf",
      to: "jpg",
      candidates: [{ engine: "pdfjs" }],
    },
  ],

  batch: false,
  arity: "one-to-many",
});
