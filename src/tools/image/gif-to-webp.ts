import { defineTool, imagePipeline } from "@/lib/registry";
import { webpDefaults, webpOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("gif", "webp")` (ADR-0007: decode -> encode).
 *  `webpOptions`/`webpDefaults` are shared with every other `*-to-webp`
 * tool, so the options form matches `png-to-webp`.
 */
export default defineTool({
  slug: "gif-to-webp",
  category: "image",
  title: "GIF to WebP",
  description:
    "Convert GIF to WebP. An animated GIF becomes a still image of its first frame; transparency is kept.",

  accepts: ["gif"],
  produces: "webp",

  options: webpOptions,
  defaults: webpDefaults,

  pipeline: imagePipeline("gif", "webp"),

  batch: true,
});
