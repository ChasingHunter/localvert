import { defineTool, imagePipeline } from "@/lib/registry";
import { svgDefaults, svgOptions } from "../_shared-options";

/**
 * Pipeline is `imagePipeline("webp", "svg")` — see `png-to-svg.ts`'s doc
 * comment for the `tracer` engine's shape (trace, not pixel re-encode).
 */
export default defineTool({
  slug: "webp-to-svg",
  category: "image",
  title: "WebP to SVG",
  description:
    "Convert WebP to SVG — trace images into scalable vectors, privately " +
    "in your browser. Free and private: runs entirely on your device, no " +
    "upload. Large images are traced at up to 1600 px on the long side.",

  accepts: ["webp"],
  produces: "svg",

  options: svgOptions,
  defaults: svgDefaults,

  pipeline: imagePipeline("webp", "svg"),

  batch: true,
});
