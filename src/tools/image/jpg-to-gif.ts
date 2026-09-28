import { defineTool, imagePipeline } from "@/lib/registry";
import { gifDefaults, gifOptions } from "../_shared-options";

/** Same single-frame-only, 256-color-quantized output as `png-to-gif` — see
 * that tool's doc comment. */
export default defineTool({
  slug: "jpg-to-gif",
  category: "image",
  title: "JPG to GIF",
  description:
    "Convert JPG to GIF. Colors are quantized to a 256-color palette.",

  accepts: ["jpg"],
  produces: "gif",

  options: gifOptions,
  defaults: gifDefaults,

  pipeline: imagePipeline("jpg", "gif"),

  batch: true,
});
