import { z } from "zod";
import { defineTool } from "@/lib/registry";

/**
 * Removes password protection from a PDF you already have the password to
 * — the pdf-lib engine's `runUnlock`. A wrong password fails the job with
 * "Wrong password" rather than producing a corrupt file; see that op's doc
 * comment for the `@cantoo/pdf-lib` cleanup step it needs to do first.
 */
export default defineTool({
  slug: "unlock-pdf",
  category: "pdf",
  title: "Unlock PDF",
  description:
    "Remove a password from a PDF you have the password to. Free and " +
    "private: runs in your browser, no upload.",

  accepts: ["pdf"],
  produces: "pdf",

  options: z.object({
    password: z.string().meta({ label: "Password", control: "password" }),
  }),
  defaults: { password: "" },

  pipeline: [
    {
      op: "unlock",
      from: "pdf",
      to: "pdf",
      candidates: [{ engine: "pdf-lib" }],
    },
  ],

  batch: true,
});
