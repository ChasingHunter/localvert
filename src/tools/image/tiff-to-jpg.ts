import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * Pipeline is `imagePipeline("tiff", "jpg")` — decode via utif2, encode via
 * jsquash-jpeg/canvas (ADR-0007). `utif2` decodes a multi-page TIFF's
 * *first* page only (`../lib/engines/utif/adapter.ts`'s `runDecode`);
 * later pages are never read.
 *
 * `quality`/`background` mirror the canvas and jsquash-jpeg adapters' own
 * option keys (`options.quality`, `options.background`) — jpg has no
 * transparency, so `background` is what a decoded page's alpha (if any)
 * composites onto before encoding.
 */
export default defineTool({
  slug: "tiff-to-jpg",
  category: "image",
  title: "TIFF to JPG",
  description:
    "Convert TIFF to JPG — free, private, in your browser. Only the first " +
    "page of a multi-page TIFF is converted. Files never leave your " +
    "device, and re-encoding strips embedded metadata, including GPS " +
    "location.",

  accepts: ["tiff"],
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

  pipeline: imagePipeline("tiff", "jpg"),

  batch: true,
});
