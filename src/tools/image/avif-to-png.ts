import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * PNG is lossless with alpha — no quality knob, no background fill; AVIF's
 * own alpha channel carries straight through. The decode/encode round trip
 * still drops embedded metadata (EXIF, including GPS) on every run.
 */
export default defineTool({
  slug: "avif-to-png",
  category: "image",
  title: "AVIF to PNG",
  description:
    "Convert AVIF to PNG — open AVIF images anywhere. Free, private, runs " +
    "in your browser. Re-encoding strips embedded metadata, including GPS.",

  accepts: ["avif"],
  produces: "png",

  options: z.object({}),
  defaults: {},

  pipeline: imagePipeline("avif", "png"),

  batch: true,
});
