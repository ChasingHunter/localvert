import { defineTool, imagePipeline } from "@/lib/registry";
import { bmpDefaults, bmpOptions } from "../_shared-options";

export default defineTool({
  slug: "png-to-bmp",
  category: "image",
  title: "PNG to BMP",
  description:
    "Convert PNG to an uncompressed BMP, for tools that need one. Transparency is kept as a 32-bit alpha channel.",

  accepts: ["png"],
  produces: "bmp",

  options: bmpOptions,
  defaults: bmpDefaults,

  pipeline: imagePipeline("png", "bmp"),

  batch: true,
});
