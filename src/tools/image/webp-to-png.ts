import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * PNG is lossless with alpha, so — same as `jpg-to-png` — there is no
 * quality knob and no background fill to expose; WebP's own alpha channel
 * carries straight through the decode/encode round trip. That round trip
 * still drops embedded metadata (EXIF, including GPS) on every run.
 */
export default defineTool({
  slug: "webp-to-png",
  category: "image",
  title: "WebP to PNG",
  description:
    "Convert WebP to PNG — open WebP images anywhere. Free, private, runs " +
    "in your browser. Re-encoding strips embedded metadata, including GPS.",

  accepts: ["webp"],
  produces: "png",

  options: z.object({}),
  defaults: {},

  pipeline: imagePipeline("webp", "png"),

  batch: true,
});
