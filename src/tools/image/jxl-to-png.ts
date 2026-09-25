import { z } from "zod";
import { defineTool, imagePipeline } from "@/lib/registry";

/**
 * PNG is lossless with alpha — no quality knob, no background fill; JPEG
 * XL's own alpha channel carries straight through. The decode/encode round
 * trip still drops embedded metadata (EXIF, including GPS) on every run.
 */
export default defineTool({
  slug: "jxl-to-png",
  category: "image",
  title: "JPEG XL to PNG",
  description:
    "Convert JPEG XL (JXL) to PNG — open JXL images anywhere. Free, " +
    "private, runs in your browser. Re-encoding strips embedded metadata, " +
    "including GPS.",

  accepts: ["jxl"],
  produces: "png",

  options: z.object({}),
  defaults: {},

  pipeline: imagePipeline("jxl", "png"),

  batch: true,
});
