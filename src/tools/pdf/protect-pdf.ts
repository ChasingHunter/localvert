import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * `password` is a real, empty-default string field rather than a
 * `.min(1)`-constrained one: `defineTool` requires `defaults` to satisfy
 * `options`, and there's no non-empty password to default to. The
 * pdf-lib engine's `runProtect` is the one that actually enforces it,
 * throwing a clear error if the job runs with the field still blank.
 */
export default defineTool({
  slug: "protect-pdf",
  category: "pdf",
  title: "Password Protect PDF",
  description:
    "Add a password to a PDF with AES-256 encryption. Free and private: " +
    "runs in your browser, no upload.",

  accepts: ["pdf"],
  produces: "pdf",

  options: z.object({
    password: z.string().meta({ label: "Password", control: "password" }),
    allowPrinting: z
      .boolean()
      .meta({ label: "Allow printing", control: "switch" }),
    allowCopying: z.boolean().meta({
      label: "Allow copying text and images",
      control: "switch",
    }),
  }),
  defaults: { password: "", allowPrinting: true, allowCopying: false },

  pipeline: [
    {
      op: "protect",
      from: "pdf",
      to: "pdf",
      candidates: [{ engine: "pdf-lib" }],
    },
  ],

  batch: true,
});
