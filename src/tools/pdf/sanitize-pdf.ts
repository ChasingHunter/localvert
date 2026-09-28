import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Strips hidden/embedded data a PDF can carry that a viewer never shows —
 * see the `pdf-lib` engine's `runSanitize`. Every switch is independent;
 * `links` defaults off (web links are visible, wanted content, not "hidden
 * data") while the rest default on, matching what a "clean this PDF before
 * I share it" user expects out of the box.
 */
export default defineTool({
  slug: "sanitize-pdf",
  category: "pdf",
  title: "Sanitize PDF",
  description:
    "Strip hidden metadata, embedded JavaScript and file attachments from a PDF.",

  accepts: ["pdf"],
  produces: "pdf",

  options: z.object({
    metadata: z.boolean().meta({
      label: "Remove metadata (author, title, dates…)",
      control: "switch",
    }),
    javascript: z
      .boolean()
      .meta({ label: "Remove JavaScript", control: "switch" }),
    attachments: z
      .boolean()
      .meta({ label: "Remove attachments", control: "switch" }),
    links: z.boolean().meta({ label: "Remove web links", control: "switch" }),
  }),
  defaults: {
    metadata: true,
    javascript: true,
    attachments: true,
    links: false,
  },

  pipeline: [
    {
      op: "sanitize",
      from: "pdf",
      to: "pdf",
      candidates: [{ engine: "pdf-lib" }],
    },
  ],

  batch: true,
});
