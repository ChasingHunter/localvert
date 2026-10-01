import { defineTool, imagePipeline } from "@/lib/registry";
import { webpDefaults, webpOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("heic", "webp")` (ADR-0007: decode -> encode).
 *  `webpOptions`/`webpDefaults` are shared with every other `*-to-webp`
 * tool, so the options form matches `png-to-webp`.
 */
export default defineTool({
  slug: "heic-to-webp",
  category: "image",
  title: "HEIC to WebP",
  description:
    "Convert iPhone HEIC photos to WebP for smaller files. Only the primary image converts, and re-encoding strips embedded metadata, including GPS.",

  accepts: ["heic"],
  produces: "webp",

  options: webpOptions,
  defaults: webpDefaults,

  pipeline: imagePipeline("heic", "webp"),

  batch: true,
});
