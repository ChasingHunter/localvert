import { defineTool } from "@/lib/registry";
import { pageJpgDefaults, pageJpgOptions } from "../_shared-options";

/**
 * Two curated steps (ADR-0015 addendum: multi-hop is a hand-written tool
 * file, never generic chaining): the `libreoffice` engine's `transcode`
 * turns the presentation into a PDF (see `powerpoint-to-pdf.ts`), then `pdfjs` `render`s every page
 * to a JPG, same as `pdf-to-jpg`. The first step declares only `to`, so
 * `buildSteps` falls back to the dropped file's own format as its input.
 */
export default defineTool({
  slug: "powerpoint-to-jpg",
  category: "document",
  title: "PowerPoint to JPG",
  description:
    "Save each slide of a PowerPoint or OpenDocument Presentation as a JPG image. Needs a one-time 74 MB download on desktop.",

  accepts: ["pptx", "ppt", "odp"],
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
