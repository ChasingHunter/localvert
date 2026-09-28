import { defineTool, imagePipeline } from "@/lib/registry";
import { gifDefaults, gifOptions } from "../_shared-options";

/** Writes a single-frame GIF (`canvas/gif.ts`) — animated GIF output is out
 * of scope for this tool, same as every other image conversion here. */
export default defineTool({
  slug: "png-to-gif",
  category: "image",
  title: "PNG to GIF",
  description:
    "Convert PNG to GIF. Colors are quantized to a 256-color palette; transparency is kept as 1-bit.",

  accepts: ["png"],
  produces: "gif",

  options: gifOptions,
  defaults: gifDefaults,

  pipeline: imagePipeline("png", "gif"),

  batch: true,
});
