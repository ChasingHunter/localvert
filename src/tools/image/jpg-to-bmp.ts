import { defineTool, imagePipeline } from "@/lib/registry";
import { bmpDefaults, bmpOptions } from "../_shared-options";

export default defineTool({
  slug: "jpg-to-bmp",
  category: "image",
  title: "JPG to BMP",
  description:
    "Convert JPG to BMP — an uncompressed bitmap for tools that need one. " +
    "Free and private: runs in your browser, no upload.",

  accepts: ["jpg"],
  produces: "bmp",

  options: bmpOptions,
  defaults: bmpDefaults,

  pipeline: imagePipeline("jpg", "bmp"),

  batch: true,
});
