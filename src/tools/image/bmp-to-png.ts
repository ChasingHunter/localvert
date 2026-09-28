import { defineTool, imagePipeline } from "@/lib/registry";
import { pngDefaults, pngOptions } from "../_shared-options";

export default defineTool({
  slug: "bmp-to-png",
  category: "image",
  title: "BMP to PNG",
  description:
    "Convert BMP to PNG for a much smaller file that works everywhere.",

  accepts: ["bmp"],
  produces: "png",

  options: pngOptions,
  defaults: pngDefaults,

  pipeline: imagePipeline("bmp", "png"),

  batch: true,
});
