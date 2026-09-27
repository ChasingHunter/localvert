import { defineTool, imagePipeline } from "@/lib/registry";
import { jpgDefaults, jpgOptions } from "../_shared-options";

export default defineTool({
  slug: "bmp-to-jpg",
  category: "image",
  title: "BMP to JPG",
  description:
    "Convert BMP to JPG — much smaller files, and works everywhere. Free " +
    "and private: runs in your browser, no upload. Transparent areas are " +
    "filled with a background color.",

  accepts: ["bmp"],
  produces: "jpg",

  options: jpgOptions,
  defaults: jpgDefaults,

  pipeline: imagePipeline("bmp", "jpg"),

  batch: true,
});
