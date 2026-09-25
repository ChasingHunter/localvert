import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * Pipeline is `imagePipeline("raw", "png")` (ADR-0007: decode -> encode). PNG
 * is lossless, so — same reasoning as `jpg-to-png.ts` — there is no quality
 * knob, and no `background` either: PNG carries alpha natively, and camera
 * raw decodes fully opaque anyway (libraw's demosaic never produces alpha),
 * so there is nothing for a background fill to do.
 *
 * `halfSize` is libraw's own faster half-resolution decode — useful for a
 * quick preview of a large raw file without waiting for a full-size demosaic.
 */
export default defineTool({
  slug: "raw-to-png",
  category: "image",
  title: "Convert RAW to PNG — CR2, NEF, ARW, DNG and more, in your browser",
  description:
    "Convert camera RAW photos — CR2, NEF, ARW, DNG and more — to PNG. " +
    "Free, private, in your browser. Files never leave your device. " +
    "Decoding through libraw and re-encoding strips embedded metadata, " +
    "including GPS location.",

  accepts: ["raw"],
  produces: "png",

  options: z.object({
    halfSize: z.boolean().default(false).meta({
      label: "Fast half-size decode",
      control: "switch",
      help: "Decodes at half resolution — faster, good for a quick preview.",
    }),
  }),
  defaults: { halfSize: false },

  pipeline: imagePipeline("raw", "png"),

  batch: true,
});
