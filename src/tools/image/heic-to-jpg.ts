import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * Pipeline is `imagePipeline("heic", "jpg")` — decode via `heic-to` (ADR-0002,
 * LGPL-3.0), encode via jsquash-jpeg/canvas (ADR-0007). `heic-to` only ever
 * decodes a HEIC/HEIF file's *primary* image; a "Live Photo" HEIC's paired
 * video and a burst's secondary frames are never read.
 *
 * `quality`/`background` mirror the canvas and jsquash-jpeg adapters' own
 * option keys (`options.quality`, `options.background`) — jpg has no
 * transparency, so `background` is what a decoded HEIC's alpha (if any)
 * composites onto before encoding.
 */
export default defineTool({
  slug: "heic-to-jpg",
  category: "image",
  title: "HEIC to JPG",
  description:
    "Convert HEIC to JPG — open iPhone photos anywhere, free and private, " +
    "in your browser. Files never leave your device. Only the primary image " +
    "in a HEIC file is converted, and re-encoding strips embedded metadata, " +
    "including GPS location.",

  accepts: ["heic"],
  produces: "jpg",

  options: z.object({
    quality: z
      .number()
      .min(0.1)
      .max(1)
      .meta({ label: "Quality", control: "slider" }),
    background: z.string().meta({
      label: "Background color",
      control: "text",
      help: "Fills transparent areas — JPG has no transparency of its own.",
    }),
  }),
  defaults: { quality: 0.85, background: "#ffffff" },

  pipeline: imagePipeline("heic", "jpg"),

  batch: true,
});
