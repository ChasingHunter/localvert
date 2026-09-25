import { defineTool, imagePipeline } from "@/lib/registry";
import { jpgDefaults, jpgOptions } from "../_shared-options";

/**
 * Same `jpgOptions`/`jpgDefaults` as `webp-to-jpg` — shared with every other
 * `*-to-jpg` tool (see `src/tools/_shared-options.ts`).
 */
export default defineTool({
  slug: "avif-to-jpg",
  category: "image",
  title: "AVIF to JPG",
  description:
    "Convert AVIF to JPG — open AVIF images anywhere. Free, private, runs " +
    "in your browser. Re-encoding strips embedded metadata, including GPS.",

  accepts: ["avif"],
  produces: "jpg",

  options: jpgOptions,
  defaults: jpgDefaults,

  pipeline: imagePipeline("avif", "jpg"),

  batch: true,
});
