import { defineTool, imagePipeline } from "@/lib/registry";
import { jpgDefaults, jpgOptions } from "../_shared-options";

/**
 * Same `jpgOptions`/`jpgDefaults` as `webp-to-jpg` — shared with every other
 * `*-to-jpg` tool (see `src/tools/_shared-options.ts`).
 */
export default defineTool({
  slug: "jxl-to-jpg",
  category: "image",
  title: "JPEG XL to JPG",
  description:
    "Convert JPEG XL (JXL) to JPG — open JXL images anywhere. Free, " +
    "private, runs in your browser. Re-encoding strips embedded metadata, " +
    "including GPS.",

  accepts: ["jxl"],
  produces: "jpg",

  options: jpgOptions,
  defaults: jpgDefaults,

  pipeline: imagePipeline("jxl", "jpg"),

  batch: true,
});
