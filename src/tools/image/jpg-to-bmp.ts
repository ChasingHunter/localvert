import { defineTool, imagePipeline } from "@/lib/registry";
import { bmpDefaults, bmpOptions } from "../_shared-options";

export default defineTool({
  slug: "jpg-to-bmp",
  category: "image",
  title: "JPG to BMP",
  description: "Convert JPG to an uncompressed BMP, for tools that need one.",

  accepts: ["jpg"],
  produces: "bmp",

  options: bmpOptions,
  defaults: bmpDefaults,

  pipeline: imagePipeline("jpg", "bmp"),

  batch: true,
});
