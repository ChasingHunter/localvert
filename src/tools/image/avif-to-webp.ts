import { defineTool, imagePipeline } from "@/lib/registry";
import { webpDefaults, webpOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("avif", "webp")` (ADR-0007: decode -> encode).
 *  `webpOptions`/`webpDefaults` are shared with every other `*-to-webp`
 * tool, so the options form matches `png-to-webp`.
 */
export default defineTool({
  slug: "avif-to-webp",
  category: "image",
  title: "AVIF to WebP",
  description:
    "Convert AVIF to WebP for an image that opens in more places. Transparency is kept. An animated AVIF becomes a still of its first frame.",

  accepts: ["avif"],
  produces: "webp",

  options: webpOptions,
  defaults: webpDefaults,

  pipeline: imagePipeline("avif", "webp"),

  batch: true,
});
