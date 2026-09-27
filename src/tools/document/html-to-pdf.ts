import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * The `libreoffice` engine's `transcode` op (ADR-0012 addendum): html ->
 * pdf, via LibreOffice Writer's own HTML import filter. LibreOffice runs
 * fully offline under this app's `connect-src 'self'` (invariant 1) — an
 * `<img src="https://...">` or `@import`ed stylesheet the dropped HTML
 * references simply fails to load, same as it would with any other
 * network-disabled renderer. See `description` below: this is stated up
 * front, not discovered as a silent rendering gap.
 */
const options = z.object({});

export default defineTool({
  slug: "html-to-pdf",
  category: "document",
  title: "HTML to PDF",
  description:
    "Convert an HTML file to PDF in your browser with LibreOffice, fully " +
    "offline. External images and stylesheets (anything not embedded in " +
    "the file itself) won't load — this app never makes network requests. " +
    "Needs a desktop browser and a one-time ~74 MB download. Files never " +
    "leave your device.",

  accepts: ["html"],
  produces: "pdf",

  options,
  defaults: {},

  pipeline: [
    {
      op: "transcode",
      from: "html",
      to: "pdf",
      candidates: [{ engine: "libreoffice" }],
    },
  ],

  batch: true,
});
